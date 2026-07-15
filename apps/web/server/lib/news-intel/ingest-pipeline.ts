import { eq, and, desc, sql, gte } from 'drizzle-orm';
import { db, newsArticles, newsIngestLogs, newsSources } from '@scm/db';
import { sendFeishuGroupMessage } from '../../integrations/feishu.js';
import { buildSummaryFallback, extractArticleBody } from './body-extract.js';
import { syncArticleToBitable, syncPendingArticlesToBitable } from './bitable-sync.js';
import {
  classifyForBitable,
  filterByOpenclawRules,
} from './content-filter.js';
import {
  getNewsIntelAutoPublishThreshold,
  getNewsIntelMinRelevance,
  isNewsIntelEnabled,
  getRsshubBaseUrl,
} from './config.js';
import { buildDedupKeys, shouldSkipAsDuplicate } from './dedup.js';
import { enrichArticleWithDify } from './enrich-dify.js';
import { fetchRssFeed, parseRssPubDate } from './rss-fetcher.js';
import {
  ensureNewsSourcesSeeded,
  isSourceDue,
  listNewsSources,
} from './source-service.js';
import {
  isSourceChannelEnabled,
  loadNewsIntelPolicy,
  parseSourceConfig,
} from './policy.js';
import type {
  IngestRunResult,
  IngestSourceResult,
  NewsArticleStatus,
} from './types.js';
import { normalizeNewsUrl, normalizeTitle } from './url-normalize.js';

function mapDifyCategoryToBitable(category: string): string {
  const map: Record<string, string> = {
    customs: '法规政策',
    platform_policy: '法规政策',
    logistics: '物流仓储',
    operations: '活动运营',
    supply_chain: '市场',
    other: '市场',
  };
  return map[category] ?? '市场';
}

function resolveArticleStatus(
  relevanceScore: number,
  priority: string,
): NewsArticleStatus {
  const minRelevance = getNewsIntelMinRelevance();
  const autoPublish = getNewsIntelAutoPublishThreshold();

  if (relevanceScore < minRelevance) return 'ignored';
  if (relevanceScore >= autoPublish && priority === 'high') return 'published';
  if (relevanceScore >= autoPublish) return 'pending_review';
  return 'pending_review';
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
    durationMs: 0,
  };

  const sourceConfig = parseSourceConfig(source.configJson);
  if (!isSourceChannelEnabled(sourceConfig)) {
    result.durationMs = Date.now() - started;
    return result;
  }

  try {
    if (source.sourceType === 'rsshub' && !getRsshubBaseUrl()) {
      result.errorMessage = 'RSSHUB_BASE_URL not configured — skip rsshub source';
      result.durationMs = Date.now() - started;
      return result;
    }

    const items = await fetchRssFeed(source.feedUrl, source.sourceType);
    result.fetchedCount = items.length;
    const policy = loadNewsIntelPolicy();
    const maxItems = policy.maxItemsPerSource;

    for (const item of items.slice(0, maxItems)) {
      const title = normalizeTitle(item.title);
      const canonicalUrl = normalizeNewsUrl(item.link);
      const snippet = item.contentSnippet ?? '';
      const publishedAt = parseRssPubDate(item.pubDate);

      const bodyText =
        (await extractArticleBody(canonicalUrl, item.content)) ?? snippet;

      const filterResult = filterByOpenclawRules({
        title,
        body: bodyText,
        publishedAt,
        canonicalUrl,
        sourceConfig,
      });
      if (!filterResult.pass) {
        result.skippedFiltered += 1;
        continue;
      }

      const dupReason = await shouldSkipAsDuplicate(title, snippet, canonicalUrl);
      if (dupReason) {
        result.skippedDup += 1;
        continue;
      }

      const bitableClass = classifyForBitable(title, bodyText);

      const enrich = await enrichArticleWithDify({
        title,
        bodyText,
        sourceName: source.name,
        fallbackCategory: 'other',
        fallbackPriority: 'medium',
      });

      const summary =
        enrich?.summary ?? buildSummaryFallback(title, bodyText, snippet);

      const relevanceScore =
        enrich?.relevanceScore ??
        Math.min(100, 40 + (bitableClass.hitCounts[bitableClass.bitableCategory] ?? 0) * 8);
      const priority =
        relevanceScore >= 75 ? 'high' : relevanceScore >= 55 ? 'medium' : 'low';
      const status = resolveArticleStatus(relevanceScore, priority);

      if (status === 'ignored') {
        result.skippedLowRelevance += 1;
        continue;
      }

      const { urlHash, contentHash } = buildDedupKeys(title, summary, canonicalUrl);

      const [inserted] = await db
        .insert(newsArticles)
        .values({
          sourceId: source.id,
          canonicalUrl,
          urlHash,
          title,
          summary,
          bodyText: bodyText || null,
          keyPoints: enrich?.keyPoints?.length ? enrich.keyPoints : null,
          category: 'other',
          bitableCategory: enrich?.category
            ? mapDifyCategoryToBitable(enrich.category)
            : bitableClass.bitableCategory,
          tags: enrich?.tags?.length ? enrich.tags : null,
          relevanceScore,
          priority,
          status,
          publishedAt: publishedAt ?? null,
          contentHash,
          affectedPlatforms: bitableClass.remarkPlatforms.length
            ? bitableClass.remarkPlatforms
            : null,
          affectedRegions: bitableClass.remarkCountries.length
            ? bitableClass.remarkCountries
            : null,
          ingestRunId: taskRunId ?? null,
        })
        .returning({ id: newsArticles.id });

      if (inserted) {
        result.newCount += 1;
        try {
          await syncArticleToBitable(inserted.id);
        } catch (err) {
          console.warn('[news-intel] Bitable sync failed for', inserted.id, err);
        }
      }
    }

    await db
      .update(newsSources)
      .set({
        lastFetchedAt: new Date(),
        lastError: null,
        consecutiveFailures: 0,
        updatedAt: new Date(),
      })
      .where(eq(newsSources.id, source.id));
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
    errorMessage: result.errorMessage ?? null,
    durationMs: result.durationMs,
  });

  return result;
}

