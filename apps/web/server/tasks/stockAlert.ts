import { sendFeishuGroupMessage } from '../integrations/feishu.js';
import { formatAlertSummary } from '../lib/replenishment.js';
import { generateAlertFeishuMessage } from '../integrations/dify-workflows.js';
import { isAlertWorkflowEnabled } from '../integrations/dify.js';
import {
  computeAllInventoryHealth,
  healthToAlertType,
  loadForecastErrorStdDevBySkuIds,
  loadPolicyMapsBySkuIds,
  type SkuHealthRow,
} from '../lib/inventory-health-service.js';
import { applyStockAlertCoverageReplace, saveHealthSnapshots } from '../lib/inventory-health-store.js';
import {
  shouldEmitImmediateAlert,
  shouldPersistHorizonAlert,
  type StockAlertIncoming,
} from '../lib/stock-alert-sync.js';
import { loadPlanningEligibleSkuIds } from '../lib/planning-dashboard.js';
import { syncReplenishLightFromHealth } from '../lib/replenish-light-sync.js';
import { inArray } from 'drizzle-orm';
import { db, skus } from '@scm/db';
import { loadRegionMappingTables } from '../lib/region-mapping.js';
import { shouldDeferUsRegionUnit, regionDemandDaily } from '../lib/region-channel-planning.js';
import {
  buildSkuRegionChannelUnits,
  projectRegionChannelUnit,
  type RegionChannelUnit,
} from '../lib/region-channel-units.js';
import { loadDailySalesBySkuIds } from '../lib/sales-history-query.js';
import { normalizeSalesPlatformSync } from '../lib/sales-platform.js';
import {
  loadOpenLotsBySkuWarehouse,
  syncInventorySupplyLots,
  type OpenTimelineLot,
} from '../lib/inventory-supply-lot-sync.js';
import { assembleWarehouseTimeline } from '../lib/inventory-timeline-service.js';
import { deriveHorizonAlerts } from '../lib/inventory-horizon-alerts.js';
import { DEFAULT_OVERSTOCK_THRESHOLD_DAYS } from '../lib/replenishment-coverage.js';
import {
  parseSharesFromSnapshot,
  type ShareParseResult,
} from '../lib/inventory-share-allocation.js';
import { readTurnoverSnapshot } from '../lib/inventory-turnover-snapshot.js';
import {
  calcConfirmedCoverageDays,
  calcTimelineDecisionHealth,
  needsReplenishmentByHealth,
} from '../lib/inventory-light.js';
import {
  emptyInventorySnapshot,
  loadLatestRawSnapshotsBySkuIds,
  type InventorySnapshot,
} from '../lib/inventory-snapshot.js';
import {
  loadMergedPublishedForecastBySkuIds,
  loadPublishedLeafForecastBySkuIds,
} from '../lib/forecast-published-resolve.js';
import {
  loadPlanningDemandDepsForSkus,
  loadPlanningDemandForSkuWarehouse,
  type LoadPlanningDemandDeps,
} from '../lib/demand-plan-load.js';
import { yieldToEventLoop } from '../lib/yield-event-loop.js';
import { UNALLOCATED_TRANSIT_WAREHOUSE } from '../lib/inventory-constants.js';

const FEISHU_PREVIEW_LIMIT = 40;
const TIMELINE_YIELD_EVERY = 1000;
const EMPTY_FORECAST = new Map<string, number>();

type TimelineBundle = {
  snapshots: Map<string, InventorySnapshot>;
  lotsByKey: Map<string, OpenTimelineLot[]>;
  forecastBySku: Awaited<ReturnType<typeof loadMergedPublishedForecastBySkuIds>>;
  planningDeps: LoadPlanningDemandDeps;
  shareBySku: Map<string, ShareParseResult>;
};

function snapshotOf(
  snapshots: Map<string, InventorySnapshot>,
  skuId: string,
  warehouseCode: string,
): InventorySnapshot {
  return snapshots.get(`${skuId}::${warehouseCode}`) ?? emptyInventorySnapshot(warehouseCode);
}

