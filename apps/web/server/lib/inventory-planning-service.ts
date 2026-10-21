import { and, desc, eq } from 'drizzle-orm';
import {
  db,
  demandPlanMonthly,
  demandPlanVersions,
  forecastAccuracyMonthly,
  inventorySupplyLots,
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
import {
  resolveInventoryPosition,
  type InventoryPositionBreakdown,
} from './inventory-position.js';
import {
  resolveLeadTimeForSkuWarehouse,
  resolveNetworkOrderLeadDays,
  resolvePreShipmentLeadTimeForSku,
  type ResolvedLeadTime,
} from './lead-time-resolver.js';
import { loadMergedPublishedForecastBySkuIds } from './forecast-published-resolve.js';
import { loadDailySalesBySkuIds } from './sales-history-query.js';
import {
  buildSkuNetworkTimeline,
  buildSkuWarehouseTimeline,
} from './inventory-timeline-service.js';
import type { DailyInventoryResult } from './inventory-timeline.js';
import {
  allocateByShare,
  parseSharesFromSnapshot,
  resolvePlanningAllocation,
  type PlanningAllocation,
} from './inventory-share-allocation.js';
import { getLatestInventorySnapshot } from './inventory-snapshot.js';
import {
  loadOpenLotsForNetworkTimeline,
  loadOpenLotsForTimeline,
} from './inventory-supply-lot-sync.js';
import { sumOpenUnallocatedQty } from './inventory-dest-allocation-store.js';
import {
  readTurnoverSnapshot,
  readTurnoverSnapshotAt,
} from './inventory-turnover-snapshot.js';
import {
  calcConfirmedCoverageDays,
  calcTimelineDecisionHealth,
  type InventoryHealth,
} from './inventory-light.js';
import {
  attachHealthStatusToWarehouses,
  loadLatestHealthByWarehouseForSku,
} from './sku-health-aggregate.js';
import {
  DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
  DEFAULT_SAFETY_STOCK_DAYS,
} from './replenishment-coverage.js';
import {
  evaluateDemandGate,
  isDemandReconstructCapHit,
  stockoutDaysFromInStockRatio,
  summarizePrecisionWindow,
} from './planning-demand-gate.js';
import { parseProfileSegment, profileClassFromSegment } from './forecast-profile-class.js';
import { buildLatePoActions, type LatePoAction } from './planning-late-po-actions.js';
import { isAccessorySku } from './sku-encoding.js';
import {
  IN_PRODUCTION_WAREHOUSE,
  UNALLOCATED_TRANSIT_WAREHOUSE,
} from './inventory-constants.js';
import { DEMAND_PLAN_WAREHOUSE_ALL } from './demand-plan-config.js';
import { poolNetworkSafetyStockQty } from './network-replenishment.js';
import { loadPlanningDemandForSkuWarehouse } from './demand-plan-load.js';

export type NetworkSupplyPools = {
  localQty: number;
  inTransitQty: number;
  overseasQty: number;
  dateUnknownQty: number;
  nearestAvailableAt: string | null;
};

export type NetworkWarehouseSummary = {
  warehouseCode: string;
  effectiveQty: number;
  nearestAvailableAt: string | null;
  stockoutDateConfirmed?: string | null;
  coverageDays?: number | null;
  healthStatus?: InventoryHealth | null;
};

export type SkuPlanningView = {
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  scope: 'network' | 'warehouse';
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
  supplyPools?: NetworkSupplyPools;
  warehouses?: NetworkWarehouseSummary[];
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
  isAccessory?: boolean;
};

const NETWORK_VIEW_EXCLUDED_WAREHOUSES = new Set([
  IN_PRODUCTION_WAREHOUSE,
  UNALLOCATED_TRANSIT_WAREHOUSE,
  DEMAND_PLAN_WAREHOUSE_ALL,
]);

export function aggregateNetworkSupplyPools(
  lots: ReadonlyArray<{
    pool: 'overseas' | 'in_transit' | 'local';
    qty: number;
    availableAt: string | null;
    dateUnknown: boolean;
  }>,
): NetworkSupplyPools {
  let localQty = 0;
  let inTransitQty = 0;
  let overseasQty = 0;
  let dateUnknownQty = 0;
  const dates: string[] = [];
  for (const lot of lots) {
    if (lot.pool === 'local') localQty += lot.qty;
    else if (lot.pool === 'in_transit') inTransitQty += lot.qty;
    else overseasQty += lot.qty;
    if (lot.dateUnknown || !lot.availableAt) dateUnknownQty += lot.qty;
    else dates.push(lot.availableAt);
  }
  dates.sort((a, b) => a.localeCompare(b));
  return {
    localQty,
    inTransitQty,
    overseasQty,
    dateUnknownQty,
    nearestAvailableAt: dates[0] ?? null,
  };
}

export function summarizeNetworkWarehouses(params: {
  physicalWarehouses: ReadonlyArray<string>;
  effectiveByWarehouse: ReadonlyMap<string, number>;
  lotEtas: ReadonlyArray<{ warehouseCode: string; availableAt: string | null; dateUnknown: boolean }>;
  today?: string;
}): NetworkWarehouseSummary[] {
  const today = params.today ?? isoDate(new Date());
  const nearestByWh = new Map<string, string>();
  for (const lot of params.lotEtas) {
    if (lot.dateUnknown || !lot.availableAt || lot.availableAt < today) continue;
    if (NETWORK_VIEW_EXCLUDED_WAREHOUSES.has(lot.warehouseCode)) continue;
    const prev = nearestByWh.get(lot.warehouseCode);
    if (!prev || lot.availableAt < prev) nearestByWh.set(lot.warehouseCode, lot.availableAt);
  }
  return params.physicalWarehouses.map((warehouseCode) => ({
    warehouseCode,
    effectiveQty: params.effectiveByWarehouse.get(warehouseCode) ?? 0,
    nearestAvailableAt: nearestByWh.get(warehouseCode) ?? null,
  }));
}

export function resolvePlanningScope(params: {
  warehouseCode?: string;
  scope?: string;
}): 'network' | 'warehouse' {
  const scopeRaw = params.scope?.trim().toLowerCase();
  const warehouse = params.warehouseCode?.trim();
  if (scopeRaw === 'warehouse' && warehouse && warehouse !== DEMAND_PLAN_WAREHOUSE_ALL) {
    return 'warehouse';
  }
  if (scopeRaw === 'network' || !warehouse || warehouse === DEMAND_PLAN_WAREHOUSE_ALL) {
    return 'network';
  }
  return 'warehouse';
}

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
  scope?: 'network' | 'warehouse';
  supplyPools?: NetworkSupplyPools;
  warehouses?: NetworkWarehouseSummary[];
  planningDemandSource?: 'demand_plan' | 'forecast';
  planningDemandFlags?: string[];
  championStockoutDateConfirmed?: string | null;
  championSuggestedQty?: number | null;
  inStockDayRatio?: number | null;
  demandGate?: ReturnType<typeof evaluateDemandGate>;
  latePoActions?: LatePoAction[];
  isAccessory?: boolean;
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
    scope: input.scope ?? 'warehouse',
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
    ...(input.supplyPools ? { supplyPools: input.supplyPools } : {}),
    ...(input.warehouses && input.warehouses.length > 0
      ? { warehouses: input.warehouses }
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
    ...(input.isAccessory ? { isAccessory: true } : {}),
  };
}

