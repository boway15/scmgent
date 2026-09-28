import { and, desc, eq } from 'drizzle-orm';
import {
  db,
  demandPlanMonthly,
  demandPlanVersions,
  forecastAccuracyMonthly,
  pmcPlanItems,
  pmcPlans,
  purchaseDrafts,
  safetyStockConfig,
  skus,
  spus,
  warehouses,
} from '@scm/db';
import {
  computeSkuWarehouseHealth,
  type SkuHealthRow,
} from './inventory-health-service.js';
import type { InventoryPositionBreakdown } from './inventory-position.js';
import type { ResolvedLeadTime } from './lead-time-resolver.js';
import { loadMergedPublishedForecastBySkuIds } from './forecast-published-resolve.js';
import { loadDailySalesBySkuIds } from './sales-history-query.js';
import { buildSkuWarehouseTimeline } from './inventory-timeline-service.js';
import type { DailyInventoryResult } from './inventory-timeline.js';
import {
  allocateByShare,
  parseSharesFromSnapshot,
  resolvePlanningAllocation,
  type PlanningAllocation,
} from './inventory-share-allocation.js';
import { getLatestInventorySnapshot } from './inventory-snapshot.js';
import { loadOpenLotsForTimeline } from './inventory-supply-lot-sync.js';
import { sumOpenUnallocatedQty } from './inventory-dest-allocation-store.js';
import {
  readTurnoverSnapshot,
  readTurnoverSnapshotAt,
} from './inventory-turnover-snapshot.js';
import {
  calcConfirmedCoverageDays,
  calcTimelineDecisionHealth,
} from './inventory-light.js';
import { DEFAULT_OVERSTOCK_THRESHOLD_DAYS } from './replenishment-coverage.js';
import {
  computeRecentSkuWmape,
  evaluateDemandGate,
  isDemandReconstructCapHit,
  stockoutDaysFromInStockRatio,
} from './planning-demand-gate.js';
import { buildLatePoActions, type LatePoAction } from './planning-late-po-actions.js';

export type SkuPlanningView = {
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  position: InventoryPositionBreakdown;
  leadTime: ResolvedLeadTime;
  avgDaily: number;
  demandSource: 'forecast' | 'historical';
  stockoutAdjusted?: boolean;
  coverageDays: number;
  safetyStockDays: number;
  reorderPoint?: number;
  suggestedQty: number;
  suggestedDate: string;
  healthStatus: string;
  /** 覆盖天数影子灯，不驱动下单 */
  coverageHealthStatus?: string;
  etaAvailableNearest?: string | null;
  stockoutDateEstimate?: string | null;
  timeline?: DailyInventoryResult;
  allocation?: PlanningAllocation;
  unallocatedNetworkQty?: number;
  planningDemandSource?: 'demand_plan' | 'forecast';
  planningDemandFlags?: string[];
  championStockoutDateConfirmed?: string | null;
  championSuggestedQty?: number | null;
  inStockDayRatio?: number | null;
  confirmedCoverageDays?: number | null;
  needsManualConfirm?: boolean;
  demandGateFlags?: string[];
  demandUnconstrainedDaily?: number | null;
  demandStockoutDays?: number | null;
  demandCapped?: boolean;
  suggestedQtyGross?: number | null;
  latePoActions?: LatePoAction[];
};

type PlanningHealth = Pick<
  SkuHealthRow,
  | 'skuId'
  | 'skuCode'
  | 'warehouseCode'
  | 'avgDaily'
  | 'demandSource'
  | 'coverageDays'
  | 'suggestedQty'
  | 'suggestedDate'
  | 'healthStatus'
  | 'metrics'
  | 'position'
  | 'leadTime'
  | 'lifecycle'
  | 'totalLeadDays'
> & {
  coverage: Pick<
    SkuHealthRow['coverage'],
    'safetyStockDays' | 'overstockThresholdDays'
  >;
};

