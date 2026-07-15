import { eq, desc, sql } from 'drizzle-orm';
import { db, stockAlerts, skus } from '@scm/db';
import { recordToolCall } from '../trace.js';

export async function getRecentOpenAlerts(limit = 10, runId?: string) {
  const handler = async () => {
    return db
      .select({
        id: stockAlerts.id,
        skuCode: skus.code,
        warehouseCode: stockAlerts.warehouseCode,
        alertType: stockAlerts.alertType,
        currentQty: stockAlerts.currentQty,
        safetyQty: stockAlerts.safetyQty,
        notifiedAt: stockAlerts.notifiedAt,
      })
      .from(stockAlerts)
      .innerJoin(skus, eq(stockAlerts.skuId, skus.id))
      .where(eq(stockAlerts.isResolved, false))
      .orderBy(desc(stockAlerts.notifiedAt))
      .limit(limit);
  };

  if (runId) {
    return recordToolCall(runId, 'getRecentOpenAlerts', handler, { limit });
  }
  return handler();
}

export async function countOpenAlerts(runId?: string) {
  const handler = async () => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(stockAlerts)
      .where(eq(stockAlerts.isResolved, false));
    return row?.count ?? 0;
  };

  if (runId) {
    return recordToolCall(runId, 'countOpenAlerts', handler);
  }
  return handler();
}