export async function getSkuNetworkPlanningView(params: {
  skuId: string;
}): Promise<SkuPlanningView | null> {
  const [sku] = await db
    .select({
      id: skus.id,
      code: skus.code,
      skuKind: skus.skuKind,
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

  const [policies, forecastBySkuId, physicalWh, openLots, openLotRows, unallocatedNetworkQty, lead] =
    await Promise.all([
      db.select().from(safetyStockConfig).where(eq(safetyStockConfig.skuId, sku.id)),
      loadMergedPublishedForecastBySkuIds([sku.id]),
      db
        .select({
          code: warehouses.code,
          regionGroup: warehouses.regionGroup,
          countryCode: warehouses.countryCode,
        })
        .from(warehouses)
        .where(eq(warehouses.isActive, true))
        .orderBy(warehouses.sortOrder),
      loadOpenLotsForNetworkTimeline({ skuId: sku.id }),
      db
        .select({
          warehouseCode: inventorySupplyLots.warehouseCode,
          availableAt: inventorySupplyLots.availableAt,
          dateUnknown: inventorySupplyLots.dateUnknown,
          qty: inventorySupplyLots.qty,
        })
        .from(inventorySupplyLots)
        .where(
          and(eq(inventorySupplyLots.skuId, sku.id), eq(inventorySupplyLots.status, 'open')),
        ),
      sumOpenUnallocatedQty(sku.id),
      resolvePreShipmentLeadTimeForSku({
        skuId: sku.id,
        merchantCode: sku.merchantCode,
        skuLeadTimeDays: sku.leadTimeDays,
      }),
    ]);

  const physicalCodes = physicalWh
    .map((row) => row.code)
    .filter((code) => !NETWORK_VIEW_EXCLUDED_WAREHOUSES.has(code));

  const forecastEntry = forecastBySkuId.get(sku.id) ?? {
    map: new Map<string, number>(),
    lifecycle: undefined,
    versionId: null,
    profileSegment: undefined,
    profileClass: null,
    p90Map: undefined,
  };
  const planningDemand = await loadPlanningDemandForSkuWarehouse({
    skuId: sku.id,
    warehouseCode: DEMAND_PLAN_WAREHOUSE_ALL,
    championForecastMap: forecastEntry.map,
  });
  const avgDaily = planningDemand.fallbackDaily;
  const demandSource: 'forecast' | 'historical' =
    planningDemand.source === 'demand_plan' || forecastEntry.map.size > 0
      ? 'forecast'
      : 'historical';

  const safetyStockDays = policies
    .filter((row) => !NETWORK_VIEW_EXCLUDED_WAREHOUSES.has(row.warehouseCode))
    .reduce(
      (max, row) => Math.max(max, row.safetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS),
      DEFAULT_SAFETY_STOCK_DAYS,
    );
  const networkSafety = {
    safetyStockDays,
    safetyStockQty: poolNetworkSafetyStockQty({
      networkAvgDaily: avgDaily,
      safetyStockDays,
    }),
  };

  const shareParsed = parseSharesFromSnapshot(readTurnoverSnapshot(sku.encodingMeta));
  const leadWarehouses = physicalCodes.filter((code) => {
    const weight = shareParsed.weights.find((row) => row.warehouse === code)?.weight ?? 0;
    const hasLot = openLotRows.some((lot) => lot.warehouseCode === code && Number(lot.qty) > 0);
    return weight > 0 || hasLot;
  });
  const fullLeads = await Promise.all(
    leadWarehouses.map((warehouseCode) =>
      resolveLeadTimeForSkuWarehouse({
        skuId: sku.id,
        merchantCode: sku.merchantCode,
        warehouseCode,
        skuLeadTimeDays: sku.leadTimeDays,
      }),
    ),
  );
  const networkLeadDays = resolveNetworkOrderLeadDays({
    productionDays: lead.totalLeadDays,
    warehouseLeadDays: fullLeads.map((row) => row.totalLeadDays),
  });
  const longest = fullLeads.reduce<ResolvedLeadTime | null>(
    (best, row) => (!best || row.totalLeadDays > best.totalLeadDays ? row : best),
    null,
  );
  const leadTime: ResolvedLeadTime =
    longest && longest.totalLeadDays >= lead.totalLeadDays
      ? { ...longest, warehouseCode: DEMAND_PLAN_WAREHOUSE_ALL }
      : {
          ...lead,
          totalLeadDays: networkLeadDays,
          warehouseCode: DEMAND_PLAN_WAREHOUSE_ALL,
        };

  const supplyPools = aggregateNetworkSupplyPools(openLots);
  const [positions, healthByWarehouse] = await Promise.all([
    Promise.all(
      physicalCodes.map(async (warehouseCode) => {
        const position = await resolveInventoryPosition({
          skuId: sku.id,
          warehouseCode,
        });
        return { warehouseCode, position };
      }),
    ),
    loadLatestHealthByWarehouseForSku(sku.id),
  ]);
  const effectiveByWarehouse = new Map(
    positions.map((row) => [row.warehouseCode, row.position.effectiveQty]),
  );
  const totalEffective = positions.reduce((sum, row) => sum + row.position.effectiveQty, 0);
  const warehousesSummary = attachHealthStatusToWarehouses(
    summarizeNetworkWarehouses({
      physicalWarehouses: physicalCodes,
      effectiveByWarehouse,
      lotEtas: openLotRows,
    }),
    healthByWarehouse,
  );

  let timeline: DailyInventoryResult | null = null;
  let timelineSuggestedQty: number | undefined;
  let planningDemandSource: 'demand_plan' | 'forecast' | undefined;
  let planningDemandFlags: string[] | undefined;
  let championStockoutDateConfirmed: string | null | undefined;
  let championSuggestedQty: number | null | undefined;
  try {
    const built = await buildSkuNetworkTimeline({
      skuId: sku.id,
      avgDaily,
      forecastMap: forecastEntry.map,
      farHorizon: {
        profileClass:
          forecastEntry.profileClass ?? profileClassFromSegment(forecastEntry.profileSegment),
        p90: forecastEntry.p90Map,
      },
      totalLeadDays: leadTime.totalLeadDays,
      safetyStockDays: networkSafety.safetyStockDays,
      safetyStockQty: networkSafety.safetyStockQty,
      moq: sku.skuMoq || sku.spuMoq || undefined,
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
    console.warn('[getSkuNetworkPlanningView] timeline skipped:', err);
  }

  const day0 = timeline?.points.find((p) => p.horizonDays === 0);
  const coverageDays =
    timeline != null
      ? calcConfirmedCoverageDays({
          today: timeline.today,
          stockoutDateConfirmed: timeline.stockoutDateConfirmed,
          confirmedEndingToday: day0?.confirmedEnding ?? 0,
          avgDaily,
        })
      : avgDaily > 0
        ? totalEffective / avgDaily
        : Number.POSITIVE_INFINITY;

  const position: InventoryPositionBreakdown = {
    qtyAvailable: positions.reduce((sum, row) => sum + row.position.qtyAvailable, 0),
    qtyInProduction: supplyPools.localQty,
    qtyInTransit: supplyPools.inTransitQty,
    qtyConfirmedOpen: positions.reduce((sum, row) => sum + row.position.qtyConfirmedOpen, 0),
    qtyReserved: positions.reduce((sum, row) => sum + row.position.qtyReserved, 0),
    qtyBackorder: positions.reduce((sum, row) => sum + row.position.qtyBackorder, 0),
    effectiveQty: totalEffective,
    sources: [],
    dedupeMode: 'snapshot_only',
    unassignedOpenQty: unallocatedNetworkQty,
  };

  const suggestedDate = timeline?.reorderDate ?? isoDate(new Date());
  const healthStatus =
    timeline != null
      ? calcTimelineDecisionHealth({
          today: timeline.today,
          totalLeadDays: timeline.totalLeadDays,
          safetyStockDays: networkSafety.safetyStockDays,
          overstockThresholdDays: DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
          suggestedQty: timelineSuggestedQty ?? timeline.suggestedQty,
          uncoverableByNewPo: timeline.uncoverableByNewPo,
          stockoutDateConfirmed: timeline.stockoutDateConfirmed,
          safetyBreachDateConfirmed: timeline.safetyBreachDateConfirmed,
          confirmedCoverageDays: coverageDays,
          lifecycle: forecastEntry.lifecycle,
          effectiveQty: totalEffective,
          avgDaily,
        })
      : 'green';

  return buildSkuPlanningView({
    health: {
      skuId: sku.id,
      skuCode: sku.code,
      warehouseCode: DEMAND_PLAN_WAREHOUSE_ALL,
      avgDaily,
      demandSource,
      coverageDays: Number.isFinite(coverageDays) ? coverageDays : Number.POSITIVE_INFINITY,
      suggestedQty: timelineSuggestedQty ?? 0,
      suggestedDate,
      healthStatus,
      metrics: { reorderPoint: avgDaily * leadTime.totalLeadDays },
      coverage: {
        safetyStockDays: networkSafety.safetyStockDays,
        overstockThresholdDays: DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
      },
      position,
      leadTime,
      lifecycle: forecastEntry.lifecycle,
      totalLeadDays: leadTime.totalLeadDays,
    },
    etaAvailableNearest: supplyPools.nearestAvailableAt,
    timeline,
    timelineSuggestedQty,
    unallocatedNetworkQty,
    scope: 'network',
    supplyPools,
    warehouses: warehousesSummary,
    planningDemandSource,
    planningDemandFlags,
    championStockoutDateConfirmed,
    championSuggestedQty,
    isAccessory: isAccessorySku({ code: sku.code, skuKind: sku.skuKind }),
  });
}

export async function getSkuPlanningView(params: {
  skuId: string;
  warehouseCode?: string;
  scope?: string;
}): Promise<SkuPlanningView | null> {
  if (resolvePlanningScope(params) === 'network') {
    return getSkuNetworkPlanningView({ skuId: params.skuId });
  }

  const [sku] = await db
    .select({
      id: skus.id,
      code: skus.code,
      skuKind: skus.skuKind,
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

  const warehouseCondition = and(
    eq(warehouses.isActive, true),
    eq(warehouses.code, params.warehouseCode!),
  );
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
  const planningDemand = await loadPlanningDemandForSkuWarehouse({
    skuId: sku.id,
    warehouseCode: warehouse.code,
    championForecastMap: forecastEntry.map,
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
  const accuracySummary = summarizePrecisionWindow(accuracyRows);
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
    planningDemand,
    forecastErrorStdDev: accuracySummary.errorStdDev,
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
    recentWmape: accuracySummary.wmape,
    segment: parseProfileSegment(forecastEntry.profileSegment),
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
    scope: 'warehouse',
    planningDemandSource,
    planningDemandFlags,
    championStockoutDateConfirmed,
    championSuggestedQty,
    inStockDayRatio:
      demandAudit?.inStockDayRatio != null ? Number(demandAudit.inStockDayRatio) : undefined,
    demandGate,
    latePoActions,
    isAccessory: isAccessorySku({ code: sku.code, skuKind: sku.skuKind }),
  });
}