const OPEN_ETA_STATUSES = new Set([
  'draft',
  'confirmed',
  'in_production',
  'ready_to_ship',
  'in_transit',
  'partial_received',
  'exception',
]);

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function estimateStockoutDate(
  avgDaily: number,
  coverageDays: number,
  today = new Date(),
): string | null {
  if (avgDaily <= 0 || !Number.isFinite(coverageDays) || coverageDays < 0) return null;
  const result = new Date(today);
  result.setUTCDate(result.getUTCDate() + Math.floor(coverageDays));
  return isoDate(result);
}

export function pickNearestEtaAvailable(
  rows: Array<{
    etaAvailable: string | null;
    warehouseCode: string | null;
    status: string;
  }>,
  warehouseCode: string,
  today = isoDate(new Date()),
): string | null {
  const candidates = rows
    .filter(
      (row) =>
        row.warehouseCode === warehouseCode &&
        row.etaAvailable != null &&
        row.etaAvailable >= today &&
        OPEN_ETA_STATUSES.has(row.status),
    )
    .map((row) => row.etaAvailable as string)
    .sort((a, b) => a.localeCompare(b));
  return candidates[0] ?? null;
}

export function buildSkuPlanningView(input: {
  health: PlanningHealth;
  etaAvailableNearest?: string | null;
  today?: Date;
  timeline?: DailyInventoryResult | null;
  timelineSuggestedQty?: number;
  allocation?: PlanningAllocation;
  unallocatedNetworkQty?: number;
  planningDemandSource?: 'demand_plan' | 'forecast';
  planningDemandFlags?: string[];
  championStockoutDateConfirmed?: string | null;
  championSuggestedQty?: number | null;
  inStockDayRatio?: number | null;
  demandGate?: ReturnType<typeof evaluateDemandGate>;
  latePoActions?: LatePoAction[];
}): SkuPlanningView {
  const reorderPoint = Number(input.health.metrics.reorderPoint);
  const stockoutFromTimeline = input.timeline?.stockoutDateConfirmed ?? null;
  const coverageHealthStatus = input.health.healthStatus;
  let healthStatus = coverageHealthStatus;
  let confirmedCoverageDays: number | null = null;

  if (input.timeline) {
    const day0 = input.timeline.points.find((p) => p.horizonDays === 0);
    confirmedCoverageDays = calcConfirmedCoverageDays({
      today: input.timeline.today,
      stockoutDateConfirmed: input.timeline.stockoutDateConfirmed,
      confirmedEndingToday: day0?.confirmedEnding ?? 0,
      avgDaily: input.health.avgDaily,
    });
    healthStatus = calcTimelineDecisionHealth({
      today: input.timeline.today,
      totalLeadDays: input.timeline.totalLeadDays,
      safetyStockDays: input.health.coverage.safetyStockDays,
      overstockThresholdDays:
        input.health.coverage.overstockThresholdDays ?? DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
      suggestedQty:
        input.timelineSuggestedQty != null
          ? input.timelineSuggestedQty
          : input.timeline.suggestedQty,
      uncoverableByNewPo: input.timeline.uncoverableByNewPo,
      stockoutDateConfirmed: input.timeline.stockoutDateConfirmed,
      safetyBreachDateConfirmed: input.timeline.safetyBreachDateConfirmed,
      confirmedCoverageDays,
      lifecycle: input.health.lifecycle,
      effectiveQty: input.health.position.effectiveQty,
      avgDaily: input.health.avgDaily,
    });
  }

  return {
    skuId: input.health.skuId,
    skuCode: input.health.skuCode,
    warehouseCode: input.health.warehouseCode,
    position: input.health.position,
    leadTime: input.health.leadTime,
    avgDaily: input.health.avgDaily,
    demandSource: input.health.demandSource,
    ...(input.health.demandSource === 'historical'
      ? { stockoutAdjusted: input.health.metrics.stockoutAdjusted === true }
      : {}),
    coverageDays: input.health.coverageDays,
    safetyStockDays: input.health.coverage.safetyStockDays,
    ...(Number.isFinite(reorderPoint) ? { reorderPoint } : {}),
    suggestedQty:
      input.timelineSuggestedQty != null
        ? input.timelineSuggestedQty
        : input.health.suggestedQty,
    suggestedDate: input.timeline?.reorderDate ?? input.health.suggestedDate,
    healthStatus,
    coverageHealthStatus,
    etaAvailableNearest: input.etaAvailableNearest ?? null,
    stockoutDateEstimate:
      stockoutFromTimeline ??
      estimateStockoutDate(
        input.health.avgDaily,
        input.health.coverageDays,
        input.today,
      ),
    ...(input.timeline ? { timeline: input.timeline } : {}),
    ...(input.allocation ? { allocation: input.allocation } : {}),
    ...(input.unallocatedNetworkQty != null && input.unallocatedNetworkQty > 0
      ? { unallocatedNetworkQty: input.unallocatedNetworkQty }
      : {}),
    ...(input.planningDemandSource
      ? { planningDemandSource: input.planningDemandSource }
      : {}),
    ...(input.planningDemandFlags != null && input.planningDemandFlags.length > 0
      ? { planningDemandFlags: input.planningDemandFlags }
      : {}),
    ...(input.championStockoutDateConfirmed !== undefined
      ? { championStockoutDateConfirmed: input.championStockoutDateConfirmed }
      : {}),
    ...(input.championSuggestedQty !== undefined
      ? { championSuggestedQty: input.championSuggestedQty }
      : {}),
    ...(input.inStockDayRatio !== undefined
      ? { inStockDayRatio: input.inStockDayRatio }
      : {}),
    ...(confirmedCoverageDays != null ? { confirmedCoverageDays } : {}),
    ...(input.timeline?.suggestedQtyGross != null
      ? { suggestedQtyGross: input.timeline.suggestedQtyGross }
      : {}),
    ...(input.demandGate
      ? {
          needsManualConfirm: input.demandGate.needsManualConfirm,
          demandGateFlags: input.demandGate.flags,
          demandUnconstrainedDaily: input.demandGate.demandUnconstrainedDaily,
          demandStockoutDays: input.demandGate.demandStockoutDays,
          demandCapped: input.demandGate.demandCapped,
        }
      : {}),
    ...(input.latePoActions && input.latePoActions.length > 0
      ? { latePoActions: input.latePoActions }
      : {}),
  };
}

