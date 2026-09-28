import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { db, inventoryRecords } from '@scm/db';
import { calcForwardAvgDaily } from './forecast-demand.js';
import { loadMergedPublishedForecastBySkuIds } from './forecast-published-resolve.js';
import { loadSkuShare, resolveHistoricalDemand } from './inventory-health-service.js';
import {
  resolveWarehouseDemandShare,
  scaleDailyMapByShare,
} from './inventory-share-allocation.js';
import { resolveLeadTimeForSkuWarehouse } from './lead-time-resolver.js';
import { calcDailyStats } from './replenishment.js';
import { loadDailySalesForSku } from './sales-history-query.js';
import { replenishmentSalesLookbackDays } from './sales-history-config.js';
import {
  calcSafetyStockSuggestion,
  type SafetyStockSuggestion,
} from './safety-stock-suggestion.js';

export const DEFAULT_CONFIGURED_SAFETY_STOCK_DAYS = 14;

export type SafetyStockSuggestionRow = {
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  configured: {
    safetyStockDays: number | null;
    safetyStockQty: number;
    reorderPoint: number;
    safetyStockMethod: string;
  };
  suggested: SafetyStockSuggestion;
  deltaDays: number | null;
  deltaQty: number | null;
  deltaPctDays: number | null;
};

type HistoricalInventoryRow = {
  recordedDate: string | Date;
  qtyAvailable: number;
  createdAt: Date;
};

function dateKey(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

async function loadDailyAvailability(params: {
  skuId: string;
  warehouseCode: string;
  windowDays: number;
  asOf?: Date;
}): Promise<HistoricalInventoryRow[]> {
  const asOf = params.asOf ?? new Date();
  const windowStart = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
  windowStart.setUTCDate(windowStart.getUTCDate() - params.windowDays);

  return db
    .select({
      recordedDate: inventoryRecords.recordedDate,
      qtyAvailable: inventoryRecords.qtyAvailable,
      createdAt: inventoryRecords.createdAt,
    })
    .from(inventoryRecords)
    .where(
      and(
        eq(inventoryRecords.skuId, params.skuId),
        eq(inventoryRecords.warehouse, params.warehouseCode),
        gte(inventoryRecords.recordedDate, dateKey(windowStart)),
        lt(inventoryRecords.recordedDate, dateKey(asOf)),
      ),
    )
    .orderBy(asc(inventoryRecords.recordedDate), asc(inventoryRecords.createdAt));
}

function filterSalesByWarehouse(
  sales: Array<{ qtySold: number; saleDate: string; warehouseCode: string | null }>,
  warehouseCode: string,
) {
  if (warehouseCode === 'ALL') {
    return sales.map((s) => ({ qtySold: s.qtySold, saleDate: s.saleDate }));
  }
  const whSales = sales
    .filter((s) => s.warehouseCode === warehouseCode)
    .map((s) => ({ qtySold: s.qtySold, saleDate: s.saleDate }));
  if (whSales.length > 0) return whSales;
  return sales.map((s) => ({ qtySold: s.qtySold, saleDate: s.saleDate }));
}

function countEffectiveSalesDays(sales: Array<{ saleDate: string }>, windowDays: number): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const dates = new Set<string>();
  for (const sale of sales) {
    if (new Date(sale.saleDate) >= cutoff) dates.add(sale.saleDate.slice(0, 10));
  }
  return dates.size;
}

export function buildSuggestionRow(params: {
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  configured: SafetyStockSuggestionRow['configured'];
  suggested: SafetyStockSuggestion;
}): SafetyStockSuggestionRow {
  const configuredDays = params.configured.safetyStockDays;
  const suggestedDays = params.suggested.safetyStockDays;
  const suggestedQty = params.suggested.safetyStockQty;

  const deltaDays =
    suggestedDays != null && configuredDays != null ? suggestedDays - configuredDays : null;
  const deltaQty =
    suggestedQty != null ? suggestedQty - params.configured.safetyStockQty : null;
  const deltaPctDays =
    configuredDays != null && configuredDays > 0 && deltaDays != null
      ? Math.abs(deltaDays) / configuredDays
      : null;

  return {
    skuId: params.skuId,
    skuCode: params.skuCode,
    warehouseCode: params.warehouseCode,
    configured: params.configured,
    suggested: params.suggested,
    deltaDays,
    deltaQty,
    deltaPctDays,
  };
}