async function loadTimelineBundle(skuIds: string[]): Promise<TimelineBundle> {
  const t0 = Date.now();
  const [snapshots, lotsByKey, forecastBySku, planning] = await Promise.all([
    loadLatestRawSnapshotsBySkuIds(skuIds),
    loadOpenLotsBySkuWarehouse(skuIds),
    loadMergedPublishedForecastBySkuIds(skuIds),
    loadPlanningDemandDepsForSkus(skuIds),
  ]);
  const shareBySku = new Map<string, ShareParseResult>();
  for (const [skuId, encodingMeta] of planning.encodingMetaBySku) {
    shareBySku.set(skuId, parseSharesFromSnapshot(readTurnoverSnapshot(encodingMeta)));
  }
  console.info(
    `[stockAlert] preload ${Date.now() - t0}ms skus=${skuIds.length} snapshots=${snapshots.size} lotKeys=${lotsByKey.size} forecasts=${forecastBySku.size}`,
  );
  return {
    snapshots,
    lotsByKey,
    forecastBySku,
    planningDeps: planning.deps,
    shareBySku,
  };
}

export async function runStockAlert() {
  try {
    await syncInventorySupplyLots();
  } catch (err) {
    console.warn('[stockAlert] supply lot sync skipped:', err);
  }

  const [healthRows, eligibleSkuIds] = await Promise.all([
    computeAllInventoryHealth(),
    loadPlanningEligibleSkuIds(),
  ]);
  const skuIds = [...new Set(healthRows.map((row) => row.skuId))];
  const bundle = await loadTimelineBundle(skuIds);

  const incoming: StockAlertIncoming[] = [];
  const tTimeline = Date.now();
  let timelineErrors = 0;

  for (let index = 0; index < healthRows.length; index += 1) {
    const row = healthRows[index]!;
    if (index > 0 && index % TIMELINE_YIELD_EVERY === 0) {
      if (index % (TIMELINE_YIELD_EVERY * 5) === 0) {
        console.info(
          `[stockAlert] timelines ${index}/${healthRows.length} elapsed=${Date.now() - tTimeline}ms errors=${timelineErrors}`,
        );
      }
      await yieldToEventLoop();
    }
    const coverageHealthStatus = row.healthStatus;
    row.metrics.coverageHealthStatus = coverageHealthStatus;
    try {
      const share = bundle.shareBySku.get(row.skuId) ?? parseSharesFromSnapshot({});
      const built = await projectRow(row, bundle, share);
      if (coverageHealthStatus !== 'gray') {
        const day0 = built.timeline.points.find((point) => point.horizonDays === 0);
        const confirmedCoverageDays = calcConfirmedCoverageDays({
          today: built.timeline.today,
          stockoutDateConfirmed: built.timeline.stockoutDateConfirmed,
          confirmedEndingToday: day0?.confirmedEnding ?? 0,
          avgDaily: row.avgDaily,
        });
        const decisionHealth = calcTimelineDecisionHealth({
          today: built.timeline.today,
          totalLeadDays: row.totalLeadDays,
          safetyStockDays: row.coverage.safetyStockDays,
          overstockThresholdDays:
            row.coverage.overstockThresholdDays ?? DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
          suggestedQty: built.suggestedQty,
          uncoverableByNewPo: built.timeline.uncoverableByNewPo,
          stockoutDateConfirmed: built.timeline.stockoutDateConfirmed,
          safetyBreachDateConfirmed: built.timeline.safetyBreachDateConfirmed,
          confirmedCoverageDays,
          lifecycle: row.lifecycle,
          effectiveQty: row.effectiveQty,
          avgDaily: row.avgDaily,
        });
        row.healthStatus = decisionHealth;
        row.needsReplenishment = needsReplenishmentByHealth(decisionHealth);
        row.suggestedQty = built.suggestedQty;
        row.coverageDays = Number.isFinite(confirmedCoverageDays)
          ? confirmedCoverageDays
          : row.coverageDays;
        row.metrics.confirmedCoverageDays = confirmedCoverageDays;
        row.metrics.timelineStockoutDate = built.timeline.stockoutDateConfirmed;
      }
    } catch (err) {
      timelineErrors += 1;
      console.warn(`[stockAlert] timeline skipped ${row.skuCode}/${row.warehouseCode}:`, err);
    }
  }

  // 预警决策粒度：履约区域 × 渠道（仓级时间轴仅用于健康快照 / 红绿灯）
  const unitStats = await collectRegionChannelAlerts({
    healthRows,
    eligibleSkuIds,
    bundle,
    incoming,
  });

  console.info(
    `[stockAlert] timelines done rows=${healthRows.length} elapsed=${Date.now() - tTimeline}ms errors=${timelineErrors} units=${unitStats.units} unitErrors=${unitStats.errors} candidates=${incoming.length}`,
  );
  if (unitStats.demandRegionsWithoutWarehouse.size > 0) {
    console.warn(
      `[stockAlert] 有需求但无仓库映射的履约区域（一期不出预警）: ${[...unitStats.demandRegionsWithoutWarehouse.entries()]
        .map(([region, n]) => `${region}×${n}SKU`)
        .join(', ')}`,
    );
  }

  await saveHealthSnapshots(healthRows);
  await syncReplenishLightFromHealth(healthRows);

  const coverage = await applyStockAlertCoverageReplace(incoming);
  const { invalidateAlertActionCache, warmPlanningDashboardCaches } = await import(
    '../lib/alert-action-index.js'
  );
  invalidateAlertActionCache();
  void warmPlanningDashboardCaches(['goods']).catch((err) => {
    console.warn('[stockAlert] warmPlanningDashboardCaches skipped:', err);
  });
  console.info(
    `[stockAlert] coverage replace cleared=${coverage.cleared} inserted=${coverage.inserted} active=${coverage.activeCount}`,
  );

  const alertsForFeishu = incoming.map((row) => ({
    skuCode: row.skuCode ?? row.skuId,
    type: row.displayType ?? row.alertType,
    currentQty: row.currentQty,
    threshold: row.safetyQty,
  }));

  let difySummary = false;
  const preview = alertsForFeishu.slice(0, FEISHU_PREVIEW_LIMIT);
  let summary = formatAlertSummary(preview);
  if (coverage.activeCount > preview.length) {
    summary += `\n（飞书仅展示前 ${preview.length} 条，本轮快照共 ${coverage.activeCount} 条待处理）`;
  }

  if (coverage.activeCount > 0 && isAlertWorkflowEnabled()) {
    try {
      const llmMessage = await generateAlertFeishuMessage(alertsForFeishu, coverage.activeCount);
      if (llmMessage) {
        summary = llmMessage;
        difySummary = true;
      }
    } catch (err) {
      console.warn('[stockAlert] Dify alert workflow skipped:', err);
    }
  }

  if (coverage.activeCount > 0) {
    try {
      await sendFeishuGroupMessage(`缺货预警 (${coverage.activeCount} 条)\n${summary}`);
    } catch (err) {
      console.warn('[stockAlert] Feishu push skipped:', err);
    }
  }

  const engine = difySummary ? 'unified-health+timeline+dify-summary' : 'unified-health+timeline';

  return {
    alertCount: coverage.activeCount,
    activeCount: coverage.activeCount,
    autoResolved: coverage.cleared,
    engine,
    difySummary,
    alerts: preview,
  };
}