export async function getSkuPlanningView(params: {
  skuId: string;
  warehouseCode?: string;
}): Promise<SkuPlanningView | null> {
  const [sku] = await db
    .select({
      id: skus.id,
      code: skus.code,
      spuId: skus.spuId,
      skuMoq: skus.moq,
      spuMoq: spus.moq,
      merchantCode: skus.merchantCode,
      leadTimeDays: skus.leadTimeDays,
      unitCost: skus.unitCost,
      encodingMeta: skus.encodingMeta,
    })
    .from(skus)
    .leftJoin(spus, eq(skus.spuId, spus.id))
    .where(eq(skus.id, params.skuId))
    .limit(1);
  if (!sku) return null;

  const warehouseCondition = params.warehouseCode
    ? and(eq(warehouses.isActive, true), eq(warehouses.code, params.warehouseCode))
    : eq(warehouses.isActive, true);
  const [warehouse] = await db
    .select({
      code: warehouses.code,
      regionGroup: warehouses.regionGroup,
      countryCode: warehouses.countryCode,
    })
    .from(warehouses)
    .where(warehouseCondition)
    .orderBy(warehouses.sortOrder)
    .limit(1);
  if (!warehouse) return null;

  const [policies, salesBySkuId, forecastBySkuId, etaRows] = await Promise.all([
    db.select().from(safetyStockConfig).where(eq(safetyStockConfig.skuId, sku.id)),
    loadDailySalesBySkuIds([sku.id]),
    loadMergedPublishedForecastBySkuIds([sku.id]),
    db
      .select({
        etaAvailable: purchaseDrafts.etaAvailable,
        status: purchaseDrafts.status,
        itemWarehouseCode: pmcPlanItems.warehouseCode,
        planWarehouseCode: pmcPlans.targetWarehouseCode,
      })
      .from(purchaseDrafts)
      .leftJoin(pmcPlanItems, eq(purchaseDrafts.planItemId, pmcPlanItems.id))
      .leftJoin(pmcPlans, eq(pmcPlanItems.planId, pmcPlans.id))
      .where(eq(purchaseDrafts.skuId, sku.id)),
  ]);

  const forecastEntry = forecastBySkuId.get(sku.id) ?? {
    map: new Map<string, number>(),
    lifecycle: undefined,
    versionId: null,
  };
  const share = parseSharesFromSnapshot(readTurnoverSnapshot(sku.encodingMeta));
  const health = await computeSkuWarehouseHealth({
    sku: {
      id: sku.id,
      code: sku.code,
      spuId: sku.spuId,
      merchantCode: sku.merchantCode,
      leadTimeDays: sku.leadTimeDays,
      unitCost: sku.unitCost,
    },
    warehouse,
    salesRows: salesBySkuId.get(sku.id) ?? [],
    policyMap: new Map(policies.map((policy) => [policy.warehouseCode, policy])),
    forecastByStation: new Map(),
    forecastEntry,
    share,
    moq: sku.skuMoq || sku.spuMoq || undefined,
  });
  const etaAvailableNearest = pickNearestEtaAvailable(
    etaRows.map((row) => ({
      etaAvailable: row.etaAvailable,
      status: row.status,
      warehouseCode: row.itemWarehouseCode ?? row.planWarehouseCode,
    })),
    warehouse.code,
  );

  let timeline: DailyInventoryResult | null = null;
  let timelineSuggestedQty: number | undefined;
  let planningDemandSource: 'demand_plan' | 'forecast' | undefined;
  let planningDemandFlags: string[] | undefined;
  let championStockoutDateConfirmed: string | null | undefined;
  let championSuggestedQty: number | null | undefined;
  try {
    const safetyStockQty = Number(health.metrics.safetyStockQty) || 0;
    const built = await buildSkuWarehouseTimeline({
      skuId: sku.id,
      warehouseCode: warehouse.code,
      avgDaily: health.avgDaily,
      forecastMap: forecastEntry.map,
      totalLeadDays: health.totalLeadDays,
      safetyStockDays: health.coverage.safetyStockDays,
      safetyStockQty,
      moq: sku.skuMoq || sku.spuMoq || undefined,
      share,
      includeChampionShadow: true,
    });
    timeline = built.timeline;
    timelineSuggestedQty = built.suggestedQty;
    planningDemandSource = built.planningDemand.source;
    planningDemandFlags = built.planningDemand.flags;
    if (built.championTimeline) {
      championStockoutDateConfirmed = built.championTimeline.stockoutDateConfirmed;
      championSuggestedQty = built.championTimeline.suggestedQty;
    }
  } catch (err) {
    console.warn('[getSkuPlanningView] timeline skipped:', err);
  }
  const snapshotDate = readTurnoverSnapshotAt(sku.encodingMeta)?.slice(0, 10) ?? null;
  const [nativeSnap, overseasSnap, openLots, unallocatedNetworkQty] = await Promise.all([
    getLatestInventorySnapshot(sku.id, warehouse.code),
    getLatestInventorySnapshot(sku.id, 'OVERSEAS'),
    loadOpenLotsForTimeline({ skuId: sku.id, warehouseCode: warehouse.code }),
    sumOpenUnallocatedQty(sku.id),
  ]);
  const overseasLots = openLots.filter((lot) => lot.pool === 'overseas');
  const allocatedQty =
    overseasLots.length > 0
      ? overseasLots.reduce((sum, lot) => sum + lot.qty, 0)
      : (allocateByShare(overseasSnap.qtyAvailable, share).get(warehouse.code) ?? 0);
  const undatedTransitQty = openLots
    .filter((lot) => lot.pool === 'in_transit' && lot.dateUnknown)
    .reduce((sum, lot) => sum + lot.qty, 0);
  const allocation = resolvePlanningAllocation({
    planningWarehouse: warehouse.code,
    nativeWarehouseQty: nativeSnap.qtyAvailable,
    overseasTotal: overseasSnap.qtyAvailable,
    share,
    allocatedQty,
    undatedTransitQty,
    snapshotDate,
  });

  const accuracyRows = await db
    .select({
      station: forecastAccuracyMonthly.station,
      platform: forecastAccuracyMonthly.platform,
      forecastYear: forecastAccuracyMonthly.forecastYear,
      month: forecastAccuracyMonthly.month,
      forecastDailyAvg: forecastAccuracyMonthly.forecastDailyAvg,
      actualDailyAvg: forecastAccuracyMonthly.actualDailyAvg,
      computedAt: forecastAccuracyMonthly.computedAt,
    })
    .from(forecastAccuracyMonthly)
    .where(eq(forecastAccuracyMonthly.skuId, sku.id));

  const [demandAudit] = await db
    .select({
      unconstrainedRecentDaily: demandPlanMonthly.unconstrainedRecentDaily,
      inStockDayRatio: demandPlanMonthly.inStockDayRatio,
      source: demandPlanMonthly.source,
    })
    .from(demandPlanMonthly)
    .innerJoin(demandPlanVersions, eq(demandPlanMonthly.versionId, demandPlanVersions.id))
    .where(
      and(
        eq(demandPlanMonthly.skuId, sku.id),
        eq(demandPlanMonthly.warehouseCode, warehouse.code),
        eq(demandPlanVersions.status, 'pilot_published'),
      ),
    )
    .orderBy(desc(demandPlanMonthly.updatedAt))
    .limit(1);

  const unconstrained =
    demandAudit?.unconstrainedRecentDaily != null
      ? Number(demandAudit.unconstrainedRecentDaily)
      : null;
  const demandGate = evaluateDemandGate({
    reconstructCapHit: isDemandReconstructCapHit({
      source: demandAudit?.source,
      unconstrainedDaily: unconstrained,
      avgDaily: health.avgDaily,
    }),
    unconstrainedDaily: unconstrained,
    stockoutDays: stockoutDaysFromInStockRatio(demandAudit?.inStockDayRatio),
    recentWmape: computeRecentSkuWmape(accuracyRows),
  });

  let latePoActions: LatePoAction[] | undefined;
  if (timeline?.uncoverableByNewPo) {
    const peerWh = await db
      .select({
        code: warehouses.code,
        regionGroup: warehouses.regionGroup,
      })
      .from(warehouses)
      .where(and(eq(warehouses.isActive, true), eq(warehouses.regionGroup, warehouse.regionGroup)));
    const peerWarehouses = [];
    for (const peer of peerWh) {
      if (peer.code === warehouse.code) continue;
      const snap = await getLatestInventorySnapshot(sku.id, peer.code);
      peerWarehouses.push({
        warehouseCode: peer.code,
        regionGroup: peer.regionGroup,
        confirmedAvailableQty: snap.qtyAvailable,
      });
    }
    latePoActions = buildLatePoActions({
      today: timeline.today,
      warehouseCode: warehouse.code,
      regionGroup: warehouse.regionGroup,
      uncoverableByNewPo: true,
      stockoutDateConfirmed: timeline.stockoutDateConfirmed,
      avgDaily: health.avgDaily,
      totalLeadDays: health.totalLeadDays,
      peerWarehouses,
    });
  }

  return buildSkuPlanningView({
    health,
    etaAvailableNearest,
    timeline,
    timelineSuggestedQty,
    allocation,
    unallocatedNetworkQty,
    planningDemandSource,
    planningDemandFlags,
    championStockoutDateConfirmed,
    championSuggestedQty,
    inStockDayRatio:
      demandAudit?.inStockDayRatio != null ? Number(demandAudit.inStockDayRatio) : undefined,
    demandGate,
    latePoActions,
  });
}
