import { and, eq, gte } from 'drizzle-orm';
import { db, newsArticles } from '@scm/db';
import { hashNewsContent, hashNewsUrl, titleSimilarity } from './url-normalize.js';

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

export async function isSimilarRecentTitle(title: string, days = 7): Promise<boolean> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ title: newsArticles.title })
    .from(newsArticles)
    .where(gte(newsArticles.fetchedAt, since))
    .limit(200);

  for (const row of rows) {
    if (titleSimilarity(title, row.title) >= 0.85) return true;
  }
  return false;
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
): Promise<'url' | 'content' | 'title' | null> {
  const { urlHash, contentHash } = buildDedupKeys(title, summary, url);
  if (await isDuplicateUrl(urlHash)) return 'url';
  if (await isDuplicateContentHash(contentHash)) return 'content';
  if (await isSimilarRecentTitle(title)) return 'title';
  return null;
}
