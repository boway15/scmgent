import { sendFeishuGroupMessage } from '../integrations/feishu.js';
import { formatAlertSummary } from '../lib/replenishment.js';
import { generateAlertFeishuMessage } from '../integrations/dify-workflows.js';
import { isAlertWorkflowEnabled } from '../integrations/dify.js';
import {
  computeAllInventoryHealth,
  healthToAlertType,
  type SkuHealthRow,
} from '../lib/inventory-health-service.js';
import { applyStockAlertCoverageReplace, saveHealthSnapshots } from '../lib/inventory-health-store.js';
import {
  regionNetworkEffectiveBySku,
  shouldPersistHorizonAlert,
  type StockAlertIncoming,
} from '../lib/stock-alert-sync.js';
import { syncReplenishLightFromHealth } from '../lib/replenish-light-sync.js';
import { shouldDeferReplenishment } from '../lib/warehouse-domain.js';
import {
  loadOpenLotsBySkuWarehouse,
  syncInventorySupplyLots,
  type OpenTimelineLot,
} from '../lib/inventory-supply-lot-sync.js';
import { assembleWarehouseTimeline } from '../lib/inventory-timeline-service.js';
import { deriveHorizonAlerts, filterSkippedConfirmedHorizonAlerts } from '../lib/inventory-horizon-alerts.js';
import { DEFAULT_OVERSTOCK_THRESHOLD_DAYS } from '../lib/replenishment-coverage.js';
import {
  buildHorizonSkipAllocation,
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
import { loadMergedPublishedForecastBySkuIds } from '../lib/forecast-published-resolve.js';
import {
  loadPlanningDemandDepsForSkus,
  loadPlanningDemandForSkuWarehouse,
  type LoadPlanningDemandDeps,
} from '../lib/demand-plan-load.js';
import { yieldToEventLoop } from '../lib/yield-event-loop.js';
import {
  IN_PRODUCTION_WAREHOUSE,
  UNALLOCATED_TRANSIT_WAREHOUSE,
} from '../lib/inventory-constants.js';

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

  const healthRows = await computeAllInventoryHealth();
  const skuIds = [...new Set(healthRows.map((row) => row.skuId))];
  const bundle = await loadTimelineBundle(skuIds);

  const productionSuffix = `::${IN_PRODUCTION_WAREHOUSE}`;
  const productionQtyBySku = new Map<string, number>();
  for (const [key, snap] of bundle.snapshots) {
    if (!key.endsWith(productionSuffix)) continue;
    productionQtyBySku.set(key.slice(0, -productionSuffix.length), snap.qtyInProduction);
  }
  const usEffectiveBySku = regionNetworkEffectiveBySku({
    rows: healthRows.map((row) => ({
      skuId: row.skuId,
      regionGroup: row.regionGroup,
      effectiveQty: row.effectiveQty,
      qtyInProduction: row.position.qtyInProduction,
    })),
    regionGroup: 'US',
    productionQtyBySku,
  });
  const usRopBySku = new Map<string, number>();
  for (const row of healthRows) {
    if (row.regionGroup !== 'US') continue;
    usRopBySku.set(
      row.skuId,
      (usRopBySku.get(row.skuId) ?? 0) + ((row.metrics.reorderPoint as number) ?? 0),
    );
  }

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

      collectAlerts(
        row,
        built,
        bundle.snapshots,
        share,
        usEffectiveBySku,
        usRopBySku,
        incoming,
      );
    } catch (err) {
      timelineErrors += 1;
      console.warn(`[stockAlert] timeline skipped ${row.skuCode}/${row.warehouseCode}:`, err);
    }
  }

  console.info(
    `[stockAlert] timelines done rows=${healthRows.length} elapsed=${Date.now() - tTimeline}ms errors=${timelineErrors} candidates=${incoming.length}`,
  );

  await saveHealthSnapshots(healthRows);
  await syncReplenishLightFromHealth(healthRows);

  const coverage = await applyStockAlertCoverageReplace(incoming);
  const { invalidateAlertActionCache } = await import('../lib/alert-action-index.js');
  invalidateAlertActionCache();
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

