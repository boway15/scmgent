import { eq } from 'drizzle-orm';
import { db, stockAlerts } from '@scm/db';
import { sendFeishuGroupMessage } from '../integrations/feishu.js';
import { formatAlertSummary } from '../lib/replenishment.js';
import { generateAlertFeishuMessage } from '../integrations/dify-workflows.js';
import { isAlertWorkflowEnabled } from '../integrations/dify.js';
import {
  computeAllInventoryHealth,
  healthToAlertType,
} from '../lib/inventory-health-service.js';
import {
  findOpenStockAlert,
  saveHealthSnapshots,
} from '../lib/inventory-health-store.js';
import { shouldDeferReplenishment } from '../lib/warehouse-domain.js';
import { getRegionPoolSnapshot } from '../lib/inventory-snapshot.js';

export async function runStockAlert() {
  const healthRows = await computeAllInventoryHealth();
  await saveHealthSnapshots(healthRows);

  const usPoolCache = new Map<string, Awaited<ReturnType<typeof getRegionPoolSnapshot>>>();
  const usRopCache = new Map<string, number>();

  const alerts: Array<{ skuCode: string; type: string; currentQty: number; threshold: number }> =
    [];

  for (const row of healthRows) {
    const alertType = healthToAlertType(row.healthStatus, row.effectiveQty);
    if (!alertType) continue;

    if (row.regionGroup === 'US') {
      if (!usPoolCache.has(row.skuId)) {
        usPoolCache.set(row.skuId, await getRegionPoolSnapshot(row.skuId, 'US'));
        const usRows = healthRows.filter(
          (h) => h.skuId === row.skuId && h.regionGroup === 'US',
        );
        usRopCache.set(
          row.skuId,
          usRows.reduce((s, r) => s + ((r.metrics.reorderPoint as number) ?? 0), 0),
        );
      }
      const pool = usPoolCache.get(row.skuId)!;
      const networkRop = usRopCache.get(row.skuId) ?? 0;
      const warehouseRop = (row.metrics.reorderPoint as number) ?? 0;
      if (
        shouldDeferReplenishment({
          warehouseEffective: row.effectiveQty,
          warehouseRop,
          networkEffective: pool.effectiveQty,
          networkRop,
        })
      ) {
        continue;
      }
    }

    const existing = await findOpenStockAlert({
      skuId: row.skuId,
      warehouseCode: row.warehouseCode,
      alertType,
    });
    if (existing) continue;

    const safetyQty = (row.metrics.safetyStockQty as number) ?? 0;
    const rop = (row.metrics.reorderPoint as number) ?? 0;
    const threshold = alertType === 'below_safety' ? safetyQty : rop || safetyQty;

    await db.insert(stockAlerts).values({
      skuId: row.skuId,
      warehouseCode: row.warehouseCode,
      alertType,
      currentQty: row.effectiveQty,
      safetyQty: threshold,
    });

    alerts.push({
      skuCode: `${row.skuCode}[${row.warehouseCode}]`,
      type: alertType,
      currentQty: row.effectiveQty,
      threshold,
    });
  }

  let difySummary = false;
  let summary = formatAlertSummary(alerts);

  if (alerts.length && isAlertWorkflowEnabled()) {
    try {
      const llmMessage = await generateAlertFeishuMessage(alerts, alerts.length);
      if (llmMessage) {
        summary = llmMessage;
        difySummary = true;
      }
    } catch (err) {
      console.warn('[stockAlert] Dify alert workflow skipped:', err);
    }
  }

  if (alerts.length) {
    try {
      await sendFeishuGroupMessage(`缺货预警 (${alerts.length} 条)\n${summary}`);
    } catch (err) {
      console.warn('[stockAlert] Feishu push skipped:', err);
    }
  }

  const engine = difySummary ? 'unified-health+dify-summary' : 'unified-health';

  return { alertCount: alerts.length, engine, difySummary, alerts };
}
