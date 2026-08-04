import { and, desc, eq, gte, or, sql } from 'drizzle-orm';
import { db, newsArticles, newsIngestLogs, newsSources, taskRuns } from '@scm/db';
import { buildSummaryFallback, buildRelevanceProbeText, extractArticleBody } from './body-extract.js';
import { syncPendingArticlesToBitable } from './bitable-sync.js';
import {
  classifyNewsArticle,
  evaluateNewsRelevance,
  isPredominantlyEnglish,
} from './content-filter.js';
import {
  getNewsIntelMinRelevance,
  getNewsIntelRunBudgetMs,
  isNewsIntelEnabled,
} from './config.js';
import { buildDedupKeys, shouldSkipAsDuplicate } from './dedup.js';
import {
  enrichArticleWithDify,
  isNewsIntelEnrichEnabled,
} from './enrich-dify.js';
import { fetchRssFeed, parseRssPubDate } from './rss-fetcher.js';
import {
  ensureNewsSourcesSeeded,
  isCollectableNewsSourceType,
  isLegacyGoogleNewsQueryFeedUrl,
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
  NewsCategory,
  NewsSourceType,
} from './types.js';
import { normalizeNewsUrl, normalizeTitle } from './url-normalize.js';

const HARD_DISCARD_REASONS = new Set([
  'outside_lookback_window',
  'negative_keyword',
  'source_exclude_keyword',
  'source_include_keyword_miss',
]);
const BODY_EXTRACTION_STAGE_BUDGET_MS = 75_000;
const DIFY_STAGE_BUDGET_MS = 125_000;

let newsIngestRunning = false;

export class NewsIngestBusyError extends Error {
  constructor() {
    super('News ingest is already running');
    this.name = 'NewsIngestBusyError';
  }
}

export function decideCandidateDisposition(input: {
  filterReason?: string;
  relevanceScore: number;
}): 'discard' | 'pending_review' {
  return input.filterReason && HARD_DISCARD_REASONS.has(input.filterReason)
    ? 'discard'
    : 'pending_review';
}

export function resolveIngestItemLimit(input: {
  sourceType: NewsSourceType;
  maxItemsPerQuery?: number;
  maxItemsPerSource: number;
}): number {
  return input.sourceType === 'query_feed'
    ? input.maxItemsPerQuery ?? input.maxItemsPerSource
    : input.maxItemsPerSource;
}

export function buildNewsDiscoveryMetadata(input: {
  sourceType: NewsSourceType;
  isOfficial: boolean;
  canonicalUrl: string;
  discoveryQuery?: string;
  sourceUrl?: string;
}): {
  discoveryChannel: 'query_feed' | 'native_feed' | 'official_site';
  discoveryQuery: string | null;
  sourceDomain: string | null;
  aggregatorOnly: boolean;
} {
  let sourceDomain: string | null = null;
  let canonicalDomain: string | null = null;
  try {
    sourceDomain = new URL(input.sourceUrl ?? input.canonicalUrl).hostname.toLowerCase();
    canonicalDomain = new URL(input.canonicalUrl).hostname.toLowerCase();
  } catch {
    // Invalid URLs remain domain-less and are handled by the existing fetch flow.
  }
  return {
    discoveryChannel:
      input.sourceType === 'query_feed'
        ? 'query_feed'
        : input.isOfficial
          ? 'official_site'
          : 'native_feed',
    discoveryQuery: input.discoveryQuery ?? null,
    sourceDomain,
    aggregatorOnly: canonicalDomain === 'news.google.com',
  };
}

export function tryAcquireNewsIngestLock(): (() => void) | null {
  if (newsIngestRunning) return null;
  newsIngestRunning = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    newsIngestRunning = false;
  };
}

export function isNewsIngestDeadlineExceeded(deadlineAt: number, now = Date.now()): boolean {
  return now >= deadlineAt;
}

