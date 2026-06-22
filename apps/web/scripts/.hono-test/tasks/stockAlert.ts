import { eq, and } from 'drizzle-orm';
import { db, skus, safetyStockConfig, stockAlerts, warehouses } from '@scm/db';
import { sendFeishuGroupMessage } from '../integrations/feishu.js';
import { formatAlertSummary } from '../lib/replenishment.js';
import {
  getLatestInventorySnapshot,
  getRegionPoolSnapshot,
} from '../lib/inventory-snapshot.js';
import { shouldDeferReplenishment } from '../lib/warehouse-domain.js';

export async function runStockAlert() {
  const configRows = await db
    .select({
      skuId: skus.id,
      skuCode: skus.code,
      warehouseCode: safetyStockConfig.warehouseCode,
      reorderPoint: safetyStockConfig.reorderPoint,
      safetyStockQty: safetyStockConfig.safetyStockQty,
    })
    .from(safetyStockConfig)
    .innerJoin(skus, eq(skus.id, safetyStockConfig.skuId))
    .where(eq(skus.isActive, true));

  const whRegion = new Map(
    (await db.select({ code: warehouses.code, regionGroup: warehouses.regionGroup }).from(warehouses)).map(
      (w) => [w.code, w.regionGroup],
    ),
  );

  const alerts: Array<{ skuCode: string; type: string; currentQty: number; threshold: number }> =
    [];

  const usPoolCache = new Map<string, Awaited<ReturnType<typeof getRegionPoolSnapshot>>>();
  const usRopCache = new Map<string, number>();

  for (const row of configRows) {
    if (row.warehouseCode === 'ALL') continue;

    const snapshot = await getLatestInventorySnapshot(row.skuId, row.warehouseCode);
    const rop = row.reorderPoint ?? 0;
    const safetyQty = row.safetyStockQty ?? 0;
    if (rop <= 0 && safetyQty <= 0) continue;

    const region = whRegion.get(row.warehouseCode);
    if (region === 'US') {
      if (!usPoolCache.has(row.skuId)) {
        usPoolCache.set(row.skuId, await getRegionPoolSnapshot(row.skuId, 'US'));
        const usConfigs = configRows.filter(
          (r) => r.skuId === row.skuId && whRegion.get(r.warehouseCode) === 'US',
        );
        usRopCache.set(
          row.skuId,
          usConfigs.reduce((s, r) => s + (r.reorderPoint ?? 0), 0),
        );
      }
      const pool = usPoolCache.get(row.skuId)!;
      const networkRop = usRopCache.get(row.skuId) ?? 0;
      if (
        shouldDeferReplenishment({
          warehouseEffective: snapshot.effectiveQty,
          warehouseRop: rop,
          networkEffective: pool.effectiveQty,
          networkRop,
        })
      ) {
        continue;
      }
    }

    const currentQty = snapshot.effectiveQty;
    let alertType: 'stockout' | 'below_safety' | 'below_rop' | null = null;

    if (currentQty <= 0) alertType = 'stockout';
    else if (safetyQty > 0 && currentQty < safetyQty) alertType = 'below_safety';
    else if (rop > 0 && currentQty < rop) alertType = 'below_rop';

    if (!alertType) continue;

    await db.insert(stockAlerts).values({
      skuId: row.skuId,
      warehouseCode: row.warehouseCode,
      alertType,
      currentQty,
      safetyQty: safetyQty || rop,
    });

    alerts.push({
      skuCode: `${row.skuCode}[${row.warehouseCode}]`,
      type: alertType,
      currentQty,
      threshold: rop || safetyQty,
    });
  }

  if (alerts.length) {
    const summary = formatAlertSummary(alerts);
    try {
      await sendFeishuGroupMessage(`缺货预警 (${alerts.length} 条)\n${summary}`);
    } catch (err) {
      console.warn('[stockAlert] Feishu push skipped:', err);
    }
  }

  return { alertCount: alerts.length, engine: 'local-per-warehouse', alerts };
}