async function projectRow(row: SkuHealthRow, bundle: TimelineBundle, share: ShareParseResult) {
  const forecastMap = bundle.forecastBySku.get(row.skuId)?.map ?? EMPTY_FORECAST;
  const planningDemand = await loadPlanningDemandForSkuWarehouse(
    {
      skuId: row.skuId,
      warehouseCode: row.warehouseCode,
      championForecastMap: forecastMap,
    },
    bundle.planningDeps,
  );
  const safetyStockQty = (row.metrics.safetyStockQty as number) ?? 0;
  return assembleWarehouseTimeline({
    warehouseCode: row.warehouseCode,
    avgDaily: row.avgDaily,
    totalLeadDays: row.totalLeadDays,
    safetyStockDays: row.coverage.safetyStockDays,
    safetyStockQty,
    share,
    snapshot: snapshotOf(bundle.snapshots, row.skuId, row.warehouseCode),
    overseasSnapshot: snapshotOf(bundle.snapshots, row.skuId, UNALLOCATED_TRANSIT_WAREHOUSE),
    openLots: bundle.lotsByKey.get(`${row.skuId}::${row.warehouseCode}`) ?? [],
    planningDemand,
  });
}

async function collectRegionChannelAlerts(params: {
  healthRows: SkuHealthRow[];
  eligibleSkuIds: Set<string>;
  bundle: TimelineBundle;
  incoming: StockAlertIncoming[];
}): Promise<{
  units: number;
  errors: number;
  demandRegionsWithoutWarehouse: Map<string, number>;
}> {
  const bySku = new Map<string, SkuHealthRow[]>();
  for (const row of params.healthRows) {
    if (!params.eligibleSkuIds.has(row.skuId)) continue;
    const list = bySku.get(row.skuId) ?? [];
    list.push(row);
    bySku.set(row.skuId, list);
  }
  const skuIds = [...bySku.keys()];
  const demandRegionsWithoutWarehouse = new Map<string, number>();
  if (!skuIds.length) return { units: 0, errors: 0, demandRegionsWithoutWarehouse };

  const [tables, leafBySku, salesBySku, policyBySku, errorStdDevBySku, skuRows] = await Promise.all([
    loadRegionMappingTables(db),
    loadPublishedLeafForecastBySkuIds(skuIds),
    loadDailySalesBySkuIds(skuIds),
    loadPolicyMapsBySkuIds(skuIds),
    loadForecastErrorStdDevBySkuIds(skuIds),
    loadAlertSkus(skuIds),
  ]);
  const skuById = new Map(skuRows.map((row) => [row.id, row]));

  let units = 0;
  let errors = 0;
  for (const [skuId, warehouseHealth] of bySku) {
    const sku = skuById.get(skuId);
    if (!sku) continue;
    try {
      const result = buildSkuRegionChannelUnits({
        sku,
        warehouseHealth,
        tables,
        leaves: leafBySku.get(skuId) ?? new Map(),
        salesRows: salesBySku.get(skuId) ?? [],
        platformOf: normalizeSalesPlatformSync,
        policyMap: policyBySku.get(skuId) ?? new Map(),
        forecastErrorStdDev: errorStdDevBySku.get(skuId) ?? null,
      });
      for (const region of result.demandRegionsWithoutWarehouse) {
        demandRegionsWithoutWarehouse.set(region, (demandRegionsWithoutWarehouse.get(region) ?? 0) + 1);
      }
      for (const unit of result.units) {
        units += 1;
        const timeline = projectRegionChannelUnit({
          skuId,
          unit,
          plans: result.plans,
          snapshots: params.bundle.snapshots,
          lotsByKey: params.bundle.lotsByKey,
        });
        pushRegionChannelAlerts(unit, timeline, params.incoming);
      }
    } catch (err) {
      errors += 1;
      console.warn(`[stockAlert] region unit skipped ${sku.code}:`, err);
    }
  }
  return { units, errors, demandRegionsWithoutWarehouse };
}

