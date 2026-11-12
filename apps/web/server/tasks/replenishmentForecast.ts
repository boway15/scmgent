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
import { formatCoverageReason, type InventoryHealth } from '../lib/replenishment-coverage.js';
import { loadLatestRawSnapshotsBySkuIds } from '../lib/inventory-snapshot.js';
import { type ReplenishmentCandidate } from '../lib/network-replenishment.js';
import {
  loadRegionMappingTables,
  resolveFulfillmentRegion,
} from '../lib/region-mapping.js';
import {
  regionDemandDaily,
  shouldDeferUsRegionUnit,
} from '../lib/region-channel-planning.js';
import {
  buildSkuRegionChannelUnits,
  projectRegionChannelUnit,
  type RegionChannelUnit,
} from '../lib/region-channel-units.js';
import { loadOpenLotsBySkuWarehouse } from '../lib/inventory-supply-lot-sync.js';
import { normalizeSalesPlatformSync } from '../lib/sales-platform.js';
import { normalizeReplenishLight } from '../lib/replenish-light.js';
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
  supersedePendingSuggestionsForSkus,
} from '../lib/inventory-health-store.js';
import { parseProfileSegment } from '../lib/forecast-profile-class.js';
import { pendingSkuIdsToExpire } from '../lib/suggestion-expiry.js';
import { syncReplenishLightFromHealth } from '../lib/replenish-light-sync.js';
import { loadDailySalesBySkuIds } from '../lib/sales-history-query.js';
import { replenishmentSalesLookbackDays } from '../lib/sales-history-config.js';
import {
  loadMergedPublishedForecastBySkuIds,
  loadPublishedLeafForecastBySkuIds,
} from '../lib/forecast-published-resolve.js';
import { buildSkuWarehouseTimeline } from '../lib/inventory-timeline-service.js';
import { resolveLeadTimeFromCaches } from '../lib/lead-time-resolver.js';
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
import { createParamsResolver, finishRuleRun, loadActiveParamSets, startRuleRun } from '../rules/core/store.js';
import type { ActiveParamSet } from '../rules/core/resolve.js';
import {
  REPLENISHMENT_PARAMS,
  decideWarehouseCandidate,
  resolveMoqByPriority,
  shouldReplenishWithLinkage,
  replenishmentRule,
} from '../rules/replenishment/index.js';

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
  /** 试算用：替代数据库 active 参数集 */
  paramSets?: ActiveParamSet[];
  trigger?: 'task' | 'simulation';
};

export type ReplenishmentDryRow = {
  skuCode: string;
  warehouseCode: string;
  /** 决策粒度：履约区域 × 渠道 */
  fulfillmentRegion?: string | null;
  platform?: string | null;
  suggestedQty: number;
  suggestedDate: string;
  healthStatus: string;
  needsManualConfirm: boolean;
};

export type ReplenishmentRegionChannelDryRow = {
  skuCode: string;
  fulfillmentRegion: string;
  platform: string;
  healthStatus: string;
  effectiveQty: number;
  regionQty: number;
  avgDaily: number;
  suggestedQty: number;
  channelShareSource: string;
  demandSource: string;
};

