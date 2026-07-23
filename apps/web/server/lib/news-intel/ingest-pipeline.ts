import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, newsArticles, newsIngestLogs, newsSources } from '@scm/db';
import { buildSummaryFallback, buildRelevanceProbeText, extractArticleBody } from './body-extract.js';
import { syncArticleToBitable, syncPendingArticlesToBitable } from './bitable-sync.js';
import {
  classifyNewsArticle,
  evaluateNewsRelevance,
  isPredominantlyEnglish,
} from './content-filter.js';
import {
  getNewsIntelMinRelevance,
  getRsshubBaseUrl,
  isNewsIntelEnabled,
} from './config.js';
import { buildDedupKeys, shouldSkipAsDuplicate } from './dedup.js';
import { enrichArticleWithDify } from './enrich-dify.js';
import { fetchRssFeed, parseRssPubDate } from './rss-fetcher.js';
import {
  ensureNewsSourcesSeeded,
  listNewsSources,
} from './source-service.js';
import {
  isSourceChannelEnabled,
  loadNewsIntelPolicy,
  parseSourceConfig,
  resolveSourceOfficial,
  resolveSourceTier,
} from './policy.js';
import type {
  IngestRunResult,
  IngestSourceResult,
  NewsArticleStatus,
  NewsBusinessValidity,
  NewsBitableSyncStatus,
} from './types.js';
import { normalizeNewsUrl, normalizeTitle } from './url-normalize.js';

function bumpReason(bucket: Record<string, number>, reason: string) {
  bucket[reason] = (bucket[reason] ?? 0) + 1;
}

