import { eq, and, desc, inArray } from 'drizzle-orm';
import {
  db,
  skus,
  reorderSuggestions,
  safetyStockConfig,
  warehouses,
  spus,
  forecastAccuracyMonthly,
  demandPlanMonthly,
  demandPlanVersions,
} from '@scm/db';
import { applyMoq, resolveEffectiveMoq } from '../lib/replenishment.js';
import { formatCoverageReason, type InventoryHealth } from '../lib/replenishment-coverage.js';
import { getRegionPoolSnapshot } from '../lib/inventory-snapshot.js';
import { shouldDeferReplenishment, US_WAREHOUSE_CODES } from '../lib/warehouse-domain.js';
import {
  collapseSkuReplenishmentCandidates,
  poolNetworkSafetyStockQty,
  sumNetworkAvgDaily,
  type NetworkTimelineOverride,
  type ReplenishmentCandidate,
} from '../lib/network-replenishment.js';
import {
  normalizeReplenishLight,
  shouldReplenishByLight,
  type ReplenishLight,
} from '../lib/replenish-light.js';
import { enhanceReplenishmentReasons } from '../integrations/dify-workflows.js';
import { isReplenishmentWorkflowEnabled } from '../integrations/dify.js';
import {
  computeSkuWarehouseHealth,
  loadHistoricalAvailabilityBySkuIds,
  loadLatestInventorySnapshotsBySkuIds,
  loadLeadTimeCaches,
  loadPolicyMapsBySkuIds,
  shareFromEncodingMeta,
  type SkuHealthRow,
} from '../lib/inventory-health-service.js';
import {
  saveHealthSnapshots,
  supersedeAllPendingSuggestionsForSku,
  supersedePendingSuggestionsForSkus,
} from '../lib/inventory-health-store.js';
import { parseProfileSegment, profileClassFromSegment } from '../lib/forecast-profile-class.js';
import { pendingSkuIdsToExpire } from '../lib/suggestion-expiry.js';
import { syncReplenishLightFromHealth } from '../lib/replenish-light-sync.js';
import { loadDailySalesBySkuIds } from '../lib/sales-history-query.js';
import { replenishmentSalesLookbackDays } from '../lib/sales-history-config.js';
import { calcForwardAvgDaily } from '../lib/forecast-demand.js';
import { loadMergedPublishedForecastBySkuIds } from '../lib/forecast-published-resolve.js';
import {
  buildSkuNetworkTimeline,
  buildSkuWarehouseTimeline,
} from '../lib/inventory-timeline-service.js';
import {
  resolveLeadTimeFromCaches,
  resolveNetworkOrderLeadDays,
  resolvePreShipmentLeadTimeForSku,
} from '../lib/lead-time-resolver.js';
import {
  PLANNING_INVENTORY_DEDUPE_MODE,
  resolveInventoryPositionFromSnapshot,
} from '../lib/inventory-position.js';
import { syncInventorySupplyLots } from '../lib/inventory-supply-lot-sync.js';
import {
  calcConfirmedCoverageDays,
  calcTimelineDecisionHealth,
  needsReplenishmentByHealth,
} from '../lib/inventory-light.js';
import {
  DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
  DEFAULT_SAFETY_STOCK_DAYS,
} from '../lib/replenishment-coverage.js';
import { IN_PRODUCTION_WAREHOUSE } from '../lib/inventory-constants.js';
import { DEMAND_PLAN_WAREHOUSE_ALL } from '../lib/demand-plan-config.js';
import {
  loadPlanningDemandDepsForSkus,
  loadPlanningDemandForSkuWarehouse,
} from '../lib/demand-plan-load.js';
import {
  evaluateDemandGate,
  summarizePrecisionWindow,
  isDemandReconstructCapHit,
  stockoutDaysFromInStockRatio,
} from '../lib/planning-demand-gate.js';
import { buildLatePoActions } from '../lib/planning-late-po-actions.js';

