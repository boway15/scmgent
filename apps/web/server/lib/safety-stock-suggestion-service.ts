import { inArray } from 'drizzle-orm';
import { db, forecastAccuracyMonthly, skus } from '@scm/db';
import { calcForwardAvgDaily } from './forecast-demand.js';
import { loadMergedPublishedForecastBySkuIds } from './forecast-published-resolve.js';
import {
  loadHistoricalAvailabilityBySkuIds,
  loadLeadTimeCaches,
  loadSkuShare,
  resolveHistoricalDemand,
  shareFromEncodingMeta,
} from './inventory-health-service.js';
import {
  resolveWarehouseDemandShare,
  scaleDailyMapByShare,
} from './inventory-share-allocation.js';
import {
  resolveLeadTimeForSkuWarehouse,
  resolveLeadTimeFromCaches,
} from './lead-time-resolver.js';
import { calcDailyStats } from './replenishment.js';
import { loadDailySalesBySkuIds, loadDailySalesForSku } from './sales-history-query.js';
import { replenishmentSalesLookbackDays } from './sales-history-config.js';
import {
  calcSafetyStockSuggestion,
  type SafetyStockSuggestion,
} from './safety-stock-suggestion.js';
import { coalesceLeadTimeStdDev, selectDemandStdDev } from './safety-stock-z.js';
import { DEFAULT_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';
import { summarizePrecisionWindow } from './planning-demand-gate.js';

export { DEFAULT_SAFETY_STOCK_DAYS as DEFAULT_CONFIGURED_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';

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

export type SuggestionPairInput = {
  sku: { id: string; code?: string; merchantCode: string | null; leadTimeDays: number | null };
  warehouseCode: string;
  policy?: {
    safetyStockDays: number | null;
    safetyStockQty: number;
    reorderPoint: number;
    safetyStockMethod: string;
  } | null;
};

function positionKey(skuId: string, warehouseCode: string) {
  return `${skuId}::${warehouseCode}`;
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

function buildSuggestionFromCaches(params: {
  input: SuggestionPairInput;
  windowDays: number;
  serviceLevel?: number;
  sales: Array<{ qtySold: number; saleDate: string; warehouseCode: string | null }>;
  forecastEntry?: { map: Map<string, number>; lifecycle?: string } | null;
  share: ReturnType<typeof shareFromEncodingMeta>;
  leadTime: { totalLeadDays: number; leadTimeStdDev?: number | null };
  forecastErrorStdDev?: number | null;
  inventoryRows: Array<{ recordedDate: string | Date; qtyAvailable: number; createdAt: Date }>;
}): SafetyStockSuggestionRow {
  const whSales = filterSalesByWarehouse(params.sales, params.input.warehouseCode);
  const effectiveSalesDays = countEffectiveSalesDays(whSales, params.windowDays);
  const hasForecast = (params.forecastEntry?.map.size ?? 0) > 0;

  let avgDaily = 0;
  let stockoutAdjusted = false;
  let inStockDays = 0;
  let demandSource: 'forecast' | 'historical' = 'historical';

  if (hasForecast && params.forecastEntry) {
    const stats = calcDailyStats(whSales, params.windowDays);
    const demandShare = resolveWarehouseDemandShare(params.input.warehouseCode, params.share);
    avgDaily = calcForwardAvgDaily(
      scaleDailyMapByShare(params.forecastEntry.map, demandShare),
      new Date(),
      90,
      stats.avgDaily,
    );
    demandSource = 'forecast';
  } else {
    const historical = resolveHistoricalDemand({
      sales: whSales,
      inventoryRows: params.inventoryRows,
      windowDays: params.windowDays,
    });
    avgDaily = historical.avgDaily;
    stockoutAdjusted = historical.stockoutAdjusted;
    inStockDays = historical.inStockDays;
  }

  const stats = calcDailyStats(whSales, params.windowDays);
  const historicalStdDev =
    stats.stdDev > 0 && whSales.length >= 2 ? stats.stdDev : avgDaily > 0 ? avgDaily * 0.3 : 0;
  const demandStdDev = selectDemandStdDev({
    forecastErrorStdDev: params.forecastErrorStdDev,
    historicalStdDev,
  }).stdDev;

  const configured = {
    safetyStockDays: params.input.policy?.safetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS,
    safetyStockQty: params.input.policy?.safetyStockQty ?? 0,
    reorderPoint: params.input.policy?.reorderPoint ?? 0,
    safetyStockMethod: params.input.policy?.safetyStockMethod ?? 'coverage_days',
  };

  const suggested = calcSafetyStockSuggestion({
    avgDaily,
    demandStdDev,
    totalLeadDays: params.leadTime.totalLeadDays,
    serviceLevel: params.serviceLevel,
    inStockDays,
    stockoutAdjusted,
    demandSource,
    effectiveSalesDays,
    leadTimeStdDev: coalesceLeadTimeStdDev(params.leadTime.leadTimeStdDev),
  });

  return buildSuggestionRow({
    skuId: params.input.sku.id,
    skuCode: params.input.sku.code ?? params.input.sku.id,
    warehouseCode: params.input.warehouseCode,
    configured,
    suggested,
  });
}

/** 当前页 pair 批量计算建议：销量/预测/交期/日序列预加载后在内存计算 */
export async function resolveSuggestionInputsBatch(params: {
  pairs: SuggestionPairInput[];
  serviceLevel?: number;
}): Promise<SafetyStockSuggestionRow[]> {
  if (!params.pairs.length) return [];

  const windowDays = replenishmentSalesLookbackDays();
  const skuIds = [...new Set(params.pairs.map((p) => p.sku.id))];

  const [salesBySkuId, forecastBySkuId, leadTimeCaches, skuShareRows, accuracyRows] = await Promise.all([
    loadDailySalesBySkuIds(skuIds, windowDays),
    loadMergedPublishedForecastBySkuIds(skuIds),
    loadLeadTimeCaches(skuIds),
    db
      .select({ id: skus.id, encodingMeta: skus.encodingMeta })
      .from(skus)
      .where(inArray(skus.id, skuIds)),
    db
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
      .where(inArray(forecastAccuracyMonthly.skuId, skuIds)),
  ]);
  const errorStdDevBySku = new Map<string, number>();
  const accuracyBySku = new Map<string, typeof accuracyRows>();
  for (const row of accuracyRows) {
    const list = accuracyBySku.get(row.skuId) ?? [];
    list.push(row);
    accuracyBySku.set(row.skuId, list);
  }
  for (const [skuId, rows] of accuracyBySku) {
    const errorStdDev = summarizePrecisionWindow(rows).errorStdDev;
    if (errorStdDev != null && errorStdDev > 0) errorStdDevBySku.set(skuId, errorStdDev);
  }

  const shareBySku = new Map(
    skuShareRows.map((row) => [row.id, shareFromEncodingMeta(row.encodingMeta)] as const),
  );

  const noForecastSkuIds = skuIds.filter((id) => {
    const entry = forecastBySkuId.get(id);
    return !entry?.map.size;
  });
  const availabilityByKey = await loadHistoricalAvailabilityBySkuIds({
    skuIds: noForecastSkuIds,
    windowDays,
  });

  return params.pairs.map((input) => {
    const forecastEntry = forecastBySkuId.get(input.sku.id) ?? null;
    const hasForecast = (forecastEntry?.map.size ?? 0) > 0;
    const leadTime = resolveLeadTimeFromCaches(
      {
        skuId: input.sku.id,
        merchantCode: input.sku.merchantCode,
        warehouseCode: input.warehouseCode,
        skuLeadTimeDays: input.sku.leadTimeDays,
      },
      leadTimeCaches,
    );
    return buildSuggestionFromCaches({
      input,
      windowDays,
      serviceLevel: params.serviceLevel,
      sales: salesBySkuId.get(input.sku.id) ?? [],
      forecastEntry,
      share: shareBySku.get(input.sku.id) ?? shareFromEncodingMeta(null),
      leadTime,
      forecastErrorStdDev: errorStdDevBySku.get(input.sku.id) ?? null,
      inventoryRows: hasForecast
        ? []
        : (availabilityByKey.get(positionKey(input.sku.id, input.warehouseCode)) ?? []),
    });
  });
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

  const leadTime = await resolveLeadTimeForSkuWarehouse({
    skuId: params.sku.id,
    merchantCode: params.sku.merchantCode,
    warehouseCode: params.warehouseCode,
    skuLeadTimeDays: params.sku.leadTimeDays,
  });

  const forecastMerged = await loadMergedPublishedForecastBySkuIds([params.sku.id]);
  const forecastEntry = forecastMerged.get(params.sku.id) ?? null;
  const hasForecast = (forecastEntry?.map.size ?? 0) > 0;

  const inventoryRows = hasForecast
    ? []
    : ((
        await loadHistoricalAvailabilityBySkuIds({
          skuIds: [params.sku.id],
          windowDays,
        })
      ).get(positionKey(params.sku.id, params.warehouseCode)) ?? []);

  return buildSuggestionFromCaches({
    input: {
      sku: params.sku,
      warehouseCode: params.warehouseCode,
      policy: params.policy,
    },
    windowDays,
    serviceLevel: params.serviceLevel,
    sales,
    forecastEntry,
    share: await loadSkuShare(params.sku.id),
    leadTime,
    inventoryRows,
  });
}
