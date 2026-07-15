import { eq } from 'drizzle-orm';
import { db, newsArticles, newsSources } from '@scm/db';
import {
  createBitableRecord,
  updateBitableRecord,
} from '../../integrations/feishu-bitable.js';
import {
  getNewsBitableAppToken,
  getNewsBitableTableId,
  isNewsBitableConfigured,
} from './config.js';
import { mapArticleToBitableFields } from './bitable-mapper.js';

export async function syncArticleToBitable(articleId: string): Promise<string | null> {
  if (!isNewsBitableConfigured()) return null;

  const appToken = getNewsBitableAppToken()!;
  const tableId = getNewsBitableTableId()!;

  const [row] = await db
    .select({
      article: newsArticles,
      sourceName: newsSources.name,
    })
    .from(newsArticles)
    .innerJoin(newsSources, eq(newsArticles.sourceId, newsSources.id))
    .where(eq(newsArticles.id, articleId))
    .limit(1);

  if (!row) throw new Error(`Article not found: ${articleId}`);
  if (row.article.status === 'ignored') return null;

  const fields = mapArticleToBitableFields(row.article, { name: row.sourceName }, {
    remarkPlatforms: row.article.affectedPlatforms ?? [],
    remarkCountries: row.article.affectedRegions ?? [],
  });

  let recordId = row.article.bitableRecordId ?? undefined;
  if (recordId) {
    await updateBitableRecord(appToken, tableId, recordId, fields);
  } else {
    recordId = await createBitableRecord(appToken, tableId, fields);
  }

  await db
    .update(newsArticles)
    .set({
      bitableRecordId: recordId,
      bitableSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(newsArticles.id, articleId));

  return recordId;
}

export async function syncPendingArticlesToBitable(limit = 50): Promise<number> {
  if (!isNewsBitableConfigured()) return 0;

  const rows = await db
    .select({
      id: newsArticles.id,
      status: newsArticles.status,
      bitableRecordId: newsArticles.bitableRecordId,
    })
    .from(newsArticles)
    .limit(limit * 3);

  let synced = 0;
  for (const row of rows) {
    if (row.status === 'ignored') continue;
    if (row.bitableRecordId) continue;
    await syncArticleToBitable(row.id);
    synced += 1;
    if (synced >= limit) break;
  }

  return synced;
}