/** 回写本轮规划口径的件数 / ROP；人工配置（calcMethod=manual）不覆盖 */
async function upsertSafetyStock(
  skuId: string,
  warehouseCode: string,
  calc: { safetyStockQty: number; reorderPoint: number; reorderQty: number },
) {
  const [existing] = await db
    .select()
    .from(safetyStockConfig)
    .where(
      and(eq(safetyStockConfig.skuId, skuId), eq(safetyStockConfig.warehouseCode, warehouseCode)),
    )
    .limit(1);

  if (existing?.calcMethod === 'manual') return;

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

function positionKey(skuId: string, warehouseCode: string) {
  return `${skuId}::${warehouseCode}`;
}

export type ReplenishmentRunOptions = {
  /** 试算 / 基线：不同步三池、不写任何表、不调 Dify */
  dryRun?: boolean;
  skuIds?: string[];
};

export type ReplenishmentDryRow = {
  skuCode: string;
  warehouseCode: string;
  suggestedQty: number;
  suggestedDate: string;
  healthStatus: string;
  needsManualConfirm: boolean;
};

export type ReplenishmentHealthDryRow = {
  skuCode: string;
  warehouseCode: string;
  healthStatus: string;
  suggestedQty: number;
  suggestedDate: string;
};

export async function runReplenishmentForecast(options: ReplenishmentRunOptions = {}) {
  const dryRun = options.dryRun === true;
  if (!dryRun) {
    try {
      await syncInventorySupplyLots();
    } catch (err) {
      console.warn('[replenishmentForecast] supply lot sync skipped:', err);
    }
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
      lifecycle: skus.lifecycle,
      commercialStatusNorm: skus.commercialStatusNorm,
      encodingMeta: skus.encodingMeta,
    })
    .from(skus)
    .where(
      options.skuIds?.length
        ? and(eq(skus.isActive, true), inArray(skus.id, options.skuIds))
        : eq(skus.isActive, true),
    );

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

  const skuIds = activeSkus.map((s) => s.id);
  const physicalWarehouseCodes = whRows.map((wh) => wh.code);
  const demandWindowDays = replenishmentSalesLookbackDays();

  const [salesBySkuId, forecastBySkuId, policyBySku, positionByKey, leadTimeCaches, planningBundle] =
    await Promise.all([
      loadDailySalesBySkuIds(skuIds),
      loadMergedPublishedForecastBySkuIds(skuIds),
      loadPolicyMapsBySkuIds(skuIds),
      loadLatestInventorySnapshotsBySkuIds(skuIds, physicalWarehouseCodes),
      loadLeadTimeCaches(skuIds),
      loadPlanningDemandDepsForSkus(skuIds),
    ]);

  const noForecastSkuIds = skuIds.filter((id) => {
    const entry = forecastBySkuId.get(id);
    return !entry?.map.size;
  });
  const availabilityByKey = await loadHistoricalAvailabilityBySkuIds({
    skuIds: noForecastSkuIds,
    windowDays: demandWindowDays,
  });

  const emptyPosition = (warehouseCode: string) =>
    resolveInventoryPositionFromSnapshot({
      warehouseCode,
      dedupeMode: PLANNING_INVENTORY_DEDUPE_MODE,
    });

  const accuracyBySku = new Map<string, number>();
  const errorStdDevBySku = new Map<string, number>();
  const demandAuditBySkuWh = new Map<
    string,
    { unconstrainedRecentDaily: string | null; inStockDayRatio: string | null; source: string | null }
  >();
  if (skuIds.length > 0) {
    const accuracyRows = await db
      .select({
        skuId: forecastAccuracyMonthly.skuId,
        station: forecastAccuracyMonthly.station,
        platform: forecastAccuracyMonthly.platform,
        forecastYear: forecastAccuracyMonthly.forecastYear,
        month: forecastAccuracyMonthly.month,
        forecastDailyAvg: forecastAccuracyMonthly.forecastDailyAvg,
        actualDailyAvg: forecastAccuracyMonthly.actualDailyAvg,
        computedAt: forecastAccuracyMonthly.computedAt,
      })
      .from(forecastAccuracyMonthly)
      .where(inArray(forecastAccuracyMonthly.skuId, skuIds));
    const accuracyRowsBySku = new Map<string, typeof accuracyRows>();
    for (const row of accuracyRows) {
      const list = accuracyRowsBySku.get(row.skuId) ?? [];
      list.push(row);
      accuracyRowsBySku.set(row.skuId, list);
    }
    for (const [skuId, rows] of accuracyRowsBySku) {
      const summary = summarizePrecisionWindow(rows);
      if (summary.wmape != null) accuracyBySku.set(skuId, summary.wmape);
      if (summary.errorStdDev != null && summary.errorStdDev > 0) {
        errorStdDevBySku.set(skuId, summary.errorStdDev);
      }
    }

    const auditRows = await db
      .select({
        skuId: demandPlanMonthly.skuId,
        warehouseCode: demandPlanMonthly.warehouseCode,
        unconstrainedRecentDaily: demandPlanMonthly.unconstrainedRecentDaily,
        inStockDayRatio: demandPlanMonthly.inStockDayRatio,
        source: demandPlanMonthly.source,
      })
      .from(demandPlanMonthly)
      .innerJoin(demandPlanVersions, eq(demandPlanMonthly.versionId, demandPlanVersions.id))
      .where(
        and(
          inArray(demandPlanMonthly.skuId, skuIds),
          eq(demandPlanVersions.status, 'pilot_published'),
        ),
      )
      .orderBy(desc(demandPlanMonthly.updatedAt));
    for (const row of auditRows) {
      const key = `${row.skuId}:${row.warehouseCode}`;
      if (!demandAuditBySkuWh.has(key)) demandAuditBySkuWh.set(key, row);
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
  const pending: ReplenishmentCandidate[] = [];

  for (const sku of activeSkus) {
    const replenishLight = normalizeReplenishLight(sku.replenishLight);
    const effectiveMoq = resolveEffectiveMoq(
      sku.moq,
      sku.spuId ? spuMoqMap.get(sku.spuId) : null,
    );
    const policyMap = policyBySku.get(sku.id) ?? new Map();
    const forecastEntry = forecastBySkuId.get(sku.id) ?? {
      map: new Map<string, number>(),
      lifecycle: undefined,
      versionId: null,
      profileSegment: undefined,
      profileClass: null,
      p90Map: undefined,
    };
    const forecastByStation = new Map<
      string,
      { map: Map<string, number>; lifecycle?: string }
    >();
    const hasForecast = forecastEntry.map.size > 0;

    const salesRows = salesBySkuId.get(sku.id) ?? [];

    const dailyByWh: Record<string, number> = {};
    const coverageByWh: Record<string, SkuHealthRow['coverage']> = {};
    const networkRopByRegion: Record<string, number> = {};

    const share = shareFromEncodingMeta(sku.encodingMeta);
    for (const wh of whRows) {
      const key = positionKey(sku.id, wh.code);
      const leadTime = resolveLeadTimeFromCaches(
        {
          skuId: sku.id,
          merchantCode: sku.merchantCode,
          warehouseCode: wh.code,
          skuLeadTimeDays: sku.leadTimeDays,
        },
        leadTimeCaches,
      );
      const planningDemand = await loadPlanningDemandForSkuWarehouse(
        {
          skuId: sku.id,
          warehouseCode: wh.code,
          championForecastMap: forecastEntry.map,
        },
        planningBundle.deps,
      );
      const health = await computeSkuWarehouseHealth({
        sku,
        warehouse: wh,
        salesRows,
        policyMap,
        forecastByStation,
        forecastEntry,
        planningDemand,
        forecastErrorStdDev: errorStdDevBySku.get(sku.id) ?? null,
        share,
        moq: effectiveMoq || undefined,
        caches: {
          leadTime,
          position: positionByKey.get(key) ?? emptyPosition(wh.code),
          ...(hasForecast
            ? {}
            : { availabilityRows: availabilityByKey.get(key) ?? [] }),
        },
      });
      healthRows.push(health);
      dailyByWh[wh.code] = health.avgDaily;
      coverageByWh[wh.code] = health.coverage;

      const reorderPoint = (health.metrics.reorderPoint as number) ?? 0;
      if (!dryRun) await upsertSafetyStock(sku.id, wh.code, {
        safetyStockQty: (health.metrics.safetyStockQty as number) ?? 0,
        reorderPoint,
        reorderQty: (health.metrics.eoqQty as number) ?? 0,
      });
      networkRopByRegion[wh.regionGroup] =
        (networkRopByRegion[wh.regionGroup] ?? 0) + reorderPoint;
    }

    const usPool = await getRegionPoolSnapshot(sku.id, 'US');
    const usNetworkRop = networkRopByRegion.US ?? 0;
    const usNetworkDaily = US_WAREHOUSE_CODES.reduce(
      (sum, code) => sum + (dailyByWh[code] ?? 0),
      0,
    );
    const usNetworkCoverage =
      usNetworkDaily > 0 ? usPool.effectiveQty / usNetworkDaily : Number.POSITIVE_INFINITY;

    const skuCandidates: ReplenishmentCandidate[] = [];

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

      const position = health.position;
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
      const demandAudit = demandAuditBySkuWh.get(`${sku.id}:${wh.code}`);
      const unconstrained =
        demandAudit?.unconstrainedRecentDaily != null
          ? Number(demandAudit.unconstrainedRecentDaily)
          : null;
      const demandGate = evaluateDemandGate({
        recentWmape: accuracyBySku.get(sku.id) ?? null,
        segment: parseProfileSegment(forecastEntry.profileSegment),
        reconstructCapHit: isDemandReconstructCapHit({
          source: demandAudit?.source,
          unconstrainedDaily: unconstrained,
          avgDaily: health.avgDaily,
        }),
        unconstrainedDaily: unconstrained,
        stockoutDays: stockoutDaysFromInStockRatio(demandAudit?.inStockDayRatio),
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

      skuCandidates.push({
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
          usNetworkRop,
          usNetworkEffective: usPool.effectiveQty,
        },
      });
    }

    let networkTimelineOverride: NetworkTimelineOverride | undefined;
    if (skuCandidates.length > 0) {
      try {
        const policyRows = [...policyMap.values()].filter(
          (row) =>
            row.warehouseCode !== DEMAND_PLAN_WAREHOUSE_ALL &&
            row.warehouseCode !== IN_PRODUCTION_WAREHOUSE &&
            row.warehouseCode !== 'OVERSEAS',
        );
        const safetyStockDays = policyRows.reduce(
          (max, row) => Math.max(max, row.safetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS),
          DEFAULT_SAFETY_STOCK_DAYS,
        );
        const networkPlanning = await loadPlanningDemandForSkuWarehouse(
          {
            skuId: sku.id,
            warehouseCode: DEMAND_PLAN_WAREHOUSE_ALL,
            championForecastMap: forecastEntry.map,
          },
          planningBundle.deps,
        );
        const planForward =
          networkPlanning.source === 'demand_plan'
            ? calcForwardAvgDaily(networkPlanning.demandMap, new Date(), 90, 0)
            : 0;
        const forecastForward =
          planForward > 0
            ? planForward
            : hasForecast
              ? calcForwardAvgDaily(forecastEntry.map, new Date(), 90, 0)
              : 0;
        const networkDemand = sumNetworkAvgDaily({
          rows: whRows.map((wh) => {
            const row = healthRows.find(
              (health) => health.skuId === sku.id && health.warehouseCode === wh.code,
            );
            return {
              warehouseCode: wh.code,
              avgDaily: dailyByWh[wh.code] ?? 0,
              demandShareFallback: row?.metrics.demandShareFallback === true,
            };
          }),
          forecastForwardAvg: forecastForward > 0 ? forecastForward : null,
        });
        const networkAvgDaily = networkDemand.avgDaily;
        const safetyStockQty = poolNetworkSafetyStockQty({
          networkAvgDaily,
          safetyStockDays,
        });
        const lead = await resolvePreShipmentLeadTimeForSku({
          skuId: sku.id,
          merchantCode: sku.merchantCode,
          skuLeadTimeDays: sku.leadTimeDays,
        });
        const networkLeadDays = resolveNetworkOrderLeadDays({
          productionDays: lead.totalLeadDays,
          warehouseLeadDays: skuCandidates.map((candidate) => candidate.totalLeadDays),
        });
        const networkTimeline = await buildSkuNetworkTimeline({
          skuId: sku.id,
          avgDaily: networkAvgDaily,
          forecastMap:
            networkPlanning.source === 'demand_plan'
              ? networkPlanning.demandMap
              : forecastEntry.map,
          farHorizon: {
            profileClass:
              forecastEntry.profileClass ?? profileClassFromSegment(forecastEntry.profileSegment),
            p90: forecastEntry.p90Map,
          },
          totalLeadDays: networkLeadDays,
          safetyStockDays,
          safetyStockQty,
          moq: effectiveMoq || undefined,
        });
        networkTimelineOverride = {
          suggestedQty: networkTimeline.suggestedQty,
          suggestedDate:
            networkTimeline.timeline.reorderDate ?? networkTimeline.timeline.today,
          totalLeadDays: networkLeadDays,
          stockoutDate: networkTimeline.timeline.stockoutDateConfirmed,
          metrics: {
            timelineSuggestedQty: networkTimeline.suggestedQty,
            timelineSuggestedQtyGross: networkTimeline.timeline.suggestedQtyGross,
            timelineReorderDate: networkTimeline.timeline.reorderDate,
            timelineToday: networkTimeline.timeline.today,
            uncoverableByNewPo: networkTimeline.timeline.uncoverableByNewPo,
            networkExcludedFallbackWarehouses: networkDemand.excludedWarehouses,
          },
        };
      } catch (err) {
        console.warn(
          `[replenishmentForecast] network timeline skipped ${sku.code}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    const networkSuggestion = collapseSkuReplenishmentCandidates(
      skuCandidates,
      networkTimelineOverride,
    );
    if (networkSuggestion) pending.push(networkSuggestion);
  }

  const snapshotCount = dryRun ? 0 : await saveHealthSnapshots(healthRows);
  if (!dryRun) await syncReplenishLightFromHealth(healthRows);

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
    !dryRun && eligibleItems.length > 0 && isReplenishmentWorkflowEnabled();

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

  if (dryRun) {
    return {
      suggestionCount: eligibleItems.length,
      snapshotCount: 0,
      results: [],
      dry: {
        suggestions: eligibleItems.map(
          (item): ReplenishmentDryRow => ({
            skuCode: item.skuCode,
            warehouseCode: item.warehouseCode ?? 'NETWORK',
            suggestedQty: item.suggestedQty,
            suggestedDate: item.suggestedDate,
            healthStatus: item.healthStatus,
            needsManualConfirm: item.metrics?.needsManualConfirm === true,
          }),
        ),
        health: healthRows.map(
          (row): ReplenishmentHealthDryRow => ({
            skuCode: row.skuCode,
            warehouseCode: row.warehouseCode,
            healthStatus: row.healthStatus,
            suggestedQty: row.suggestedQty,
            suggestedDate: row.suggestedDate,
          }),
        ),
      },
    };
  }

  const expireSkuIds = pendingSkuIdsToExpire({
    processedSkuIds: activeSkus.map((sku) => sku.id),
    keptSkuIds: eligibleItems.map((item) => item.skuId),
  });
  await supersedePendingSuggestionsForSkus(expireSkuIds);

  for (const item of eligibleItems) {
    await supersedeAllPendingSuggestionsForSku(item.skuId);

    const reasonKey = `${item.skuCode}::${item.warehouseCode ?? 'NETWORK'}`;
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
      warehouseCode: item.warehouseCode ?? 'NETWORK',
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