async function alertFailedSources(sourceResults: IngestSourceResult[]): Promise<number> {
  const failed = sourceResults.filter(
    (r) => r.errorMessage && !r.errorMessage.includes('RSSHUB_BASE_URL not configured'),
  );
  if (!failed.length) return 0;

  const lines = failed.map((r) => `- ${r.sourceCode}: ${r.errorMessage}`).join('\n');
  await sendFeishuGroupMessage(`[跨境资讯] 信源采集失败 ${failed.length} 个\n${lines}`);
  return failed.length;
}

async function alertHighVolumePublished(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(newsArticles)
    .where(
      and(
        eq(newsArticles.status, 'published'),
        eq(newsArticles.priority, 'high'),
        gte(newsArticles.fetchedAt, since),
      ),
    );

  const count = rows[0]?.count ?? 0;
  if (count > 10) {
    await sendFeishuGroupMessage(
      `[跨境资讯] 今日高优已发布 ${count} 条，请检查过滤阈值是否过低`,
    );
  }
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
      bitableSynced: 0,
      alertsSent: 0,
      sourceResults: [],
    };
  }

  await ensureNewsSourcesSeeded();

  let sources = await listNewsSources();
  sources = sources.filter((s) => s.enabled);

  if (options?.sourceId) {
    sources = sources.filter((s) => s.id === options.sourceId);
  } else if (!options?.force) {
    sources = sources.filter((s) => isSourceDue(s));
  }

  const sourceResults: IngestSourceResult[] = [];
  for (const source of sources) {
    sourceResults.push(await processSource(source, options?.taskRunId));
  }

  const bitableSynced = await syncPendingArticlesToBitable(50);
  const alertsSent = await alertFailedSources(sourceResults);
  await alertHighVolumePublished();

  return {
    sourcesProcessed: sourceResults.length,
    totalNew: sourceResults.reduce((s, r) => s + r.newCount, 0),
    totalSkippedDup: sourceResults.reduce((s, r) => s + r.skippedDup, 0),
    totalSkippedLowRelevance: sourceResults.reduce((s, r) => s + r.skippedLowRelevance, 0),
    totalSkippedFiltered: sourceResults.reduce((s, r) => s + (r.skippedFiltered ?? 0), 0),
    bitableSynced,
    alertsSent,
    sourceResults,
  };
}

export async function listNewsArticles(params: {
  page: number;
  pageSize: number;
  category?: string;
  status?: string;
}) {
  const { page, pageSize, category, status } = params;
  const offset = (page - 1) * pageSize;

  const filters = [];
  if (category) filters.push(eq(newsArticles.category, category as never));
  if (status) filters.push(eq(newsArticles.status, status as never));

  const whereClause = filters.length ? and(...filters) : undefined;

  const items = await db
    .select({
      article: newsArticles,
      sourceName: newsSources.name,
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

  const [pendingReview] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(newsArticles)
    .where(eq(newsArticles.status, 'pending_review'));

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

  const sources = await listNewsSources();
  const healthySources = sources.filter((s) => s.enabled && (s.consecutiveFailures ?? 0) < 3).length;

  return {
    todayNew: todayNew?.count ?? 0,
    pendingReview: pendingReview?.count ?? 0,
    highPriorityToday: highPriority?.count ?? 0,
    sourceTotal: sources.length,
    sourceHealthy: healthySources,
  };
}