/** 建议粒度标签：履约区域/渠道；旧网络口径行回退 NETWORK */
function candidateScopeLabel(item: {
  fulfillmentRegion?: string | null;
  platform?: string | null;
  warehouseCode: string | null;
}): string {
  if (item.fulfillmentRegion) return `${item.fulfillmentRegion}/${item.platform ?? 'ALL'}`;
  return item.warehouseCode ?? 'NETWORK';
}

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
      projectGroup: skus.projectGroup,
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
  const paramSets = options.paramSets ?? (await loadActiveParamSets(replenishmentRule.code));
  const resolveRuleParams = createParamsResolver(REPLENISHMENT_PARAMS, paramSets);
  const usedParamSetIds = new Set<string>();
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

  // 履约区域 × 渠道：映射、发布叶子（不含 sales_region='ALL'）、仓快照与批次一次预加载
  const [regionTables, leafBySkuId, rawSnapshotByKey, openLotsByKey] = await Promise.all([
    loadRegionMappingTables(db),
    loadPublishedLeafForecastBySkuIds(skuIds),
    loadLatestRawSnapshotsBySkuIds(skuIds),
    loadOpenLotsBySkuWarehouse(skuIds),
  ]);
  const fulfillmentRegionByWh = new Map(
    whRows.map((wh) => [wh.code, resolveFulfillmentRegion(wh.code, regionTables)] as const),
  );
  const runAt = new Date();
  const unitHealthRows: RegionChannelUnit['health'][] = [];
  /** 有需求但没有任何仓库映射到的区域 → 涉及 SKU 数；一期不出建议，仅告警 */
  const demandRegionsWithoutWarehouse = new Map<string, number>();

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
    const skuParams = resolveRuleParams({ projectGroup: sku.projectGroup });
    skuParams.paramSetIds.forEach((id) => usedParamSetIds.add(id));
    const effectiveMoq = resolveMoqByPriority(
      sku.moq,
      sku.spuId ? spuMoqMap.get(sku.spuId) : null,
      skuParams.values.moqPriority,
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
    const skuHealthRows: SkuHealthRow[] = [];

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
      const whParams = resolveRuleParams({ projectGroup: sku.projectGroup, warehouse: wh.code });
      whParams.paramSetIds.forEach((id) => usedParamSetIds.add(id));
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
        ruleDefaults: {
          safetyStockDays: whParams.values.defaultSafetyStockDays,
          overstockThresholdDays: whParams.values.overstockThresholdDays,
        },
        caches: {
          leadTime,
          position: positionByKey.get(key) ?? emptyPosition(wh.code),
          ...(hasForecast
            ? {}
            : { availabilityRows: availabilityByKey.get(key) ?? [] }),
        },
      });
      healthRows.push(health);
      skuHealthRows.push(health);
      dailyByWh[wh.code] = health.avgDaily;
      coverageByWh[wh.code] = health.coverage;

      const reorderPoint = (health.metrics.reorderPoint as number) ?? 0;
      if (!dryRun) await upsertSafetyStock(sku.id, wh.code, {
        safetyStockQty: (health.metrics.safetyStockQty as number) ?? 0,
        reorderPoint,
        reorderQty: (health.metrics.eoqQty as number) ?? 0,
      });
    }

    // 物理仓健康（快照 / 灯 / 安全库存回写）仍按仓；建议与预警按 履约区域 × 渠道（见下方 units）。
    for (const wh of whRows) {
      const whParams = resolveRuleParams({ projectGroup: sku.projectGroup, warehouse: wh.code });
      whParams.paramSetIds.forEach((id) => usedParamSetIds.add(id));
      const health = skuHealthRows.find((h) => h.warehouseCode === wh.code)!;
      const coverage = coverageByWh[wh.code];
      const coverageHealthStatus = health.healthStatus;
      health.metrics.coverageHealthStatus = coverageHealthStatus;
      health.metrics.coverageDaysShadow = health.coverageDays;
      health.metrics.fulfillmentRegion = fulfillmentRegionByWh.get(wh.code) ?? 'UNMAPPED';

      // 灰灯不进建议；覆盖天数灯降为影子，不再决定是否出建议。须在时间轴之前跳过，避免改写健康快照。
      if (coverageHealthStatus === 'gray') {
        health.metrics.ruleTrace = decideWarehouseCandidate({
          coverageHealth: 'gray',
          decisionHealth: 'gray',
          deferredByUsNetwork: false,
          suggestedQty: 0,
          moq: 0,
        }).trace;
        continue;
      }

      const position = health.position;
      let suggestedQty = coverage.suggestedQty;
      let suggestedDate = coverage.suggestedDate;
      let decisionHealth: InventoryHealth = coverageHealthStatus;
      let confirmedCoverageDays = health.coverageDays;

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
          coverDays: whParams.values.singleCoverDays,
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
            health.coverage.overstockThresholdDays ?? whParams.values.overstockThresholdDays,
          suggestedQty: timelineResult.suggestedQty,
          uncoverableByNewPo: timelineResult.timeline.uncoverableByNewPo,
          stockoutDateConfirmed: timelineResult.timeline.stockoutDateConfirmed,
          safetyBreachDateConfirmed: timelineResult.timeline.safetyBreachDateConfirmed,
          confirmedCoverageDays,
          lifecycle: health.lifecycle,
          effectiveQty: position.effectiveQty,
          avgDaily: health.avgDaily,
          slowMoving: {
            maxDaily: whParams.values.slowMovingDailyMax,
            minCoverageDays: whParams.values.slowMovingMinCoverageDays,
          },
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
      health.metrics.ruleTrace = decideWarehouseCandidate({
        coverageHealth: coverageHealthStatus,
        decisionHealth,
        deferredByUsNetwork: false,
        suggestedQty,
        moq: effectiveMoq,
      }).trace;
    }

    // ── 履约区域 × 渠道：需求取发布叶子 (region, platform)，无叶子回退同区同渠道历史；不读 sales_region='ALL' ──
    const unitResult = buildSkuRegionChannelUnits({
      sku,
      warehouseHealth: skuHealthRows,
      tables: regionTables,
      leaves: leafBySkuId.get(sku.id) ?? new Map(),
      salesRows,
      platformOf: normalizeSalesPlatformSync,
      policyMap,
      forecastErrorStdDev: errorStdDevBySku.get(sku.id) ?? null,
      moq: effectiveMoq || undefined,
      ruleDefaults: {
        safetyStockDays: skuParams.values.defaultSafetyStockDays,
        overstockThresholdDays: skuParams.values.overstockThresholdDays,
      },
      now: runAt,
    });
    for (const region of unitResult.demandRegionsWithoutWarehouse) {
      demandRegionsWithoutWarehouse.set(region, (demandRegionsWithoutWarehouse.get(region) ?? 0) + 1);
    }
    const usDeferEnabled = skuHealthRows.some(
      (h) =>
        fulfillmentRegionByWh.get(h.warehouseCode) === 'US' &&
        resolveRuleParams({ projectGroup: sku.projectGroup, warehouse: h.warehouseCode }).values
          .usNetworkDeferEnabled,
    );

    for (const unit of unitResult.units) {
      const { health, plan } = unit;
      const coverage = health.coverage;
      const coverageHealthStatus = health.healthStatus;
      health.metrics.coverageHealthStatus = coverageHealthStatus;
      health.metrics.coverageDaysShadow = health.coverageDays;
      unitHealthRows.push(health);
      const unitLabel = `${unit.fulfillmentRegion}/${unit.platform}`;

      if (coverageHealthStatus === 'gray') {
        health.metrics.ruleTrace = decideWarehouseCandidate({
          coverageHealth: 'gray',
          decisionHealth: 'gray',
          deferredByUsNetwork: false,
          suggestedQty: 0,
          moq: 0,
        }).trace;
        continue;
      }

      let suggestedQty = coverage.suggestedQty;
      let suggestedDate = coverage.suggestedDate;
      let decisionHealth: InventoryHealth = coverageHealthStatus;
      let confirmedCoverageDays = health.coverageDays;

      try {
        const timelineResult = projectRegionChannelUnit({
          skuId: sku.id,
          unit,
          plans: unitResult.plans,
          snapshots: rawSnapshotByKey,
          lotsByKey: openLotsByKey,
          coverDays: skuParams.values.singleCoverDays,
          moq: effectiveMoq || undefined,
          now: runAt,
        });
        suggestedQty = timelineResult.suggestedQty;
        suggestedDate = timelineResult.timeline.reorderDate ?? timelineResult.timeline.today;
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
          safetyStockDays: coverage.safetyStockDays,
          overstockThresholdDays:
            coverage.overstockThresholdDays ?? skuParams.values.overstockThresholdDays,
          suggestedQty: timelineResult.suggestedQty,
          uncoverableByNewPo: timelineResult.timeline.uncoverableByNewPo,
          stockoutDateConfirmed: timelineResult.timeline.stockoutDateConfirmed,
          safetyBreachDateConfirmed: timelineResult.timeline.safetyBreachDateConfirmed,
          confirmedCoverageDays,
          lifecycle: health.lifecycle,
          effectiveQty: health.effectiveQty,
          avgDaily: health.avgDaily,
          slowMoving: {
            maxDaily: skuParams.values.slowMovingDailyMax,
            minCoverageDays: skuParams.values.slowMovingMinCoverageDays,
          },
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
        console.warn(`[replenishmentForecast] unit timeline skipped ${sku.code}/${unitLabel}:`, err);
      }

      health.healthStatus = decisionHealth;
      health.needsReplenishment = needsReplenishmentByHealth(decisionHealth);
      health.suggestedQty = suggestedQty;
      health.suggestedDate = suggestedDate;
      health.coverageDays = Number.isFinite(confirmedCoverageDays)
        ? confirmedCoverageDays
        : health.coverageDays;

      // US 区内互调延后：仅在 fulfillmentRegion==='US' 的物理仓集合上生效
      const regionDaily = regionDemandDaily(plan);
      const regionRop = unit.regionWarehouseHealth.reduce(
        (sum, h) => sum + ((h.metrics.reorderPoint as number) ?? 0),
        0,
      );
      const regionCoverageDays =
        regionDaily > 0 ? plan.regionQty / regionDaily : Number.POSITIVE_INFINITY;
      const deferUs = shouldDeferUsRegionUnit({
        fulfillmentRegion: unit.fulfillmentRegion,
        enabled: usDeferEnabled,
        warehouses: unit.regionWarehouseHealth.map((h) => ({
          effectiveQty: h.effectiveQty,
          reorderPoint: (h.metrics.reorderPoint as number) ?? 0,
        })),
        networkEffective: plan.regionQty,
        networkRop: regionRop,
        networkCoverageDays: regionCoverageDays,
        targetCoverageDays: coverage.targetCoverageDays,
      });
      if (deferUs) health.metrics.usNetworkDeferred = true;

      const candidate = decideWarehouseCandidate({
        coverageHealth: coverageHealthStatus,
        decisionHealth,
        deferredByUsNetwork: deferUs,
        suggestedQty,
        moq: effectiveMoq,
      });
      health.metrics.ruleTrace = candidate.trace;
      if (!candidate.include) continue;
      const rawQty = suggestedQty;
      suggestedQty = candidate.qty;

      const poolNote =
        unit.fulfillmentRegion === 'US'
          ? `US区域覆盖 ${Number.isFinite(regionCoverageDays) ? regionCoverageDays.toFixed(1) : '∞'} 天`
          : undefined;
      const moqNote =
        effectiveMoq > 0 && suggestedQty > rawQty ? `MOQ ${effectiveMoq}` : undefined;
      const reasonBase = formatCoverageReason({
        warehouseCode: unitLabel,
        effectiveQty: health.effectiveQty,
        avgDaily: health.avgDaily,
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
      const demandAudit = unit.regionWarehouseHealth
        .map((h) => demandAuditBySkuWh.get(`${sku.id}:${h.warehouseCode}`))
        .find((row) => row != null);
      const unconstrained =
        demandAudit?.unconstrainedRecentDaily != null
          ? Number(demandAudit.unconstrainedRecentDaily)
          : null;
      const leaf = unit.planUnit.leaf;
      const demandGate = evaluateDemandGate({
        recentWmape: accuracyBySku.get(sku.id) ?? null,
        segment: parseProfileSegment(leaf?.profileSegment ?? forecastEntry.profileSegment),
        reconstructCapHit: isDemandReconstructCapHit({
          source: demandAudit?.source,
          unconstrainedDaily: unconstrained,
          avgDaily: health.avgDaily,
        }),
        unconstrainedDaily: unconstrained,
        stockoutDays: stockoutDaysFromInStockRatio(demandAudit?.inStockDayRatio),
      });
      const shareNote = `，渠道占比 ${(unit.planUnit.weight * 100).toFixed(1)}%（${plan.channelShareSource === 'forecast' ? '预测' : '历史'}）`;
      let reason =
        unit.planUnit.demandSource === 'published_leaf'
          ? `${reasonBase}，需求口径：${unit.fulfillmentRegion}×${unit.platform} 发布预测叶子${shareNote}${stockoutNote}`
          : `${reasonBase}，需求口径：同区同渠道历史日均${shareNote}${stockoutNote}`;
      if (demandGate.needsManualConfirm) {
        reason = `${reason}，需人工确认（${demandGate.flags.join(',')}）`;
      }
      if (unit.fulfillmentRegion === 'UNMAPPED') {
        reason = `${reason}，履约区域未映射（UNMAPPED）`;
      }

      const lateActions =
        health.metrics.uncoverableByNewPo === true
          ? buildLatePoActions({
              today:
                typeof health.metrics.timelineToday === 'string'
                  ? health.metrics.timelineToday
                  : new Date().toISOString().slice(0, 10),
              warehouseCode: unit.fulfillmentRegion,
              regionGroup: unit.fulfillmentRegion,
              uncoverableByNewPo: true,
              stockoutDateConfirmed:
                typeof health.metrics.timelineStockoutDate === 'string'
                  ? health.metrics.timelineStockoutDate
                  : null,
              avgDaily: health.avgDaily,
              totalLeadDays: coverage.leadTime.totalLeadDays,
            })
          : [];

      pending.push({
        skuId: sku.id,
        skuCode: sku.code,
        spuId: sku.spuId,
        replenishLight,
        // 区内拆仓由 PMC 采纳路径负责；此处仅记录区域，除非区内只有一个物理仓可直接落仓
        warehouseCode: null,
        fulfillmentRegion: unit.fulfillmentRegion,
        platform: unit.platform,
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
          usNetworkRop: unit.fulfillmentRegion === 'US' ? regionRop : undefined,
          usNetworkEffective: unit.fulfillmentRegion === 'US' ? plan.regionQty : undefined,
          triggerWarehouses: unit.regionWarehouseHealth.map((h) => h.warehouseCode),
          unmappedFulfillmentRegion: unit.fulfillmentRegion === 'UNMAPPED',
          ruleTrace: candidate.trace,
        },
      });
    }
  }

  if (demandRegionsWithoutWarehouse.size > 0) {
    console.warn(
      '[replenishmentForecast] 有需求但无仓库映射的区域（一期不出建议）:',
      Object.fromEntries(demandRegionsWithoutWarehouse),
    );
  }

  const snapshotCount = dryRun ? 0 : await saveHealthSnapshots(healthRows);
  if (!dryRun) await syncReplenishLightFromHealth(healthRows);

  const spuRedNeeding = new Set<string>();
  for (const item of pending) {
    if (item.replenishLight === 'red' && item.spuId) {
      spuRedNeeding.add(item.spuId);
    }
  }

  const linkageBySku = new Map(
    activeSkus.map((sku) => [sku.id, resolveRuleParams({ projectGroup: sku.projectGroup }).values.yellowLightLinkage]),
  );
  const eligibleItems = pending.filter((item) =>
    shouldReplenishWithLinkage({
      replenishLight: item.replenishLight,
      needsReplenishment: true,
      spuHasRedNeedingReplenishment: item.spuId ? spuRedNeeding.has(item.spuId) : false,
      yellowLightLinkage: linkageBySku.get(item.skuId) ?? true,
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
          warehouseCode: candidateScopeLabel(item),
          suggestedQty: item.suggestedQty,
          reason: item.reason,
        })),
      );
      difyEnhanced = enhancedReasons.size > 0;
    } catch (err) {
      console.warn('[replenishmentForecast] enhancement skipped:', err);
    }
  }

  const ruleRunId = dryRun
    ? null
    : await startRuleRun({
        moduleCode: replenishmentRule.code,
        trigger: options.trigger ?? 'task',
        moduleVersion: replenishmentRule.version,
        paramSetIds: [...usedParamSetIds],
      });

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
            fulfillmentRegion: item.fulfillmentRegion ?? null,
            platform: item.platform ?? null,
            suggestedQty: item.suggestedQty,
            suggestedDate: item.suggestedDate,
            healthStatus: item.healthStatus,
            needsManualConfirm: item.metrics?.needsManualConfirm === true,
          }),
        ),
        regionChannelHealth: unitHealthRows.map(
          (row): ReplenishmentRegionChannelDryRow => ({
            skuCode: row.skuCode,
            fulfillmentRegion: row.fulfillmentRegion,
            platform: row.platform,
            healthStatus: row.healthStatus,
            effectiveQty: row.effectiveQty,
            regionQty: row.regionQty,
            avgDaily: row.avgDaily,
            suggestedQty: row.suggestedQty,
            channelShareSource: String(row.metrics.channelShareSource ?? ''),
            demandSource: String(row.metrics.regionDemandSource ?? ''),
          }),
        ),
        demandRegionsWithoutWarehouse: Object.fromEntries(demandRegionsWithoutWarehouse),
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
  // 每个 SKU 本轮可有多条（区域×渠道）建议：先一次性作废旧 pending，再逐条写入，避免互相作废
  await supersedePendingSuggestionsForSkus([...new Set(eligibleItems.map((item) => item.skuId))]);

  for (const item of eligibleItems) {
    const reasonKey = `${item.skuCode}::${candidateScopeLabel(item)}`;
    const reason = enhancedReasons.get(reasonKey) ?? item.reason;

    await db.insert(reorderSuggestions).values({
      skuId: item.skuId,
      warehouseCode: item.warehouseCode,
      fulfillmentRegion: item.fulfillmentRegion ?? null,
      platform: item.platform ?? null,
      suggestedQty: item.suggestedQty,
      suggestedDate: item.suggestedDate,
      reason,
      healthStatus: item.healthStatus,
      coverageDays: Number.isFinite(item.coverageDays) ? String(item.coverageDays) : null,
      totalLeadDays: item.totalLeadDays,
      latestOrderDays: Number.isFinite(item.latestOrderDays)
        ? String(item.latestOrderDays)
        : null,
      metrics: { ...item.metrics, ruleRunId },
      status: 'pending',
    });

    results.push({
      skuCode: item.skuCode,
      warehouseCode: candidateScopeLabel(item),
      suggestedQty: item.suggestedQty,
      healthStatus: item.healthStatus,
      reason,
    });
    count++;
  }

  const engine = difyEnhanced
    ? 'coverage-timeline+ai-enhanced'
    : 'coverage-timeline';

  if (ruleRunId) await finishRuleRun(ruleRunId);

  return { suggestionCount: count, snapshotCount, engine, difyEnhanced, results };
}
