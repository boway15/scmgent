import { eq, desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, stockAlerts, skus } from '@scm/db';
import { formatAlertSummaryFromRows } from '../lib/replenishment.js';
import { requireMenu } from '../lib/rbac.js';

export const alertRoutes = new Hono();

alertRoutes.get('/alerts', async (c) => {
  const rows = await db
    .select({
      id: stockAlerts.id,
      skuId: stockAlerts.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      warehouseCode: stockAlerts.warehouseCode,
      alertType: stockAlerts.alertType,
      currentQty: stockAlerts.currentQty,
      safetyQty: stockAlerts.safetyQty,
      notifiedAt: stockAlerts.notifiedAt,
      isResolved: stockAlerts.isResolved,
    })
    .from(stockAlerts)
    .innerJoin(skus, eq(skus.id, stockAlerts.skuId))
    .orderBy(desc(stockAlerts.notifiedAt))
    .limit(100);

  const open = rows.filter((r) => !r.isResolved);
  const summary = formatAlertSummaryFromRows(open);

  return c.json({ items: rows, summary, openCount: open.length });
});

alertRoutes.patch('/alerts/:id/resolve', requireMenu('inventory.alert'), async (c) => {
  const [row] = await db
    .update(stockAlerts)
    .set({ isResolved: true, resolvedAt: new Date() })
    .where(eq(stockAlerts.id, c.req.param('id')))
    .returning();

  if (!row) return c.json({ message: 'Alert not found' }, 404);
  return c.json(row);
});
