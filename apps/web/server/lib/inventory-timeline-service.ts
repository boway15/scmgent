import { eq } from 'drizzle-orm';
import { db, skus } from '@scm/db';
import {
  classifySupplyLot,
  projectDailyInventory,
  type DailyInventoryResult,
  type DailyLot,
} from './inventory-timeline.js';
import { loadOpenLotsForTimeline } from './inventory-supply-lot-sync.js';
import { getForecastDailyForDate } from './forecast-demand.js';
import { loadMergedPublishedForecastBySkuIds } from './forecast-published-resolve.js';
import { getLatestInventorySnapshot } from './inventory-snapshot.js';
import { addDaysIso } from './inventory-supply-lots.js';
import {
  allocateByShare,
  parseSharesFromSnapshot,
  type ShareParseResult,
} from './inventory-share-allocation.js';
import { readTurnoverSnapshot } from './inventory-turnover-snapshot.js';
import { loadPlanningDemandForSkuWarehouse } from './demand-plan-load.js';
import {
  pickDemandMapForTimeline,
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
  return input.source === 'demand_plan' ? input.planningFallbackDaily : input.avgDaily;
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
}): Promise<{
  timeline: DailyInventoryResult;
  suggestedQty: number;
  reservedQty: number;
  planningDemand: PlanningDemandResult;
  championTimeline?: DailyInventoryResult;
}> {
  const today = params.today ?? new Date();
  const todayStr = todayIso(today);
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
  const reservedQty = resolveReservedQty({
    warehouseReserved: snap.qtyReserved,
    overseasReserved: overseasSnap.qtyReserved,
    share,
    planningWarehouse: params.warehouseCode,
  });

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
  const timelineMap = pickDemandMapForTimeline({
    source: planningDemand.source,
    demandMap: planningDemand.demandMap,
    stationForecastMap,
  });
  const fallbackDaily = pickTimelineFallbackDaily({
    source: planningDemand.source,
    planningFallbackDaily: planningDemand.fallbackDaily,
    avgDaily: params.avgDaily,
  });

  const openLots = await loadOpenLotsForTimeline({
    skuId: params.skuId,
    warehouseCode: params.warehouseCode,
    today: todayStr,
  });

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

  const hasConfirmedOverseas = lots.some(
    (lot) => lot.supplyClass === 'confirmed' && lot.pool === 'overseas',
  );
  if (
    shouldBackfillNativeAvailable(
      hasConfirmedOverseas,
      snap.qtyAvailable,
      params.warehouseCode,
    )
  ) {
    lots.push({
      supplyClass: 'confirmed',
      pool: 'overseas',
      qty: snap.qtyAvailable,
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
