import { eq, desc, and, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, skus, inventoryHealthSnapshots } from '@scm/db';
import { requireMenu } from '../lib/rbac.js';
import { computeAllInventoryHealth } from '../lib/inventory-health-service.js';
import { getLatestHealthSnapshots, saveHealthSnapshots } from '../lib/inventory-health-store.js';

export const inventoryHealthRoutes = new Hono();

inventoryHealthRoutes.get('/inventory/health', requireMenu('inventory.overview'), async (c) => {
  const warehouseCode = c.req.query('warehouse');
  const healthStatus = c.req.query('healthStatus');
  const recompute = c.req.query('recompute') === 'true';

  if (recompute) {
    const rows = await computeAllInventoryHealth();
    await saveHealthSnapshots(rows);
  }

  const snapshots = await getLatestHealthSnapshots({
    warehouseCode: warehouseCode ?? undefined,
    healthStatus: healthStatus ?? undefined,
    limit: 500,
  });

  if (!snapshots.length) {
    return c.json({ items: [], message: 'No health snapshots; run replenishment forecast or recompute=true' });
  }

  const skuIds = [...new Set(snapshots.map((s) => s.skuId))];
  const skuMap = new Map(
    (
      await db
        .select({ id: skus.id, code: skus.code, name: skus.name })
        .from(skus)
        .where(inArray(skus.id, skuIds))
    ).map((s) => [s.id, s]),
  );

  const items = snapshots.map((s) => {
    const sku = skuMap.get(s.skuId);
    return {
      ...s,
      skuCode: sku?.code,
      skuName: sku?.name,
      coverageDays: s.coverageDays != null ? Number(s.coverageDays) : null,
      avgDaily: Number(s.avgDaily),
      latestOrderDays: s.latestOrderDays != null ? Number(s.latestOrderDays) : null,
    };
  });

  return c.json({ items, count: items.length });
});

inventoryHealthRoutes.post(
  '/inventory/health/recompute',
  requireMenu('inventory.overview'),
  async (c) => {
    const rows = await computeAllInventoryHealth();
    const count = await saveHealthSnapshots(rows);
    return c.json({ snapshotCount: count });
  },
);

inventoryHealthRoutes.get('/inventory/health/history', requireMenu('inventory.overview'), async (c) => {
  const skuId = c.req.query('skuId');
  const warehouseCode = c.req.query('warehouse');
  if (!skuId || !warehouseCode) {
    return c.json({ message: 'skuId and warehouse required' }, 400);
  }

  const rows = await db
    .select()
    .from(inventoryHealthSnapshots)
    .where(
      and(
        eq(inventoryHealthSnapshots.skuId, skuId),
        eq(inventoryHealthSnapshots.warehouseCode, warehouseCode),
      ),
    )
    .orderBy(desc(inventoryHealthSnapshots.computedAt))
    .limit(30);

  return c.json(rows);
});
