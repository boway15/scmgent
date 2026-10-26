import { eq } from 'drizzle-orm';
import { db, skus, warehouses } from '@scm/db';
import {
  classifySupplyLot,
  projectDailyInventory,
  type DailyInventoryResult,
  type DailyLot,
} from './inventory-timeline.js';
import {
  loadOpenLotsForNetworkTimeline,
  loadOpenLotsForTimeline,
  type OpenTimelineLot,
} from './inventory-supply-lot-sync.js';
import { getForecastDailyForDate, type ForecastHorizonContext } from './forecast-demand.js';
import { loadMergedPublishedForecastBySkuIds } from './forecast-published-resolve.js';
import { getLatestInventorySnapshot, type InventorySnapshot } from './inventory-snapshot.js';
import { addDaysIso } from './inventory-supply-lots.js';
import {
  allocateByShare,
  parseSharesFromSnapshot,
  type ShareParseResult,
} from './inventory-share-allocation.js';
import {
  IN_PRODUCTION_WAREHOUSE,
  UNALLOCATED_TRANSIT_WAREHOUSE,
} from './inventory-constants.js';
import { DEMAND_PLAN_WAREHOUSE_ALL } from './demand-plan-config.js';
import { readTurnoverSnapshot } from './inventory-turnover-snapshot.js';
import { loadPlanningDemandForSkuWarehouse } from './demand-plan-load.js';
import {
  type PlanningDemandResult,
} from './demand-plan-resolve.js';

