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
import { syncReplenishLightFromHealth } from '../lib/replenish-light-sync.js';
import { shouldDeferReplenishment } from '../lib/warehouse-domain.js';
import { getRegionPoolSnapshot } from '../lib/inventory-snapshot.js';
import { syncInventorySupplyLots } from '../lib/inventory-supply-lot-sync.js';
import { buildSkuWarehouseTimeline } from '../lib/inventory-timeline-service.js';
import { deriveHorizonAlerts } from '../lib/inventory-horizon-alerts.js';
import { DEFAULT_OVERSTOCK_THRESHOLD_DAYS } from '../lib/replenishment-coverage.js';

export async function runStockAlert() {
  try {
    await syncInventorySupplyLots();
  } catch (err) {
    console.warn('[stockAlert] supply lot sync skipped:', err);
  }

  const healthRows = await computeAllInventoryHealth();
  await saveHealthSnapshots(healthRows);
  await syncReplenishLightFromHealth(healthRows);

  const usPoolCache = new Map<string, Awaited<ReturnType<typeof getRegionPoolSnapshot>>>();
  const usRopCache = new Map<string, number>();

  const alerts: Array<{ skuCode: string; type: string; currentQty: number; threshold: number }> =
    [];

  for (const row of healthRows) {
    const alertType = healthToAlertType(row.healthStatus, row.effectiveQty);
    if (alertType) {
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
          // still evaluate horizon alerts below
        } else {
          const existing = await findOpenStockAlert({
            skuId: row.skuId,
            warehouseCode: row.warehouseCode,
            alertType,
          });
          if (!existing) {
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
        }
      } else {
        const existing = await findOpenStockAlert({
          skuId: row.skuId,
          warehouseCode: row.warehouseCode,
          alertType,
        });
        if (!existing) {
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
      }
    }

    // 时间轴 horizon 预警
    try {
      const safetyStockQty = (row.metrics.safetyStockQty as number) ?? 0;
      const { timeline } = await buildSkuWarehouseTimeline({
        skuId: row.skuId,
        warehouseCode: row.warehouseCode,
        avgDaily: row.avgDaily,
        totalLeadDays: row.totalLeadDays,
        safetyStockDays: row.coverage.safetyStockDays,
        safetyStockQty,
      });
      const horizonCandidates = deriveHorizonAlerts({
        points: timeline.points.map((p) => ({
          horizonDays: p.horizonDays,
          projectedBalance: p.confirmedEnding,
        })),
        coverageDays: row.coverageDays,
        totalLeadDays: row.totalLeadDays,
        overstockThresholdDays:
          row.coverage.overstockThresholdDays ?? DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
        stockoutDate: timeline.stockoutDateConfirmed,
        uncoverableByNewPo: timeline.uncoverableByNewPo,
      });

      for (const candidate of horizonCandidates) {
        const existing = await findOpenStockAlert({
          skuId: row.skuId,
          warehouseCode: row.warehouseCode,
          alertType: candidate.alertType,
          horizonDays: candidate.horizonDays,
        });
        if (existing) {
          await db
            .update(stockAlerts)
            .set({
              currentQty: candidate.projectedQty,
              projectedQty: candidate.projectedQty,
              projectedStockoutDate: candidate.projectedStockoutDate,
              safetyQty: candidate.thresholdQty,
              notifiedAt: new Date(),
            })
            .where(eq(stockAlerts.id, existing.id));
          continue;
        }
        await db.insert(stockAlerts).values({
          skuId: row.skuId,
          warehouseCode: row.warehouseCode,
          alertType: candidate.alertType,
          currentQty: candidate.projectedQty,
          safetyQty: candidate.thresholdQty,
          horizonDays: candidate.horizonDays,
          projectedQty: candidate.projectedQty,
          projectedStockoutDate: candidate.projectedStockoutDate,
        });
        alerts.push({
          skuCode: `${row.skuCode}[${row.warehouseCode}]`,
          type: `${candidate.alertType}${candidate.horizonDays != null ? `@${candidate.horizonDays}d` : ''}`,
          currentQty: candidate.projectedQty,
          threshold: candidate.thresholdQty,
        });
      }
    } catch (err) {
      console.warn(
        `[stockAlert] horizon skipped for ${row.skuCode}/${row.warehouseCode}:`,
        err,
      );
    }
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

  const engine = difySummary ? 'unified-health+timeline+dify-summary' : 'unified-health+timeline';

  return { alertCount: alerts.length, engine, difySummary, alerts };
}
