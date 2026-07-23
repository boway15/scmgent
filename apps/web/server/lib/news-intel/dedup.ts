import { and, desc, eq, gte } from 'drizzle-orm';
import { db, newsArticles, newsSources } from '@scm/db';
import { hashNewsContent, hashNewsUrl, titleSimilarity } from './url-normalize.js';
import type { NewsSourceTier } from './types.js';

const TIER_RANK: Record<NewsSourceTier, number> = {
  tier_1: 3,
  tier_2: 2,
  tier_3: 1,
};

export async function isDuplicateUrl(urlHash: string): Promise<boolean> {
  const [row] = await db
    .select({ id: newsArticles.id })
    .from(newsArticles)
    .where(eq(newsArticles.urlHash, urlHash))
    .limit(1);
  return Boolean(row);
}

export async function isDuplicateContentHash(contentHash: string): Promise<boolean> {
  const [row] = await db
    .select({ id: newsArticles.id })
    .from(newsArticles)
    .where(eq(newsArticles.contentHash, contentHash))
    .limit(1);
  return Boolean(row);
}

export type SimilarArticleCandidate = {
  id: string;
  title: string;
  sourceTier: NewsSourceTier | null;
  isOfficialSource: boolean;
  publishedAt: Date | null;
};

export async function findSimilarRecentArticles(
  title: string,
  days = 7,
): Promise<SimilarArticleCandidate[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: newsArticles.id,
      title: newsArticles.title,
      titleZh: newsArticles.titleZh,
      sourceTier: newsArticles.sourceTier,
      isOfficialSource: newsArticles.isOfficialSource,
      publishedAt: newsArticles.publishedAt,
    })
    .from(newsArticles)
    .where(gte(newsArticles.fetchedAt, since))
    .orderBy(desc(newsArticles.fetchedAt))
    .limit(200);

  return rows
    .filter((row) => titleSimilarity(title, row.titleZh ?? row.title) >= 0.85)
    .map((row) => ({
      id: row.id,
      title: row.titleZh ?? row.title,
      sourceTier: row.sourceTier,
      isOfficialSource: row.isOfficialSource,
      publishedAt: row.publishedAt,
    }));
}

export async function isSimilarRecentTitle(title: string, days = 7): Promise<boolean> {
  const matches = await findSimilarRecentArticles(title, days);
  return matches.length > 0;
}

export function preferHigherTierSource(params: {
  incomingTier: NewsSourceTier;
  incomingOfficial: boolean;
  existingTier: NewsSourceTier | null;
  existingOfficial: boolean;
}): 'keep_existing' | 'replace_with_incoming' {
  const incomingRank = TIER_RANK[params.incomingTier] + (params.incomingOfficial ? 0.5 : 0);
  const existingRank =
    TIER_RANK[params.existingTier ?? 'tier_3'] + (params.existingOfficial ? 0.5 : 0);
  return incomingRank > existingRank ? 'replace_with_incoming' : 'keep_existing';
}

export function buildDedupKeys(title: string, summary: string, url: string) {
  return {
    urlHash: hashNewsUrl(url),
    contentHash: hashNewsContent(title, summary),
  };
}

export async function shouldSkipAsDuplicate(
  title: string,
  summary: string,
  url: string,
  options?: {
    incomingTier?: NewsSourceTier;
    incomingOfficial?: boolean;
  },
): Promise<'url' | 'content' | 'title' | null> {
  const { urlHash, contentHash } = buildDedupKeys(title, summary, url);
  if (await isDuplicateUrl(urlHash)) return 'url';
  if (await isDuplicateContentHash(contentHash)) return 'content';

  const similar = await findSimilarRecentArticles(title);
  if (!similar.length) return null;

  if (options?.incomingTier) {
    const decision = preferHigherTierSource({
      incomingTier: options.incomingTier,
      incomingOfficial: options.incomingOfficial === true,
      existingTier: similar[0].sourceTier,
      existingOfficial: similar[0].isOfficialSource,
    });
    if (decision === 'replace_with_incoming') {
      // 更高可信度来源：允许写入，由调用方标记合并追溯；此处不跳过。
      return null;
    }
  }

  return 'title';
}

export { and, eq };