export function sortSuggestionRows(
  rows: SafetyStockSuggestionRow[],
  sort: 'deltaDays_desc' | 'deltaDays_asc' | 'skuCode',
): SafetyStockSuggestionRow[] {
  const copy = [...rows];
  if (sort === 'skuCode') {
    copy.sort((a, b) => a.skuCode.localeCompare(b.skuCode));
    return copy;
  }
  copy.sort((a, b) => {
    const aDelta = Math.abs(a.deltaDays ?? 0);
    const bDelta = Math.abs(b.deltaDays ?? 0);
    return sort === 'deltaDays_desc' ? bDelta - aDelta : aDelta - bDelta;
  });
  return copy;
}

export async function resolveSuggestionInputs(params: {
  sku: { id: string; code?: string; merchantCode: string | null; leadTimeDays: number | null };
  warehouseCode: string;
  serviceLevel?: number;
  policy?: {
    safetyStockDays: number | null;
    safetyStockQty: number;
    reorderPoint: number;
    safetyStockMethod: string;
  } | null;
}): Promise<SafetyStockSuggestionRow> {
  const windowDays = replenishmentSalesLookbackDays();
  const sales = await loadDailySalesForSku(params.sku.id, windowDays);
  const whSales = filterSalesByWarehouse(sales, params.warehouseCode);
  const effectiveSalesDays = countEffectiveSalesDays(whSales, windowDays);

  const leadTime = await resolveLeadTimeForSkuWarehouse({
    skuId: params.sku.id,
    merchantCode: params.sku.merchantCode,
    warehouseCode: params.warehouseCode,
    skuLeadTimeDays: params.sku.leadTimeDays,
  });

  const forecastMerged = await loadMergedPublishedForecastBySkuIds([params.sku.id]);
  const forecastEntry = forecastMerged.get(params.sku.id);
  const hasForecast = (forecastEntry?.map.size ?? 0) > 0;

  let avgDaily = 0;
  let stockoutAdjusted = false;
  let inStockDays = 0;
  let demandSource: 'forecast' | 'historical' = 'historical';

  if (hasForecast && forecastEntry) {
    const stats = calcDailyStats(whSales, windowDays);
    const demandShare = resolveWarehouseDemandShare(
      params.warehouseCode,
      await loadSkuShare(params.sku.id),
    );
    avgDaily = calcForwardAvgDaily(
      scaleDailyMapByShare(forecastEntry.map, demandShare),
      new Date(),
      90,
      stats.avgDaily,
    );
    demandSource = 'forecast';
  } else {
    const inventoryRows = await loadDailyAvailability({
      skuId: params.sku.id,
      warehouseCode: params.warehouseCode,
      windowDays,
    });
    const historical = resolveHistoricalDemand({
      sales: whSales,
      inventoryRows,
      windowDays,
    });
    avgDaily = historical.avgDaily;
    stockoutAdjusted = historical.stockoutAdjusted;
    inStockDays = historical.inStockDays;
  }

  const stats = calcDailyStats(whSales, windowDays);
  const demandStdDev =
    stats.stdDev > 0 && whSales.length >= 2 ? stats.stdDev : avgDaily > 0 ? avgDaily * 0.3 : 0;

  const configured = {
    safetyStockDays: params.policy?.safetyStockDays ?? DEFAULT_CONFIGURED_SAFETY_STOCK_DAYS,
    safetyStockQty: params.policy?.safetyStockQty ?? 0,
    reorderPoint: params.policy?.reorderPoint ?? 0,
    safetyStockMethod: params.policy?.safetyStockMethod ?? 'coverage_days',
  };

  const suggested = calcSafetyStockSuggestion({
    avgDaily,
    demandStdDev,
    totalLeadDays: leadTime.totalLeadDays,
    serviceLevel: params.serviceLevel,
    inStockDays,
    stockoutAdjusted,
    demandSource,
    effectiveSalesDays,
  });

  return buildSuggestionRow({
    skuId: params.sku.id,
    skuCode: params.sku.code ?? params.sku.id,
    warehouseCode: params.warehouseCode,
    configured,
    suggested,
  });
}