async function loadAlertSkus(skuIds: string[]) {
  const rows: Array<{
    id: string;
    code: string;
    spuId: string | null;
    merchantCode: string | null;
    leadTimeDays: number | null;
    unitCost: string | null;
    lifecycle: string | null;
    commercialStatusNorm: string | null;
  }> = [];
  for (let offset = 0; offset < skuIds.length; offset += 500) {
    const chunk = skuIds.slice(offset, offset + 500);
    const part = await db
      .select({
        id: skus.id,
        code: skus.code,
        spuId: skus.spuId,
        merchantCode: skus.merchantCode,
        leadTimeDays: skus.leadTimeDays,
        unitCost: skus.unitCost,
        lifecycle: skus.lifecycle,
        commercialStatusNorm: skus.commercialStatusNorm,
      })
      .from(skus)
      .where(inArray(skus.id, chunk));
    rows.push(...part);
  }
  return rows;
}

function pushRegionChannelAlerts(
  unit: RegionChannelUnit,
  timeline: ReturnType<typeof projectRegionChannelUnit>,
  incoming: StockAlertIncoming[],
) {
  const health = unit.health;
  const day0 = timeline.timeline.points.find((point) => point.horizonDays === 0);
  const confirmedCoverageDays = calcConfirmedCoverageDays({
    today: timeline.timeline.today,
    stockoutDateConfirmed: timeline.timeline.stockoutDateConfirmed,
    confirmedEndingToday: day0?.confirmedEnding ?? 0,
    avgDaily: health.avgDaily,
  });
  const decisionHealth = calcTimelineDecisionHealth({
    today: timeline.timeline.today,
    totalLeadDays: health.totalLeadDays,
    safetyStockDays: health.coverage.safetyStockDays,
    overstockThresholdDays: health.coverage.overstockThresholdDays ?? DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
    suggestedQty: timeline.suggestedQty,
    uncoverableByNewPo: timeline.timeline.uncoverableByNewPo,
    stockoutDateConfirmed: timeline.timeline.stockoutDateConfirmed,
    safetyBreachDateConfirmed: timeline.timeline.safetyBreachDateConfirmed,
    confirmedCoverageDays,
    lifecycle: health.lifecycle,
    effectiveQty: health.effectiveQty,
    avgDaily: health.avgDaily,
  });
  const regionDaily = regionDemandDaily(unit.plan);
  const regionRop = unit.regionWarehouseHealth.reduce(
    (sum, row) => sum + ((row.metrics.reorderPoint as number) ?? 0),
    0,
  );
  const regionCoverageDays = regionDaily > 0 ? unit.plan.regionQty / regionDaily : Number.POSITIVE_INFINITY;
  const deferUs = shouldDeferUsRegionUnit({
    fulfillmentRegion: unit.fulfillmentRegion,
    enabled: true,
    warehouses: unit.regionWarehouseHealth.map((row) => ({
      effectiveQty: row.effectiveQty,
      reorderPoint: (row.metrics.reorderPoint as number) ?? 0,
    })),
    networkEffective: unit.plan.regionQty,
    networkRop: regionRop,
    networkCoverageDays: regionCoverageDays,
    targetCoverageDays: health.coverage.targetCoverageDays,
  });
  const label = `${health.skuCode}[${unit.fulfillmentRegion}/${unit.platform}]`;
  const alertType = healthToAlertType(decisionHealth, health.effectiveQty);
  if (alertType && shouldEmitImmediateAlert(alertType, health.avgDaily) && !deferUs) {
    const safetyQty = (health.metrics.safetyStockQty as number) ?? 0;
    const rop = (health.metrics.reorderPoint as number) ?? 0;
    incoming.push({
      skuId: health.skuId,
      warehouseCode: null,
      fulfillmentRegion: unit.fulfillmentRegion,
      platform: unit.platform,
      alertType,
      currentQty: health.effectiveQty,
      safetyQty: alertType === 'below_safety' ? safetyQty : rop || safetyQty,
      skuCode: label,
      displayType: alertType,
    });
  }
  if (decisionHealth === 'gray') return;
  const derived = deriveHorizonAlerts({
    points: timeline.timeline.points.map((point) => ({
      horizonDays: point.horizonDays,
      projectedBalance: point.confirmedEnding,
    })),
    coverageDays: confirmedCoverageDays,
    totalLeadDays: health.totalLeadDays,
    overstockThresholdDays: health.coverage.overstockThresholdDays ?? DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
    stockoutDate: timeline.timeline.stockoutDateConfirmed,
    uncoverableByNewPo: timeline.timeline.uncoverableByNewPo,
  });
  for (const candidate of derived) {
    if (!shouldPersistHorizonAlert(candidate.alertType, decisionHealth)) continue;
    incoming.push({
      skuId: health.skuId,
      warehouseCode: null,
      fulfillmentRegion: unit.fulfillmentRegion,
      platform: unit.platform,
      alertType: candidate.alertType,
      currentQty: candidate.projectedQty,
      safetyQty: candidate.thresholdQty,
      horizonDays: candidate.horizonDays,
      projectedQty: candidate.projectedQty,
      projectedStockoutDate: candidate.projectedStockoutDate,
      skuCode: label,
      displayType: `${candidate.alertType}${candidate.horizonDays != null ? `@${candidate.horizonDays}d` : ''}`,
    });
  }
}
