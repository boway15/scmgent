import { eq, desc, sql } from 'drizzle-orm';
import { db, reorderSuggestions, skus } from '@scm/db';
import { recordToolCall } from '../trace.js';

export async function getRecentReorderSuggestions(limit = 10, runId?: string) {
  const handler = async () => {
    return db
      .select({
        id: reorderSuggestions.id,
        skuCode: skus.code,
        warehouseCode: reorderSuggestions.warehouseCode,
        suggestedQty: reorderSuggestions.suggestedQty,
        reason: reorderSuggestions.reason,
        healthStatus: reorderSuggestions.healthStatus,
        status: reorderSuggestions.status,
        generatedAt: reorderSuggestions.generatedAt,
      })
      .from(reorderSuggestions)
      .innerJoin(skus, eq(reorderSuggestions.skuId, skus.id))
      .where(
        sql`${reorderSuggestions.status} = 'pending' AND ${reorderSuggestions.supersededAt} IS NULL`,
      )
      .orderBy(desc(reorderSuggestions.generatedAt))
      .limit(limit);
  };

  if (runId) {
    return recordToolCall(runId, 'getRecentReorderSuggestions', handler, { limit });
  }
  return handler();
}
