import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, newsArticles, newsSources } from '@scm/db';
import {
  createBitableRecord,
  listBitableFields,
  pickExistingBitableFields,
  updateBitableRecord,
} from '../../integrations/feishu-bitable.js';
import {
  getNewsBitableAppToken,
  getNewsBitableV2TableId,
  isNewsBitableConfigured,
} from './config.js';
import { mapArticleToBitableFields } from './bitable-mapper.js';
import { ensureNewsIntelBitableSchema } from './bitable-schema.js';

let schemaEnsuredForTable: string | null = null;

async function ensureSchemaOnce(appToken: string, tableId: string): Promise<void> {
  if (schemaEnsuredForTable === tableId) return;
  await ensureNewsIntelBitableSchema({ appToken, tableId });
  schemaEnsuredForTable = tableId;
}

export async function syncArticleToBitable(articleId: string): Promise<string | null> {
  if (!isNewsBitableConfigured()) {
    await db
      .update(newsArticles)
      .set({
        bitableSyncStatus: 'failed',
        bitableSyncError: 'FEISHU_BITABLE_TABLE_NEWS_INTEL_V2 not configured',
        updatedAt: new Date(),
      })
      .where(eq(newsArticles.id, articleId));
    return null;
  }

  const appToken = getNewsBitableAppToken()!;
  const tableId = getNewsBitableV2TableId()!;
  await ensureSchemaOnce(appToken, tableId);

  const [row] = await db
    .select({
      article: newsArticles,
      sourceName: newsSources.name,
      sourceTier: newsSources.sourceTier,
      isOfficial: newsSources.isOfficial,
    })
    .from(newsArticles)
    .innerJoin(newsSources, eq(newsArticles.sourceId, newsSources.id))
    .where(eq(newsArticles.id, articleId))
    .limit(1);

  if (!row) throw new Error(`Article not found: ${articleId}`);
  if (row.article.status === 'ignored') return null;

  const mapped = mapArticleToBitableFields(row.article, {
    name: row.sourceName,
    sourceTier: row.sourceTier,
    isOfficial: row.isOfficial,
  });
  const existingNames = (await listBitableFields(appToken, tableId)).map((f) => f.field_name);
  const fields = pickExistingBitableFields(mapped, existingNames);

  try {
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
        bitableSyncStatus: 'synced',
        bitableSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(newsArticles.id, articleId));

    return recordId;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bitable sync failed';
    await db
      .update(newsArticles)
      .set({
        bitableSyncStatus: 'failed',
        bitableSyncError: message,
        updatedAt: new Date(),
      })
      .where(eq(newsArticles.id, articleId));
    throw err;
  }
}

export async function syncPendingArticlesToBitable(limit = 50): Promise<number> {
  if (!isNewsBitableConfigured()) return 0;

  const rows = await db
    .select({
      id: newsArticles.id,
      status: newsArticles.status,
      bitableSyncStatus: newsArticles.bitableSyncStatus,
    })
    .from(newsArticles)
    .where(
      and(
        inArray(newsArticles.bitableSyncStatus, ['pending', 'failed']),
      ),
    )
    .orderBy(asc(newsArticles.updatedAt))
    .limit(limit);

  let synced = 0;
  for (const row of rows) {
    if (row.status === 'ignored') continue;
    try {
      await syncArticleToBitable(row.id);
      synced += 1;
    } catch {
      // 错误已写入 bitable_sync_error
    }
  }

  return synced;
}