function collectAlerts(
  row: SkuHealthRow,
  built: Awaited<ReturnType<typeof projectRow>>,
  snapshots: Map<string, InventorySnapshot>,
  share: ShareParseResult,
  usEffectiveBySku: Map<string, number>,
  usRopBySku: Map<string, number>,
  incoming: StockAlertIncoming[],
) {
  const alertType = healthToAlertType(row.healthStatus, row.effectiveQty);
  if (alertType) {
    let deferImmediate = false;
    if (row.regionGroup === 'US') {
      const warehouseRop = (row.metrics.reorderPoint as number) ?? 0;
      deferImmediate = shouldDeferReplenishment({
        warehouseEffective: row.effectiveQty,
        warehouseRop,
        networkEffective: usEffectiveBySku.get(row.skuId) ?? row.effectiveQty,
        networkRop: usRopBySku.get(row.skuId) ?? 0,
      });
    }
    if (!deferImmediate) {
      const safetyQty = (row.metrics.safetyStockQty as number) ?? 0;
      const rop = (row.metrics.reorderPoint as number) ?? 0;
      const threshold = alertType === 'below_safety' ? safetyQty : rop || safetyQty;
      incoming.push({
        skuId: row.skuId,
        warehouseCode: row.warehouseCode,
        alertType,
        currentQty: row.effectiveQty,
        safetyQty: threshold,
        skuCode: `${row.skuCode}[${row.warehouseCode}]`,
        displayType: alertType,
      });
    }
  }

  if (row.healthStatus === 'gray') return;

  const timeline = built.timeline;
  const day0 = timeline.points.find((point) => point.horizonDays === 0);
  const coverageDays = calcConfirmedCoverageDays({
    today: timeline.today,
    stockoutDateConfirmed: timeline.stockoutDateConfirmed,
    confirmedEndingToday: day0?.confirmedEnding ?? 0,
    avgDaily: row.avgDaily,
  });
  const derived = deriveHorizonAlerts({
    points: timeline.points.map((point) => ({
      horizonDays: point.horizonDays,
      projectedBalance: point.confirmedEnding,
    })),
    coverageDays,
    totalLeadDays: row.totalLeadDays,
    overstockThresholdDays: row.coverage.overstockThresholdDays ?? DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
    stockoutDate: timeline.stockoutDateConfirmed,
    uncoverableByNewPo: timeline.uncoverableByNewPo,
  });
  const nativeQty = snapshotOf(snapshots, row.skuId, row.warehouseCode).qtyAvailable;
  const skipConfirmed = buildHorizonSkipAllocation({
    share,
    planningWarehouse: row.warehouseCode,
    nativeQty,
    overseasRecordsQty: snapshotOf(snapshots, row.skuId, UNALLOCATED_TRANSIT_WAREHOUSE).qtyAvailable,
  }).shouldSkip;
  const horizonCandidates = filterSkippedConfirmedHorizonAlerts(derived, skipConfirmed);
  for (const candidate of horizonCandidates) {
    if (!shouldPersistHorizonAlert(candidate.alertType, row.healthStatus)) continue;
    incoming.push({
      skuId: row.skuId,
      warehouseCode: row.warehouseCode,
      alertType: candidate.alertType,
      currentQty: candidate.projectedQty,
      safetyQty: candidate.thresholdQty,
      horizonDays: candidate.horizonDays,
      projectedQty: candidate.projectedQty,
      projectedStockoutDate: candidate.projectedStockoutDate,
      skuCode: `${row.skuCode}[${row.warehouseCode}]`,
      displayType: `${candidate.alertType}${candidate.horizonDays != null ? `@${candidate.horizonDays}d` : ''}`,
    });
  }
}
