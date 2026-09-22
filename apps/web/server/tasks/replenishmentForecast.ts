import { eq, and, desc, inArray } from 'drizzle-orm';
import {
  db,
  skus,
  reorderSuggestions,
  safetyStockConfig,
  warehouses,
  spus,
  forecastAccuracyMonthly,
} from '@scm/db';
import { applyMoq, calcReplenishment, resolveEffectiveMoq } from '../lib/replenishment.js';
import { formatCoverageReason, type InventoryHealth } from '../lib/replenishment-coverage.js';
import { getRegionPoolSnapshot } from '../lib/inventory-snapshot.js';
import {
  PLANNING_INVENTORY_DEDUPE_MODE,
  resolveInventoryPosition,
} from '../lib/inventory-position.js';
import {
  shouldDeferReplenishment,
  splitQtyByDailyShare,
  US_WAREHOUSE_CODES,
} from '../lib/warehouse-domain.js';
import {
  normalizeReplenishLight,
  shouldReplenishByLight,
  type ReplenishLight,
} from '../lib/replenish-light.js';
import { enhanceReplenishmentReasons } from '../integrations/dify-workflows.js';
import { isReplenishmentWorkflowEnabled } from '../integrations/dify.js';
import {
  computeSkuWarehouseHealth,
  type SkuHealthRow,
} from '../lib/inventory-health-service.js';
import {
  saveHealthSnapshots,
  supersedePendingSuggestions,
} from '../lib/inventory-health-store.js';
import { syncReplenishLightFromHealth } from '../lib/replenish-light-sync.js';
import { loadDailySalesBySkuIds } from '../lib/sales-history-query.js';
import { buildSkuWarehouseTimeline } from '../lib/inventory-timeline-service.js';
import { syncInventorySupplyLots } from '../lib/inventory-supply-lot-sync.js';
import {
  calcConfirmedCoverageDays,
  calcTimelineDecisionHealth,
  needsReplenishmentByHealth,
} from '../lib/inventory-light.js';
import { DEFAULT_OVERSTOCK_THRESHOLD_DAYS } from '../lib/replenishment-coverage.js';
import { evaluateDemandGate } from '../lib/planning-demand-gate.js';
import { buildLatePoActions } from '../lib/planning-late-po-actions.js';