export function shouldContinueNewsIngest(deadlineAt: number, now = Date.now()): boolean {
  return !isNewsIngestDeadlineExceeded(deadlineAt, now);
}

export function hasNewsIngestStageBudget(
  deadlineAt: number,
  requiredMs: number,
  now = Date.now(),
): boolean {
  return now + requiredMs < deadlineAt;
}

export function isPublishedPendingSync(article: {
  status: string;
  bitableSyncStatus: string | null;
}): boolean {
  return (
    article.status === 'published' &&
    (article.bitableSyncStatus === 'pending' || article.bitableSyncStatus === 'failed')
  );
}

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

export function isCompletedSuccessfulIngestTaskRunToday(
  run: {
    taskName: string;
    status: string;
    startedAt: Date | null;
    finishedAt: Date | null;
  },
  now = new Date(),
): boolean {
  if (
    run.taskName !== 'news_ingest' ||
    run.status !== 'success' ||
    !run.startedAt ||
    !run.finishedAt
  ) {
    return false;
  }
  const today = shanghaiDateKey(now);
  return (
    shanghaiDateKey(run.startedAt) === today &&
    shanghaiDateKey(run.finishedAt) === today
  );
}

export async function hasSuccessfulIngestToday(): Promise<boolean> {
  const recent = await db
    .select({
      taskName: taskRuns.taskName,
      status: taskRuns.status,
      startedAt: taskRuns.startedAt,
      finishedAt: taskRuns.finishedAt,
    })
    .from(taskRuns)
    .where(eq(taskRuns.taskName, 'news_ingest'))
    .orderBy(desc(taskRuns.startedAt))
    .limit(200);

  return recent.some((run) => isCompletedSuccessfulIngestTaskRunToday(run));
}