function todayIso(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function pickTimelineFallbackDaily(input: {
  source: 'demand_plan' | 'forecast';
  planningFallbackDaily: number;
  avgDaily: number;
}): number {
  if (input.source === 'demand_plan') return input.planningFallbackDaily;
  if (input.planningFallbackDaily > 0) return input.planningFallbackDaily;
  return input.avgDaily;
}

export function resolveReservedQty(params: {
  warehouseReserved: number;
  overseasReserved: number;
  share: ShareParseResult;
  planningWarehouse: string;
}): number {
  const warehouseReserved = Math.max(0, params.warehouseReserved);
  if (warehouseReserved > 0) return warehouseReserved;
  if (params.share.method === 'unallocated') return 0;
  return (
    allocateByShare(Math.max(0, params.overseasReserved), params.share).get(
      params.planningWarehouse,
    ) ?? 0
  );
}

/** 无海外确定批时只用本仓 records 补当天可售，禁止把 OVERSEAS 全量填进目的仓。 */
export function shouldBackfillNativeAvailable(
  hasConfirmedOverseas: boolean,
  nativeQtyAvailable: number,
  warehouseCode: string,
): boolean {
  return (
    !hasConfirmedOverseas && nativeQtyAvailable > 0 && warehouseCode !== 'OVERSEAS'
  );
}

const NETWORK_BACKFILL_EXCLUDED = new Set([
  IN_PRODUCTION_WAREHOUSE,
  UNALLOCATED_TRANSIT_WAREHOUSE,
  DEMAND_PLAN_WAREHOUSE_ALL,
]);

/** 网络时间轴：各物理仓 native 可售合计补当天确定供给（不含 OVERSEAS 逻辑仓）。 */
export function buildNetworkNativeBackfillLot(params: {
  hasConfirmedOverseas: boolean;
  nativeAvailableByWarehouse: ReadonlyArray<{ warehouseCode: string; qtyAvailable: number }>;
  today: string;
}): DailyLot | null {
  if (params.hasConfirmedOverseas) return null;
  let total = 0;
  for (const row of params.nativeAvailableByWarehouse) {
    if (NETWORK_BACKFILL_EXCLUDED.has(row.warehouseCode)) continue;
    total += Math.max(0, row.qtyAvailable);
  }
  if (total <= 0) return null;
  return {
    supplyClass: 'confirmed',
    pool: 'overseas',
    qty: total,
    availableAt: params.today,
  };
}

export async function resolveNetworkReservedQty(skuId: string): Promise<number> {
  const whRows = await db
    .select({ code: warehouses.code })
    .from(warehouses)
    .where(eq(warehouses.isActive, true));

  let total = 0;
  for (const wh of whRows) {
    if (
      wh.code === UNALLOCATED_TRANSIT_WAREHOUSE ||
      wh.code === IN_PRODUCTION_WAREHOUSE ||
      wh.code === DEMAND_PLAN_WAREHOUSE_ALL
    ) {
      continue;
    }
    const snap = await getLatestInventorySnapshot(skuId, wh.code);
    total += Math.max(0, snap.qtyReserved);
  }
  const overseasSnap = await getLatestInventorySnapshot(skuId, UNALLOCATED_TRANSIT_WAREHOUSE);
  total += Math.max(0, overseasSnap.qtyReserved);
  return total;
}

function mapOpenLotsToDailyLots(openLots: OpenTimelineLot[], todayStr: string): DailyLot[] {
  const lots: DailyLot[] = [];
  for (const lot of openLots) {
    const supplyClass = classifySupplyLot({
      pool: lot.pool,
      availableAt: lot.availableAt,
      productionStatus: lot.productionStatus,
      shipReadyAt: lot.shipReadyAt,
      etaEstimated: lot.etaEstimated,
      dateUnknown: lot.dateUnknown,
      today: todayStr,
    });
    if (supplyClass === 'excluded') continue;
    if (lot.availableAt == null) continue;
    lots.push({
      supplyClass,
      pool: lot.pool,
      qty: lot.qty,
      availableAt: lot.availableAt,
    });
  }
  return lots;
}

export function assembleWarehouseTimeline(params: {
  today?: Date;
  warehouseCode: string;
  avgDaily: number;
  totalLeadDays: number;
  safetyStockDays: number;
  safetyStockQty: number;
  moq?: number;
  share: ShareParseResult;
  snapshot: InventorySnapshot;
  overseasSnapshot: InventorySnapshot;
  openLots: OpenTimelineLot[];
  planningDemand: PlanningDemandResult;
  includeChampionShadow?: boolean;
  /** 仅销售预测曲线使用。需求计划周曲线不传。 */
  farHorizon?: ForecastHorizonContext | null;
  coverDays?: number;
}): {
  timeline: DailyInventoryResult;
  suggestedQty: number;
  reservedQty: number;
  planningDemand: PlanningDemandResult;
  championTimeline?: DailyInventoryResult;
} {
  const today = params.today ?? new Date();
  const todayStr = todayIso(today);
  const reservedQty = resolveReservedQty({
    warehouseReserved: params.snapshot.qtyReserved,
    overseasReserved: params.overseasSnapshot.qtyReserved,
    share: params.share,
    planningWarehouse: params.warehouseCode,
  });
  const planningDemand = params.planningDemand;
  const timelineMap = planningDemand.demandMap;
  const fallbackDaily = pickTimelineFallbackDaily({
    source: planningDemand.source,
    planningFallbackDaily: planningDemand.fallbackDaily,
    avgDaily: params.avgDaily,
  });
  const lots = mapOpenLotsToDailyLots(params.openLots, todayStr);
  const hasConfirmedOverseas = lots.some(
    (lot) => lot.supplyClass === 'confirmed' && lot.pool === 'overseas',
  );
  if (
    shouldBackfillNativeAvailable(
      hasConfirmedOverseas,
      params.snapshot.qtyAvailable,
      params.warehouseCode,
    )
  ) {
    lots.push({
      supplyClass: 'confirmed',
      pool: 'overseas',
      qty: params.snapshot.qtyAvailable,
      availableAt: todayStr,
    });
  }

  const dailyDemandFn = (k: number) => {
    if (fallbackDaily <= 0 && timelineMap.size === 0) return 0;
    const asOf = addDaysIso(todayStr, k);
    return getForecastDailyForDate(
      timelineMap,
      new Date(`${asOf}T00:00:00.000Z`),
      fallbackDaily,
      planningDemand.source === 'forecast'
        ? params.farHorizon
          ? { ...params.farHorizon, asOf: params.farHorizon.asOf ?? today }
          : null
        : null,
    );
  };

  const timeline = projectDailyInventory({
    lots,
    today: todayStr,
    reservedQty,
    totalLeadDays: params.totalLeadDays,
    safetyStockDays: params.safetyStockDays,
    safetyStockQty: params.safetyStockQty,
    moq: params.moq,
    dailyDemandFn,
    coverDays: params.coverDays,
  });

  let championTimeline: DailyInventoryResult | undefined;
  if (params.includeChampionShadow && planningDemand.championMap.size > 0) {
    championTimeline = projectDailyInventory({
      lots,
      today: todayStr,
      reservedQty,
      totalLeadDays: params.totalLeadDays,
      safetyStockDays: params.safetyStockDays,
      safetyStockQty: params.safetyStockQty,
      moq: params.moq,
      dailyDemandFn: (k: number) => {
        const asOf = addDaysIso(todayStr, k);
        return getForecastDailyForDate(
          planningDemand.championMap,
          new Date(`${asOf}T00:00:00.000Z`),
          params.avgDaily,
        );
      },
      coverDays: params.coverDays,
    });
  }

  return {
    timeline,
    suggestedQty: timeline.suggestedQty,
    reservedQty,
    planningDemand,
    ...(championTimeline ? { championTimeline } : {}),
  };
}

export async function buildSkuWarehouseTimeline(params: {
  skuId: string;
  warehouseCode: string;
  avgDaily: number;
  forecastMap?: Map<string, number>;
  totalLeadDays: number;
  safetyStockDays: number;
  safetyStockQty: number;
  moq?: number;
  today?: Date;
  share?: ShareParseResult;
  encodingMeta?: unknown;
  includeChampionShadow?: boolean;
  coverDays?: number;
}): Promise<{
  timeline: DailyInventoryResult;
  suggestedQty: number;
  reservedQty: number;
  planningDemand: PlanningDemandResult;
  championTimeline?: DailyInventoryResult;
}> {
  const today = params.today ?? new Date();
  const skipSkuLookup = params.share != null || params.encodingMeta !== undefined;
  const [snap, overseasSnap, skuRow] = await Promise.all([
    getLatestInventorySnapshot(params.skuId, params.warehouseCode),
    getLatestInventorySnapshot(params.skuId, 'OVERSEAS'),
    skipSkuLookup
      ? Promise.resolve(undefined)
      : db
          .select({ encodingMeta: skus.encodingMeta })
          .from(skus)
          .where(eq(skus.id, params.skuId))
          .limit(1)
          .then((rows) => rows[0]),
  ]);
  const share =
    params.share ??
    parseSharesFromSnapshot(
      readTurnoverSnapshot(
        params.encodingMeta !== undefined ? params.encodingMeta : skuRow?.encodingMeta,
      ),
    );
  let forecastMap = params.forecastMap;
  if (!forecastMap) {
    const merged = await loadMergedPublishedForecastBySkuIds([params.skuId]);
    forecastMap = merged.get(params.skuId)?.map;
  }
  const stationForecastMap = forecastMap ?? new Map<string, number>();

  const planningDemand = await loadPlanningDemandForSkuWarehouse({
    skuId: params.skuId,
    warehouseCode: params.warehouseCode,
    championForecastMap: stationForecastMap,
  });
  const openLots = await loadOpenLotsForTimeline({
    skuId: params.skuId,
    warehouseCode: params.warehouseCode,
    today: todayIso(today),
  });

  return assembleWarehouseTimeline({
    today,
    warehouseCode: params.warehouseCode,
    avgDaily: params.avgDaily,
    totalLeadDays: params.totalLeadDays,
    safetyStockDays: params.safetyStockDays,
    safetyStockQty: params.safetyStockQty,
    moq: params.moq,
    share,
    snapshot: snap,
    overseasSnapshot: overseasSnap,
    openLots,
    planningDemand,
    includeChampionShadow: params.includeChampionShadow,
    coverDays: params.coverDays,
  });
}

/** SKU 级网络时间轴：聚合全仓 open lots + 网络需求（warehouse=ALL），交期由调用方传纯生产段。 */
export async function buildSkuNetworkTimeline(params: {
  skuId: string;
  avgDaily: number;
  forecastMap?: Map<string, number>;
  totalLeadDays: number;
  safetyStockDays: number;
  safetyStockQty: number;
  moq?: number;
  today?: Date;
  encodingMeta?: unknown;
  includeChampionShadow?: boolean;
  farHorizon?: ForecastHorizonContext | null;
  coverDays?: number;
}): Promise<{
  timeline: DailyInventoryResult;
  suggestedQty: number;
  reservedQty: number;
  planningDemand: PlanningDemandResult;
  championTimeline?: DailyInventoryResult;
}> {
  const today = params.today ?? new Date();
  const todayStr = todayIso(today);
  const [reservedQty, whRows] = await Promise.all([
    resolveNetworkReservedQty(params.skuId),
    db
      .select({ code: warehouses.code })
      .from(warehouses)
      .where(eq(warehouses.isActive, true)),
  ]);

  let forecastMap = params.forecastMap;
  if (!forecastMap) {
    const merged = await loadMergedPublishedForecastBySkuIds([params.skuId]);
    forecastMap = merged.get(params.skuId)?.map;
  }
  const stationForecastMap = forecastMap ?? new Map<string, number>();

  const planningDemand = await loadPlanningDemandForSkuWarehouse({
    skuId: params.skuId,
    warehouseCode: DEMAND_PLAN_WAREHOUSE_ALL,
    championForecastMap: stationForecastMap,
  });
  const timelineMap = planningDemand.demandMap;
  const fallbackDaily = pickTimelineFallbackDaily({
    source: planningDemand.source,
    planningFallbackDaily: planningDemand.fallbackDaily,
    avgDaily: params.avgDaily,
  });

  const openLots = await loadOpenLotsForNetworkTimeline({ skuId: params.skuId });
  const lots = mapOpenLotsToDailyLots(openLots, todayStr);

  const hasConfirmedOverseas = lots.some(
    (lot) => lot.supplyClass === 'confirmed' && lot.pool === 'overseas',
  );
  const physicalCodes = whRows
    .map((row) => row.code)
    .filter((code) => !NETWORK_BACKFILL_EXCLUDED.has(code));
  const nativeSnaps = await Promise.all(
    physicalCodes.map(async (warehouseCode) => {
      const snap = await getLatestInventorySnapshot(params.skuId, warehouseCode);
      return { warehouseCode, qtyAvailable: snap.qtyAvailable };
    }),
  );
  const backfill = buildNetworkNativeBackfillLot({
    hasConfirmedOverseas,
    nativeAvailableByWarehouse: nativeSnaps,
    today: todayStr,
  });
  if (backfill) lots.push(backfill);

  const dailyDemandFn = (k: number) => {
    if (fallbackDaily <= 0 && timelineMap.size === 0) return 0;
    const asOf = addDaysIso(todayStr, k);
    return getForecastDailyForDate(
      timelineMap,
      new Date(`${asOf}T00:00:00.000Z`),
      fallbackDaily,
      planningDemand.source === 'forecast'
        ? params.farHorizon
          ? { ...params.farHorizon, asOf: params.farHorizon.asOf ?? today }
          : null
        : null,
    );
  };

  const timeline = projectDailyInventory({
    lots,
    today: todayStr,
    reservedQty,
    totalLeadDays: params.totalLeadDays,
    safetyStockDays: params.safetyStockDays,
    safetyStockQty: params.safetyStockQty,
    moq: params.moq,
    dailyDemandFn,
    coverDays: params.coverDays,
  });

  let championTimeline: DailyInventoryResult | undefined;
  if (params.includeChampionShadow && planningDemand.championMap.size > 0) {
    championTimeline = projectDailyInventory({
      lots,
      today: todayStr,
      reservedQty,
      totalLeadDays: params.totalLeadDays,
      safetyStockDays: params.safetyStockDays,
      safetyStockQty: params.safetyStockQty,
      moq: params.moq,
      dailyDemandFn: (k: number) => {
        const asOf = addDaysIso(todayStr, k);
        return getForecastDailyForDate(
          planningDemand.championMap,
          new Date(`${asOf}T00:00:00.000Z`),
          params.avgDaily,
        );
      },
      coverDays: params.coverDays,
    });
  }

  return {
    timeline,
    suggestedQty: timeline.suggestedQty,
    reservedQty,
    planningDemand,
    ...(championTimeline ? { championTimeline } : {}),
  };
}
