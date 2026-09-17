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

function todayIso(d = new Date()): string {
  return d.toISOString().slice(0, 10);
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
}): Promise<{
  timeline: DailyInventoryResult;
  suggestedQty: number;
  reservedQty: number;
}> {
  const today = params.today ?? new Date();
  const todayStr = todayIso(today);
  const snap = await getLatestInventorySnapshot(params.skuId, params.warehouseCode);
  const reservedQty = Math.max(0, snap.qtyReserved);

  let forecastMap = params.forecastMap;
  if (!forecastMap) {
    const merged = await loadMergedPublishedForecastBySkuIds([params.skuId]);
    forecastMap = merged.get(params.skuId)?.map;
  }
  forecastMap = forecastMap ?? new Map<string, number>();

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
  if (!hasConfirmedOverseas && snap.qtyAvailable > 0) {
    lots.push({
      supplyClass: 'confirmed',
      pool: 'overseas',
      qty: snap.qtyAvailable,
      availableAt: todayStr,
    });
  }

  const dailyDemandFn = (k: number) => {
    if (params.avgDaily <= 0 && forecastMap.size === 0) return 0;
    const asOf = addDaysIso(todayStr, k);
    return getForecastDailyForDate(
      forecastMap,
      new Date(`${asOf}T00:00:00.000Z`),
      params.avgDaily,
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

  return { timeline, suggestedQty: timeline.suggestedQty, reservedQty };
}