function formatFilterReasons(bucket: Record<string, number>): string | undefined {
  const parts = Object.entries(bucket)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason}=${count}`);
  return parts.length ? `filterReasons: ${parts.join('; ')}` : undefined;
}

function shanghaiDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export async function hasSuccessfulIngestToday(): Promise<boolean> {
  const today = shanghaiDateKey();
  const recent = await db
    .select({ createdAt: newsIngestLogs.createdAt, errorMessage: newsIngestLogs.errorMessage })
    .from(newsIngestLogs)
    .orderBy(desc(newsIngestLogs.createdAt))
    .limit(200);

  return recent.some(
    (r) => !r.errorMessage && r.createdAt && shanghaiDateKey(r.createdAt) === today,
  );
}

async function processSource(
  source: typeof newsSources.$inferSelect,
  taskRunId?: string,
): Promise<IngestSourceResult> {
  const started = Date.now();
  const result: IngestSourceResult = {
    sourceId: source.id,
    sourceCode: source.code,
    fetchedCount: 0,
    newCount: 0,
    skippedDup: 0,
    skippedLowRelevance: 0,
    skippedFiltered: 0,
    translatedCount: 0,
    bitableSyncFailedCount: 0,
    durationMs: 0,
  };

  const sourceConfig = parseSourceConfig(source.configJson);
  const sourceTier = resolveSourceTier(source.sourceTier, sourceConfig);
  const isOfficial = resolveSourceOfficial(source.isOfficial, sourceConfig);

  if (!isSourceChannelEnabled(sourceConfig)) {
    result.durationMs = Date.now() - started;
    return result;
  }

  try {
    if (source.sourceType === 'rsshub' && !getRsshubBaseUrl()) {
      result.errorMessage = 'RSSHUB_BASE_URL not configured — skip rsshub source';
      await db
        .update(newsSources)
        .set({ lastError: result.errorMessage, updatedAt: new Date() })
        .where(eq(newsSources.id, source.id));
      result.durationMs = Date.now() - started;
      await db.insert(newsIngestLogs).values({
        sourceId: source.id,
        taskRunId: taskRunId ?? null,
        fetchedCount: 0,
        newCount: 0,
        skippedDup: 0,
        skippedLowRelevance: 0,
        skippedFiltered: 0,
        translatedCount: 0,
        bitableSyncFailedCount: 0,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
      });
      return result;
    }

    const items = await fetchRssFeed(source.feedUrl, source.sourceType);
    result.fetchedCount = items.length;
    const policy = loadNewsIntelPolicy();
    const maxItems = policy.maxItemsPerSource;
    const minRelevance = getNewsIntelMinRelevance();
    const filterReasons: Record<string, number> = {};

    for (const item of items.slice(0, maxItems)) {
      const titleOriginal = normalizeTitle(item.title);
      const canonicalUrl = normalizeNewsUrl(item.link);
      const snippet = item.contentSnippet ?? '';
      const publishedAt = parseRssPubDate(item.pubDate);
      const probeText = buildRelevanceProbeText({
        title: titleOriginal,
        snippet,
        rssContent: item.content,
      });

      const relevance = evaluateNewsRelevance({
        title: titleOriginal,
        body: probeText,
        publishedAt,
        canonicalUrl,
        sourceConfig,
        sourceTier,
        isOfficial,
      });
      if (!relevance.pass) {
        result.skippedFiltered += 1;
        bumpReason(filterReasons, relevance.reason || 'filtered');
        continue;
      }

      const bodyText =
        (await extractArticleBody(canonicalUrl, item.content)) ?? snippet;

      const english = isPredominantlyEnglish(titleOriginal, bodyText || probeText);
      const classification = classifyNewsArticle(titleOriginal, probeText);

      const enrich = await enrichArticleWithDify({
        title: titleOriginal,
        bodyText,
        sourceName: source.name,
        language: english ? 'en' : 'zh',
        sourceTier,
        isOfficial,
        // 中文标题改由飞书多维表格 AI 字段补全；Dify 有则用，无则英文原文入表
        requireTitleZh: false,
        fallbackCategory: 'other',
        fallbackPriority: classification.priority,
      });

      if (english && enrich?.titleZh) result.translatedCount += 1;

      const titleZh = enrich?.titleZh?.trim() || (english ? null : titleOriginal);
      const displayTitle = titleZh || titleOriginal;
      const summary =
        enrich?.summary ?? buildSummaryFallback(displayTitle, bodyText, snippet);

      const relevanceScore = Math.max(
        classification.relevanceScore,
        enrich?.relevanceScore ?? 0,
      );
      if (relevanceScore < minRelevance) {
        result.skippedLowRelevance += 1;
        bumpReason(filterReasons, 'low_relevance');
        continue;
      }

      const priority =
        enrich?.priority ??
        (relevanceScore >= 75 ? 'high' : relevanceScore >= 55 ? 'medium' : 'low');

      const dupReason = await shouldSkipAsDuplicate(displayTitle, summary, canonicalUrl, {
        incomingTier: sourceTier,
        incomingOfficial: isOfficial,
      });
      if (dupReason) {
        result.skippedDup += 1;
        continue;
      }

      const topicCategory = enrich?.topicCategory ?? classification.topicCategory;
      const departments =
        enrich?.departments?.length ? enrich.departments : classification.departments;
      const platformTags = classification.platformTags;
      const countryTags = classification.countryTags;
      const businessTags = classification.businessTags;
      const brandTags = classification.brandTags;
      const filterHits = [
        ...relevance.hits,
        ...classification.filterHits,
      ].join('; ');

      const { urlHash, contentHash } = buildDedupKeys(displayTitle, summary, canonicalUrl);

      const [inserted] = await db
        .insert(newsArticles)
        .values({
          sourceId: source.id,
          canonicalUrl,
          urlHash,
          title: displayTitle,
          titleZh,
          titleOriginal,
          summary,
          bodyText: bodyText || null,
          keyPoints: enrich?.keyPoints?.length ? enrich.keyPoints : null,
          category: 'other',
          bitableCategory: topicCategory,
          topicCategory,
          departments,
          platformTags,
          countryTags,
          businessTags,
          brandTags,
          tags: enrich?.tags?.length ? enrich.tags : null,
          relevanceScore,
          priority,
          status: 'published',
          sourceTier,
          isOfficialSource: isOfficial,
          filterHits,
          businessValidity: 'valid',
          publishedAt: publishedAt ?? null,
          contentHash,
          affectedPlatforms: platformTags.length ? platformTags : null,
          affectedRegions: countryTags.length ? countryTags : null,
          language: english ? 'en' : 'zh',
          bitableSyncStatus: 'pending',
          ingestRunId: taskRunId ?? null,
        })
        .returning({ id: newsArticles.id });

      if (inserted) {
        result.newCount += 1;
        try {
          await syncArticleToBitable(inserted.id);
        } catch (err) {
          result.bitableSyncFailedCount += 1;
          console.warn('[news-intel] Bitable sync failed for', inserted.id, err);
        }
      }
    }

    const reasonSummary = formatFilterReasons(filterReasons);
    const filterNote =
      reasonSummary && result.newCount === 0 ? reasonSummary : undefined;

    await db
      .update(newsSources)
      .set({
        lastFetchedAt: new Date(),
        lastError: null,
        consecutiveFailures: 0,
        updatedAt: new Date(),
      })
      .where(eq(newsSources.id, source.id));

    if (filterNote) {
      result.errorMessage = filterNote;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'source ingest failed';
    result.errorMessage = message;
    await db
      .update(newsSources)
      .set({
        lastError: message,
        consecutiveFailures: (source.consecutiveFailures ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(newsSources.id, source.id));
  }

  result.durationMs = Date.now() - started;

  await db.insert(newsIngestLogs).values({
    sourceId: source.id,
    taskRunId: taskRunId ?? null,
    fetchedCount: result.fetchedCount,
    newCount: result.newCount,
    skippedDup: result.skippedDup,
    skippedLowRelevance: result.skippedLowRelevance,
    skippedFiltered: result.skippedFiltered,
    translatedCount: result.translatedCount,
    bitableSyncFailedCount: result.bitableSyncFailedCount,
    errorMessage: result.errorMessage ?? null,
    durationMs: result.durationMs,
  });

  return result;
}

export async function runNewsIngest(options?: {
  taskRunId?: string;
  force?: boolean;
  sourceId?: string;
}): Promise<IngestRunResult> {
  if (!isNewsIntelEnabled()) {
    return {
      sourcesProcessed: 0,
      totalNew: 0,
      totalSkippedDup: 0,
      totalSkippedLowRelevance: 0,
      totalSkippedFiltered: 0,
      totalTranslated: 0,
      bitableSynced: 0,
      bitableSyncFailed: 0,
      sourceResults: [],
    };
  }

  await ensureNewsSourcesSeeded();

  // 每日一次保护：非 force、非指定信源时，今天已成功跑过则跳过
  if (!options?.force && !options?.sourceId) {
    const already = await hasSuccessfulIngestToday();
    if (already) {
      return {
        sourcesProcessed: 0,
        totalNew: 0,
        totalSkippedDup: 0,
        totalSkippedLowRelevance: 0,
        totalSkippedFiltered: 0,
        totalTranslated: 0,
        bitableSynced: 0,
        bitableSyncFailed: 0,
        skippedAlreadyRunToday: true,
        sourceResults: [],
      };
    }
  }

  let sources = await listNewsSources();
  sources = sources.filter((s) => s.enabled);
  if (options?.sourceId) {
    sources = sources.filter((s) => s.id === options.sourceId);
  }

  const sourceResults: IngestSourceResult[] = [];
  for (const source of sources) {
    sourceResults.push(await processSource(source, options?.taskRunId));
  }

  const bitableSynced = await syncPendingArticlesToBitable(50);
  const bitableSyncFailed = sourceResults.reduce((s, r) => s + r.bitableSyncFailedCount, 0);

  return {
    sourcesProcessed: sourceResults.length,
    totalNew: sourceResults.reduce((s, r) => s + r.newCount, 0),
    totalSkippedDup: sourceResults.reduce((s, r) => s + r.skippedDup, 0),
    totalSkippedLowRelevance: sourceResults.reduce((s, r) => s + r.skippedLowRelevance, 0),
    totalSkippedFiltered: sourceResults.reduce((s, r) => s + r.skippedFiltered, 0),
    totalTranslated: sourceResults.reduce((s, r) => s + r.translatedCount, 0),
    bitableSynced,
    bitableSyncFailed,
    sourceResults,
  };
}

export async function listNewsArticles(params: {
  page: number;
  pageSize: number;
  category?: string;
  topicCategory?: string;
  status?: string;
}) {
  const { page, pageSize, category, topicCategory, status } = params;
  const offset = (page - 1) * pageSize;

  const filters = [];
  if (category) filters.push(eq(newsArticles.category, category as never));
  if (topicCategory) filters.push(eq(newsArticles.topicCategory, topicCategory));
  if (status) filters.push(eq(newsArticles.status, status as never));

  const whereClause = filters.length ? and(...filters) : undefined;

  const items = await db
    .select({
      article: newsArticles,
      sourceName: newsSources.name,
      sourceTier: newsSources.sourceTier,
      isOfficial: newsSources.isOfficial,
    })
    .from(newsArticles)
    .innerJoin(newsSources, eq(newsArticles.sourceId, newsSources.id))
    .where(whereClause)
    .orderBy(desc(newsArticles.fetchedAt))
    .limit(pageSize)
    .offset(offset);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(newsArticles)
    .where(whereClause);

  return {
    items: items.map((row) => ({
      ...row.article,
      sourceName: row.sourceName,
      sourceTierLabel: row.sourceTier,
      sourceIsOfficial: row.isOfficial,
    })),
    total: countRow?.count ?? 0,
    page,
    pageSize,
  };
}

export async function getNewsArticleById(id: string) {
  const [row] = await db
    .select({
      article: newsArticles,
      sourceName: newsSources.name,
      sourceCode: newsSources.code,
    })
    .from(newsArticles)
    .innerJoin(newsSources, eq(newsArticles.sourceId, newsSources.id))
    .where(eq(newsArticles.id, id))
    .limit(1);

  if (!row) return null;
  return {
    ...row.article,
    sourceName: row.sourceName,
    sourceCode: row.sourceCode,
  };
}

export async function updateNewsArticle(
  id: string,
  patch: Partial<{
    status: NewsArticleStatus;
    priority: 'high' | 'medium' | 'low';
    category: string;
    businessValidity: NewsBusinessValidity;
    bitableSyncStatus: NewsBitableSyncStatus;
  }>,
) {
  const [row] = await db
    .update(newsArticles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(newsArticles.id, id))
    .returning();
  return row ?? null;
}

export async function getNewsIntelOverview() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [todayNew] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(newsArticles)
    .where(gte(newsArticles.fetchedAt, since));

  const [syncFailed] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(newsArticles)
    .where(eq(newsArticles.bitableSyncStatus, 'failed'));

  const [highPriority] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(newsArticles)
    .where(
      and(
        eq(newsArticles.priority, 'high'),
        eq(newsArticles.status, 'published'),
        gte(newsArticles.fetchedAt, since),
      ),
    );

  const [pendingSync] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(newsArticles)
    .where(eq(newsArticles.bitableSyncStatus, 'pending'));

  const sources = await listNewsSources();
  const healthySources = sources.filter((s) => s.enabled && (s.consecutiveFailures ?? 0) < 3).length;

  return {
    todayNew: todayNew?.count ?? 0,
    pendingReview: 0,
    pendingSync: pendingSync?.count ?? 0,
    syncFailed: syncFailed?.count ?? 0,
    highPriorityToday: highPriority?.count ?? 0,
    sourceTotal: sources.length,
    sourceHealthy: healthySources,
  };
}