async function processSource(
  source: typeof newsSources.$inferSelect,
  taskRunId?: string,
  deadlineAt = Number.POSITIVE_INFINITY,
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
    const items = await fetchRssFeed(source.feedUrl, source.sourceType);
    result.fetchedCount = items.length;
    const policy = loadNewsIntelPolicy();
    const maxItems = resolveIngestItemLimit({
      sourceType: source.sourceType,
      maxItemsPerQuery: sourceConfig.maxItemsPerQuery,
      maxItemsPerSource: policy.maxItemsPerSource,
    });
    const minRelevance = getNewsIntelMinRelevance();
    const filterReasons: Record<string, number> = {};

    for (const item of items.slice(0, maxItems)) {
      if (isNewsIngestDeadlineExceeded(deadlineAt)) {
        result.errorMessage = 'run_budget_exceeded';
        break;
      }
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
        const disposition = decideCandidateDisposition({
          filterReason: relevance.reason,
          relevanceScore: 0,
        });
        bumpReason(filterReasons, relevance.reason || 'filtered');
        if (disposition === 'discard') {
          result.skippedFiltered += 1;
          continue;
        }
      }

      if (!hasNewsIngestStageBudget(deadlineAt, BODY_EXTRACTION_STAGE_BUDGET_MS)) {
        result.errorMessage = 'run_budget_exceeded';
        break;
      }
      const bodyText =
        (await extractArticleBody(canonicalUrl, item.content)) ?? snippet;
      if (!shouldContinueNewsIngest(deadlineAt)) {
        result.errorMessage = 'run_budget_exceeded';
        break;
      }

      const english = isPredominantlyEnglish(titleOriginal, bodyText || probeText);
      const classification = classifyNewsArticle(titleOriginal, probeText);

      const enrich =
        !isNewsIntelEnrichEnabled() ||
        hasNewsIngestStageBudget(deadlineAt, DIFY_STAGE_BUDGET_MS)
          ? await enrichArticleWithDify({
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
            })
          : null;
      if (!shouldContinueNewsIngest(deadlineAt)) {
        result.errorMessage = 'run_budget_exceeded';
        break;
      }

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
        ...(!relevance.pass && relevance.reason ? [relevance.reason] : []),
        ...(relevanceScore < minRelevance ? ['low_relevance'] : []),
        ...classification.filterHits,
      ].join('; ');

      const { urlHash, contentHash } = buildDedupKeys(displayTitle, summary, canonicalUrl);
      const discovery = buildNewsDiscoveryMetadata({
        sourceType: source.sourceType,
        isOfficial,
        canonicalUrl,
        discoveryQuery: sourceConfig.discoveryQuery,
        sourceUrl: item.sourceUrl,
      });

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
          status: 'pending_review',
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
          ...discovery,
        })
        .returning({ id: newsArticles.id });

      if (inserted) {
        result.newCount += 1;
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

    if (filterNote && !result.errorMessage) {
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

async function runNewsIngestInner(options?: {
  taskRunId?: string;
  force?: boolean;
  sourceId?: string;
}): Promise<IngestRunResult> {
  const deadlineAt = Date.now() + getNewsIntelRunBudgetMs();

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
  sources = sources.filter(
    (source) =>
      source.enabled &&
      isCollectableNewsSourceType(source.sourceType) &&
      !(
        source.sourceType === 'rss' &&
        isLegacyGoogleNewsQueryFeedUrl(source.feedUrl)
      ),
  );
  if (options?.sourceId) {
    sources = sources.filter((s) => s.id === options.sourceId);
  }

  const sourceResults: IngestSourceResult[] = [];
  let stoppedByBudget = false;
  for (const source of sources) {
    if (isNewsIngestDeadlineExceeded(deadlineAt)) {
      stoppedByBudget = true;
      break;
    }
    const result = await processSource(source, options?.taskRunId, deadlineAt);
    sourceResults.push(result);
    if (result.errorMessage === 'run_budget_exceeded') {
      stoppedByBudget = true;
      break;
    }
  }

  if (isNewsIngestDeadlineExceeded(deadlineAt)) {
    stoppedByBudget = true;
  }
  const bitableSynced = stoppedByBudget
    ? 0
    : await syncPendingArticlesToBitable(50, deadlineAt);
  if (isNewsIngestDeadlineExceeded(deadlineAt)) {
    stoppedByBudget = true;
  }
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
    stoppedByBudget,
    sourceResults,
  };
}

export async function runNewsIngest(options?: {
  taskRunId?: string;
  force?: boolean;
  sourceId?: string;
}): Promise<IngestRunResult> {
  const release = tryAcquireNewsIngestLock();
  if (!release) throw new NewsIngestBusyError();
  try {
    return await runNewsIngestInner(options);
  } finally {
    release();
  }
}

export async function listNewsArticles(params: {
  page: number;
  pageSize: number;
  category?: string;
  topicCategory?: string;
  status?: string;
  discoveryChannel?: string;
  sourceDomain?: string;
}) {
  const {
    page,
    pageSize,
    category,
    topicCategory,
    status,
    discoveryChannel,
    sourceDomain,
  } = params;
  const offset = (page - 1) * pageSize;

  const filters = [];
  if (category) filters.push(eq(newsArticles.category, category as never));
  if (topicCategory) filters.push(eq(newsArticles.topicCategory, topicCategory));
  if (status) filters.push(eq(newsArticles.status, status as never));
  if (discoveryChannel) filters.push(eq(newsArticles.discoveryChannel, discoveryChannel));
  if (sourceDomain) filters.push(eq(newsArticles.sourceDomain, sourceDomain));

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
    category: NewsCategory;
    businessValidity: NewsBusinessValidity;
    bitableSyncStatus: NewsBitableSyncStatus;
    bitableSyncError: string | null;
    reviewedAt: Date | null;
    reviewedBy: string | null;
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
    .where(
      and(
        eq(newsArticles.status, 'published'),
        or(
          eq(newsArticles.bitableSyncStatus, 'pending'),
          eq(newsArticles.bitableSyncStatus, 'failed'),
        ),
      ),
    );

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