async function upsertSafetyStock(
  skuId: string,
  warehouseCode: string,
  calc: ReturnType<typeof calcReplenishment>,
) {
  const [existing] = await db
    .select()
    .from(safetyStockConfig)
    .where(
      and(eq(safetyStockConfig.skuId, skuId), eq(safetyStockConfig.warehouseCode, warehouseCode)),
    )
    .limit(1);

  if (existing) {
    await db
      .update(safetyStockConfig)
      .set({
        safetyStockQty: calc.safetyStockQty,
        reorderPoint: calc.reorderPoint,
        reorderQty: calc.reorderQty,
        calcMethod: 'eoq',
        lastCalcAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(safetyStockConfig.id, existing.id));
  } else {
    await db.insert(safetyStockConfig).values({
      skuId,
      warehouseCode,
      safetyStockQty: calc.safetyStockQty,
      reorderPoint: calc.reorderPoint,
      reorderQty: calc.reorderQty,
      calcMethod: 'eoq',
      lastCalcAt: new Date(),
    });
  }
}

async function loadPolicyMap(skuId: string) {
  const rows = await db
    .select()
    .from(safetyStockConfig)
    .where(eq(safetyStockConfig.skuId, skuId));
  return new Map(rows.map((row) => [row.warehouseCode, row]));
}

export async function runReplenishmentForecast() {
  try {
    await syncInventorySupplyLots();
  } catch (err) {
    console.warn('[replenishmentForecast] supply lot sync skipped:', err);
  }

  const spuMoqMap = new Map(
    (await db.select({ id: spus.id, moq: spus.moq }).from(spus)).map((s) => [s.id, s.moq]),
  );

  const activeSkus = await db
    .select({
      id: skus.id,
      code: skus.code,
      spuId: skus.spuId,
      moq: skus.moq,
      merchantCode: skus.merchantCode,
      replenishLight: skus.replenishLight,
      leadTimeDays: skus.leadTimeDays,
      unitCost: skus.unitCost,
    })
    .from(skus)
    .where(eq(skus.isActive, true));

  const whRows = await db
    .select({
      code: warehouses.code,
      regionGroup: warehouses.regionGroup,
      countryCode: warehouses.countryCode,
    })
    .from(warehouses)
    .where(eq(warehouses.isActive, true))
    .orderBy(warehouses.sortOrder);

  if (!activeSkus.length || !whRows.length) {
    return { suggestionCount: 0, snapshotCount: 0, message: 'No active SKUs or warehouses' };
  }

  const salesBySkuId = await loadDailySalesBySkuIds(activeSkus.map((sku) => sku.id));

  const accuracyBySku = new Map<string, number>();
  const skuIds = activeSkus.map((s) => s.id);
  if (skuIds.length > 0) {
    const accuracyRows = await db
      .select({
        skuId: forecastAccuracyMonthly.skuId,
        mape: forecastAccuracyMonthly.mape,
        forecastYear: forecastAccuracyMonthly.forecastYear,
        month: forecastAccuracyMonthly.month,
      })
      .from(forecastAccuracyMonthly)
      .where(inArray(forecastAccuracyMonthly.skuId, skuIds))
      .orderBy(
        desc(forecastAccuracyMonthly.forecastYear),
        desc(forecastAccuracyMonthly.month),
      );
    for (const row of accuracyRows) {
      if (accuracyBySku.has(row.skuId)) continue;
      const mape = row.mape != null ? Number(row.mape) : NaN;
      if (Number.isFinite(mape)) accuracyBySku.set(row.skuId, mape);
    }
  }

  let count = 0;
  const healthRows: SkuHealthRow[] = [];
  const results: Array<{
    skuCode: string;
    warehouseCode: string;
    suggestedQty: number;
    healthStatus: InventoryHealth;
    reason: string;
  }> = [];
  const pending: Array<{
    skuId: string;
    skuCode: string;
    spuId: string | null;
    replenishLight: ReplenishLight;
    warehouseCode: string;
    suggestedQty: number;
    suggestedDate: string;
    reason: string;
    healthStatus: InventoryHealth;
    coverageDays: number;
    totalLeadDays: number;
    latestOrderDays: number;
    metrics: Record<string, unknown>;
  }> = [];

  for (const sku of activeSkus) {
    const replenishLight = normalizeReplenishLight(sku.replenishLight);
    const effectiveMoq = resolveEffectiveMoq(
      sku.moq,
      sku.spuId ? spuMoqMap.get(sku.spuId) : null,
    );
    const policyMap = await loadPolicyMap(sku.id);
    const forecastByStation = new Map<
      string,
      { map: Map<string, number>; lifecycle?: string }
    >();

    const salesRows = salesBySkuId.get(sku.id) ?? [];

    const dailyByWh: Record<string, number> = {};
    const coverageByWh: Record<string, SkuHealthRow['coverage']> = {};
    const networkRopByRegion: Record<string, number> = {};

    for (const wh of whRows) {
      const health = await computeSkuWarehouseHealth({
        sku,
        warehouse: wh,
        salesRows,
        policyMap,
        forecastByStation,
        moq: effectiveMoq || undefined,
      });
      healthRows.push(health);
      dailyByWh[wh.code] = health.avgDaily;
      coverageByWh[wh.code] = health.coverage;

      const eoqCalc = calcReplenishment({
        sales: salesRows
          .filter((s) => s.warehouseCode === wh.code)
          .map((s) => ({ qtySold: s.qtySold, saleDate: String(s.saleDate) })),
        leadTimeDays: health.totalLeadDays,
        unitCost: sku.unitCost ? Number(sku.unitCost) : 1,
      });
      await upsertSafetyStock(sku.id, wh.code, eoqCalc);
      networkRopByRegion[wh.regionGroup] =
        (networkRopByRegion[wh.regionGroup] ?? 0) + eoqCalc.reorderPoint;
    }

    const usPool = await getRegionPoolSnapshot(sku.id, 'US');
    const usNetworkRop = networkRopByRegion.US ?? 0;
    const usNetworkDaily = US_WAREHOUSE_CODES.reduce(
      (sum, code) => sum + (dailyByWh[code] ?? 0),
      0,
    );
    const usNetworkCoverage =
      usNetworkDaily > 0 ? usPool.effectiveQty / usNetworkDaily : Number.POSITIVE_INFINITY;

    for (const wh of whRows) {
      const health = healthRows.find(
        (h) => h.skuId === sku.id && h.warehouseCode === wh.code,
      )!;
      const coverage = coverageByWh[wh.code];
      const coverageHealthStatus = health.healthStatus;
      health.metrics.coverageHealthStatus = coverageHealthStatus;
      health.metrics.coverageDaysShadow = health.coverageDays;

      // 灰灯不进建议；覆盖天数灯降为影子，不再决定是否出建议
      if (coverageHealthStatus === 'gray') {
        continue;
      }

      const position = await resolveInventoryPosition({
        skuId: sku.id,
        warehouseCode: wh.code,
        dedupeMode: PLANNING_INVENTORY_DEDUPE_MODE,
      });
      const eoqRop = (health.metrics.reorderPoint as number) ?? 0;

      let suggestedQty = coverage.suggestedQty;
      let suggestedDate = coverage.suggestedDate;
      let decisionHealth = coverageHealthStatus;
      let confirmedCoverageDays = health.coverageDays;
      let deferUs = false;
      if (wh.regionGroup === 'US') {
        deferUs = shouldDeferReplenishment({
          warehouseEffective: position.effectiveQty,
          warehouseRop: eoqRop,
          networkEffective: usPool.effectiveQty,
          networkRop: usNetworkRop,
        });
        if (deferUs && usNetworkCoverage >= coverage.targetCoverageDays) {
          health.metrics.usNetworkDeferred = true;
        } else {
          deferUs = false;
        }
      }

      try {
        const safetyStockQty = (health.metrics.safetyStockQty as number) ?? 0;
        const timelineResult = await buildSkuWarehouseTimeline({
          skuId: sku.id,
          warehouseCode: wh.code,
          avgDaily: health.avgDaily,
          totalLeadDays: health.totalLeadDays,
          safetyStockDays: health.coverage.safetyStockDays,
          safetyStockQty,
          moq: effectiveMoq || undefined,
        });
        suggestedQty = timelineResult.suggestedQty;
        suggestedDate =
          timelineResult.timeline.reorderDate ?? timelineResult.timeline.today;
        const day0 = timelineResult.timeline.points.find((p) => p.horizonDays === 0);
        confirmedCoverageDays = calcConfirmedCoverageDays({
          today: timelineResult.timeline.today,
          stockoutDateConfirmed: timelineResult.timeline.stockoutDateConfirmed,
          confirmedEndingToday: day0?.confirmedEnding ?? 0,
          avgDaily: health.avgDaily,
        });
        decisionHealth = calcTimelineDecisionHealth({
          today: timelineResult.timeline.today,
          totalLeadDays: health.totalLeadDays,
          safetyStockDays: health.coverage.safetyStockDays,
          overstockThresholdDays:
            health.coverage.overstockThresholdDays ?? DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
          suggestedQty: timelineResult.suggestedQty,
          uncoverableByNewPo: timelineResult.timeline.uncoverableByNewPo,
          stockoutDateConfirmed: timelineResult.timeline.stockoutDateConfirmed,
          safetyBreachDateConfirmed: timelineResult.timeline.safetyBreachDateConfirmed,
          confirmedCoverageDays,
          lifecycle: health.lifecycle,
          effectiveQty: position.effectiveQty,
          avgDaily: health.avgDaily,
        });
        health.metrics.timelineSuggestedQty = timelineResult.suggestedQty;
        health.metrics.timelineSuggestedQtyGross = timelineResult.timeline.suggestedQtyGross;
        health.metrics.timelineStockoutDate = timelineResult.timeline.stockoutDateConfirmed;
        health.metrics.timelineReorderDate = timelineResult.timeline.reorderDate;
        health.metrics.confirmedCoverageDays = confirmedCoverageDays;
        health.metrics.timelineToday = timelineResult.timeline.today;
        health.metrics.timelinePoints = timelineResult.timeline.points.map((p) => ({
          horizonDays: p.horizonDays,
          confirmedEnding: p.confirmedEnding,
          expectedEnding: p.expectedEnding,
          cumulativeDemand: p.cumulativeDemand,
        }));
        if (timelineResult.timeline.uncoverableByNewPo) {
          health.metrics.uncoverableByNewPo = true;
        }
      } catch (err) {
        console.warn(
          `[replenishmentForecast] timeline qty skipped ${sku.code}/${wh.code}:`,
          err,
        );
      }

      health.healthStatus = decisionHealth;
      health.needsReplenishment = needsReplenishmentByHealth(decisionHealth);
      health.suggestedQty = suggestedQty;
      health.suggestedDate = suggestedDate;
      health.coverageDays = Number.isFinite(confirmedCoverageDays)
        ? confirmedCoverageDays
        : health.coverageDays;

      if (deferUs) continue;
      if (!needsReplenishmentByHealth(decisionHealth)) continue;

      if (wh.regionGroup === 'US' && usPool.effectiveQty < usNetworkRop) {
        const networkQty = suggestedQty;
        const split = splitQtyByDailyShare(networkQty, dailyByWh);
        suggestedQty = split[wh.code] ?? suggestedQty;
      }

      if (suggestedQty <= 0) continue;

      const rawQty = suggestedQty;
      suggestedQty = applyMoq(suggestedQty, effectiveMoq);

      const poolNote =
        wh.regionGroup === 'US'
          ? `US仓网覆盖 ${Number.isFinite(usNetworkCoverage) ? usNetworkCoverage.toFixed(1) : '∞'} 天`
          : undefined;
      const moqNote =
        effectiveMoq > 0 && suggestedQty > rawQty ? `MOQ ${effectiveMoq}` : undefined;
      const reasonBase = formatCoverageReason({
        warehouseCode: wh.code,
        effectiveQty: position.effectiveQty,
        avgDaily: dailyByWh[wh.code] ?? 0,
        result: {
          ...coverage,
          healthStatus: decisionHealth,
          needsReplenishment: true,
          suggestedQty,
          suggestedDate,
          coverageDays: confirmedCoverageDays,
        },
        poolNote,
        moqNote,
      });
      const stockoutNote = health.metrics.timelineStockoutDate
        ? `，确定缺货日 ${health.metrics.timelineStockoutDate}`
        : '';
      const demandGate = evaluateDemandGate({
        recentWmape: accuracyBySku.get(sku.id) ?? null,
        reconstructCapHit: false,
      });
      let reason =
        health.demandSource === 'forecast'
          ? `${reasonBase}，需求口径：月度预测日均${stockoutNote}`
          : `${reasonBase}${stockoutNote}`;
      if (demandGate.needsManualConfirm) {
        reason = `${reason}，需人工确认（${demandGate.flags.join(',')}）`;
      }

      const lateActions =
        health.metrics.uncoverableByNewPo === true
          ? buildLatePoActions({
              today:
                typeof health.metrics.timelineToday === 'string'
                  ? health.metrics.timelineToday
                  : new Date().toISOString().slice(0, 10),
              warehouseCode: wh.code,
              regionGroup: wh.regionGroup,
              uncoverableByNewPo: true,
              stockoutDateConfirmed:
                typeof health.metrics.timelineStockoutDate === 'string'
                  ? health.metrics.timelineStockoutDate
                  : null,
              avgDaily: dailyByWh[wh.code] ?? 0,
              totalLeadDays: coverage.leadTime.totalLeadDays,
            })
          : [];

      pending.push({
        skuId: sku.id,
        skuCode: sku.code,
        spuId: sku.spuId,
        replenishLight,
        warehouseCode: wh.code,
        suggestedQty,
        suggestedDate,
        reason,
        healthStatus: decisionHealth,
        coverageDays: confirmedCoverageDays,
        totalLeadDays: coverage.leadTime.totalLeadDays,
        latestOrderDays: coverage.latestOrderDays,
        metrics: {
          ...health.metrics,
          demandSource: health.demandSource,
          coverageHealthStatus,
          decisionHealthStatus: decisionHealth,
          needsManualConfirm: demandGate.needsManualConfirm,
          demandGateFlags: demandGate.flags,
          suggestedQtyGross: health.metrics.timelineSuggestedQtyGross,
          latePoActions: lateActions,
        },
      });
    }
  }

  const snapshotCount = await saveHealthSnapshots(healthRows);
  await syncReplenishLightFromHealth(healthRows);

  const spuRedNeeding = new Set<string>();
  for (const item of pending) {
    if (item.replenishLight === 'red' && item.spuId) {
      spuRedNeeding.add(item.spuId);
    }
  }

  const eligibleItems = pending.filter((item) =>
    shouldReplenishByLight({
      replenishLight: item.replenishLight,
      needsReplenishment: true,
      spuHasRedNeedingReplenishment: item.spuId ? spuRedNeeding.has(item.spuId) : false,
    }),
  );

  let enhancedReasons = new Map<string, string>();
  let difyEnhanced = false;

  const shouldEnhance =
    eligibleItems.length > 0 &&
    isReplenishmentWorkflowEnabled();

  if (shouldEnhance) {
    try {
      enhancedReasons = await enhanceReplenishmentReasons(
        eligibleItems.map((item) => ({
          skuCode: item.skuCode,
          warehouseCode: item.warehouseCode,
          suggestedQty: item.suggestedQty,
          reason: item.reason,
        })),
      );
      difyEnhanced = enhancedReasons.size > 0;
    } catch (err) {
      console.warn('[replenishmentForecast] enhancement skipped:', err);
    }
  }

  for (const item of eligibleItems) {
    await supersedePendingSuggestions(item.skuId, item.warehouseCode);

    const reasonKey = `${item.skuCode}::${item.warehouseCode}`;
    const reason = enhancedReasons.get(reasonKey) ?? item.reason;

    await db.insert(reorderSuggestions).values({
      skuId: item.skuId,
      warehouseCode: item.warehouseCode,
      suggestedQty: item.suggestedQty,
      suggestedDate: item.suggestedDate,
      reason,
      healthStatus: item.healthStatus,
      coverageDays: Number.isFinite(item.coverageDays) ? String(item.coverageDays) : null,
      totalLeadDays: item.totalLeadDays,
      latestOrderDays: Number.isFinite(item.latestOrderDays)
        ? String(item.latestOrderDays)
        : null,
      metrics: item.metrics,
      status: 'pending',
    });

    results.push({
      skuCode: item.skuCode,
      warehouseCode: item.warehouseCode,
      suggestedQty: item.suggestedQty,
      healthStatus: item.healthStatus,
      reason,
    });
    count++;
  }

  const engine = difyEnhanced
    ? 'coverage-timeline+ai-enhanced'
    : 'coverage-timeline';

  return { suggestionCount: count, snapshotCount, engine, difyEnhanced, results };
}
