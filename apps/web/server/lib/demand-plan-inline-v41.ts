/**
 * 周需求计划内联 V4.1：与月销量预测同一套 computeAllCatV41ForecastForMonth，
 * 不依赖 sales_forecast 已发布/草稿版本。
 */
import type { DailySalesPoint } from './sales-history-query.js';
import {
  classifySalesLifecycle,
  roundDaily,
  DEFAULT_SALES_HISTORY_LOOKBACK_DAYS,
} from './forecast-baseline.js';
import { aggregateForecastRows, forecastMonthKey, formatForecastMonth } from './forecast-demand.js';
import {
  computeAllCatV41ForecastForMonth,
  isAllCatV41Forecastable,
  isAllCatV41RecentSalesAbsent,
  parseAllCatV41HorizonFactors,
} from './forecast-allcat-v41.js';
import { computeAgeDaysFromFirstSale } from './forecast-collaboration.js';
import { resolveRecentDemandWindows } from './forecast-demand-unconstrain.js';
import { FORECAST_V41_PLATFORM_CODES } from './forecast-platform-scope.js';
import { resolveAnchorProfileSegment } from './forecast-horizon.js';
import type { ForecastHorizonCell } from './forecast-horizon.js';

type MonthlySalesRow = { saleYear: number; month: number; qtySold: number };

export type DemandPlanInlineV41SkuInput = {
  productCategory?: string | null;
  category?: string | null;
  forceForecast?: boolean | null;
};

export type DemandPlanInlineV41Result = {
  mergedMap: Map<string, number>;
  monthByPlatform: Map<string, Map<string, number>>;
  profileSegment: string | null;
  lifecycle: string | null;
  monthCells: ForecastHorizonCell[];
};

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sumQtySince(rows: Array<{ saleDate: string; qtySold: number }>, since: Date): number {
  const sinceKey = toDateOnly(since);
  return rows.reduce((sum, row) => {
    return String(row.saleDate).slice(0, 10) >= sinceKey ? sum + Number(row.qtySold) : sum;
  }, 0);
}

function countSalesDaysSince(rows: Array<{ saleDate: string; qtySold: number }>, since: Date): number {
  const sinceKey = toDateOnly(since);
  const days = new Set<string>();
  for (const row of rows) {
    const saleDate = String(row.saleDate).slice(0, 10);
    if (saleDate >= sinceKey && Number(row.qtySold) > 0) {
      days.add(saleDate);
    }
  }
  return days.size;
}

function computeMaxZeroRunDays(
  rows: Array<{ saleDate: string; qtySold: number }>,
  start: Date,
  end: Date,
): number {
  const qtyByDate = new Map(rows.map((row) => [String(row.saleDate).slice(0, 10), Number(row.qtySold)]));
  let maxRun = 0;
  let currentRun = 0;
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const qty = qtyByDate.get(toDateOnly(cursor)) ?? 0;
    if (qty <= 0) {
      currentRun += 1;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  return maxRun;
}

function mapDailyRows(rows: DailySalesPoint[]): Array<{ saleDate: string; qtySold: number }> {
  return rows.map((row) => ({ saleDate: row.saleDate, qtySold: row.qtySold }));
}

function parseHorizonMonthKey(monthKey: string): { forecastYear: number; month: number } {
  const [year, month] = monthKey.split('-').map(Number);
  return { forecastYear: year!, month: month! };
}

/** 单 SKU：分平台 V4.1 → 全平台合计月曲线 + 矩阵/抽屉用 horizon cells */
export function computeDemandPlanInlineV41ForSku(input: {
  sku: DemandPlanInlineV41SkuInput;
  windowEnd: Date;
  horizonMonthKeys: string[];
  dailyAllRows: DailySalesPoint[];
  dailyByPlatform: Map<string, DailySalesPoint[]>;
  monthlyByPlatform: Map<string, MonthlySalesRow[]>;
  flexBiasShadow?: boolean;
  firstSaleDate?: string | null;
}): DemandPlanInlineV41Result {
  const empty: DemandPlanInlineV41Result = {
    mergedMap: new Map(),
    monthByPlatform: new Map(),
    profileSegment: null,
    lifecycle: null,
    monthCells: [],
  };

  const recentWindowEnd = input.windowEnd;
  const historyCapEnd = input.windowEnd;
  const recent30Since = addDays(recentWindowEnd, -29);
  const recent90Since = addDays(recentWindowEnd, -89);
  const allChannelRows = mapDailyRows(input.dailyAllRows);
  const allRecent30DailyAvg = roundDaily(sumQtySince(allChannelRows, recent30Since) / 30);

  const forecastDraftRows: Array<{
    forecastYear: number;
    month: number;
    forecastDailyAvg: number;
    platform: string;
    profileSegment: string;
  }> = [];
  const monthByPlatform = new Map<string, Map<string, number>>();
  const tierPickRows: Array<{
    forecastYear: number;
    month: number;
    platform: string;
    profileSegment: string | null;
  }> = [];

  let anchorLifecycle: string | null = null;
  const displayV41ByMonth = new Map<string, ReturnType<typeof computeAllCatV41ForecastForMonth>>();

  for (const platform of FORECAST_V41_PLATFORM_CODES) {
    const rawSalesRows = mapDailyRows(input.dailyByPlatform.get(platform) ?? []);
    const monthlySalesRows = input.monthlyByPlatform.get(platform) ?? [];
    const platformLookbackQty = rawSalesRows.reduce((sum, row) => sum + row.qtySold, 0);
    if (platformLookbackQty <= 0 && !(input.sku.forceForecast ?? false)) {
      continue;
    }

    const calendar90 = roundDaily(sumQtySince(rawSalesRows, recent90Since) / 90);
    const calendar30 = roundDaily(sumQtySince(rawSalesRows, recent30Since) / 30);
    const salesDays90 = countSalesDaysSince(rawSalesRows, recent90Since);
    const ageDays = computeAgeDaysFromFirstSale(input.firstSaleDate ?? null, addDays(recentWindowEnd, 1));
    const maxZeroRunDays = computeMaxZeroRunDays(rawSalesRows, recent90Since, recentWindowEnd);
    const lifecycle = classifySalesLifecycle({
      ageDays,
      salesDayRatio90: salesDays90 / 90,
      recent30DailyAvg: calendar30,
      recent90DailyAvg: calendar90,
      maxZeroRunDays,
    });
    if (!anchorLifecycle) anchorLifecycle = lifecycle;

    const recentWindows = resolveRecentDemandWindows({
      sales: rawSalesRows,
      recent30Since,
      recent90Since,
      recentWindowEnd,
      lifecycle,
      firstSaleDate: input.firstSaleDate ?? null,
    });
    const recent30DailyAvg = recentWindows.recent30DailyAvg;
    const recent90DailyAvg = recentWindows.recent90DailyAvg;
    const peerPlatformRecentDaily = roundDaily(Math.max(0, allRecent30DailyAvg - calendar30));

    const firstMonth = parseHorizonMonthKey(input.horizonMonthKeys[0] ?? forecastMonthKey(recentWindowEnd.getUTCFullYear(), recentWindowEnd.getUTCMonth() + 1));
    const anchorV41 = computeAllCatV41ForecastForMonth({
      productCategory: input.sku.productCategory ?? input.sku.category,
      platform,
      forecastYear: firstMonth.forecastYear,
      forecastMonth: firstMonth.month,
      horizonIndex: 0,
      monthlyRows: monthlySalesRows,
      recent30DailyAvg,
      recent90DailyAvg,
      peerPlatformRecentDaily,
      historyCapEnd,
      demandReconstruct: recentWindows.demandReconstruct,
      flexBiasShadow: input.flexBiasShadow,
    });
    const anchorTier = anchorV41.tier;

    if (
      (anchorTier === 'T4A' || anchorTier === 'T4B') &&
      !(input.sku.forceForecast ?? false) &&
      isAllCatV41RecentSalesAbsent({
        recent30DailyAvg,
        recent90DailyAvg,
        metrics: anchorV41.metrics,
        tier: anchorTier === 'T4A' || anchorTier === 'T4B' ? anchorTier : undefined,
      })
    ) {
      continue;
    }

    tierPickRows.push({
      forecastYear: firstMonth.forecastYear,
      month: firstMonth.month,
      platform,
      profileSegment: anchorTier,
    });

    const platformMonthMap = new Map<string, number>();
    monthByPlatform.set(platform, platformMonthMap);

    input.horizonMonthKeys.forEach((monthKey, horizonIndex) => {
      const { forecastYear, month } = parseHorizonMonthKey(monthKey);
      const v41 = computeAllCatV41ForecastForMonth({
        productCategory: input.sku.productCategory ?? input.sku.category,
        platform,
        forecastYear,
        forecastMonth: month,
        horizonIndex,
        monthlyRows: monthlySalesRows,
        recent30DailyAvg,
        recent90DailyAvg,
        peerPlatformRecentDaily,
        historyCapEnd,
        demandReconstruct: recentWindows.demandReconstruct,
        flexBiasShadow: input.flexBiasShadow,
      });
      if (!isAllCatV41Forecastable(anchorV41.tier) && v41.forecastDaily <= 0) {
        return;
      }
      if (platform === 'AMAZON' || !displayV41ByMonth.has(monthKey)) {
        displayV41ByMonth.set(monthKey, v41);
      }
      platformMonthMap.set(monthKey, v41.forecastDaily);
      forecastDraftRows.push({
        forecastYear,
        month,
        forecastDailyAvg: v41.forecastDaily,
        platform,
        profileSegment: anchorTier,
      });
    });
  }

  if (!forecastDraftRows.length) {
    return empty;
  }

  const mergedMap = aggregateForecastRows(forecastDraftRows);
  const profileSegment = resolveAnchorProfileSegment(tierPickRows);

  const monthCells: ForecastHorizonCell[] = input.horizonMonthKeys.map((monthKey) => {
    const { forecastYear, month } = parseHorizonMonthKey(monthKey);
    const monthLabel = formatForecastMonth(forecastYear, month);
    const forecastDailyAvg = mergedMap.get(monthKey) ?? 0;
    const displayV41 = displayV41ByMonth.get(monthKey);

    return {
      id: `inline-v41-${monthKey}`,
      forecastYear,
      month,
      monthLabel,
      forecastDailyAvg,
      manualDailyAvg: null,
      effectiveDailyAvg: forecastDailyAvg,
      adjustReason: null,
      baselineDailyAvg: displayV41 ? roundDaily(displayV41.baseDaily) : null,
      lifecycle: anchorLifecycle,
      confidenceLevel: displayV41?.confidenceLevel ?? null,
      skuTrendFactor: null,
      seasonalityFactor: 1,
      trendFactor: 1,
      categoryCombinedFactor: 1,
      categoryTrendWasClipped: false,
      categoryTrendMatched: false,
      horizonFactors: null,
      allCatV41Factors: displayV41
        ? parseAllCatV41HorizonFactors(displayV41.horizonFactors)
        : null,
      forecastModel: 'allcat_v41_inline',
    };
  });

  return {
    mergedMap,
    monthByPlatform,
    profileSegment,
    lifecycle: anchorLifecycle,
    monthCells,
  };
}

export function demandPlanInlineV41HistoryLookbackDays(): number {
  return DEFAULT_SALES_HISTORY_LOOKBACK_DAYS;
}

/** SKU 抽屉：无已发布月版本时内联 V4.1 对照曲线 */
export async function loadDemandPlanSkuInlineV41Horizon(input: {
  skuId: string;
  sku: DemandPlanInlineV41SkuInput;
  windowEnd: Date;
  horizonMonthKeys: string[];
  firstSaleDate?: string | null;
  flexBiasShadow?: boolean;
}): Promise<DemandPlanInlineV41Result> {
  const windowEndKey = input.windowEnd.toISOString().slice(0, 10);
  const lookbackDays = DEFAULT_SALES_HISTORY_LOOKBACK_DAYS + 35;
  const fromDate = new Date(input.windowEnd.getTime());
  fromDate.setUTCDate(fromDate.getUTCDate() - (lookbackDays - 1));
  const fromKey = fromDate.toISOString().slice(0, 10);
  const monthlyFrom = new Date(
    Date.UTC(input.windowEnd.getUTCFullYear(), input.windowEnd.getUTCMonth() - 17, 1),
  );

  const { loadDailySalesBySkuIdsInRange, loadMonthlySalesBySkuIds, loadFirstSaleDateBySkuIds } =
    await import('./sales-history-query.js');

  const [dailyAllBySku, firstSaleBySku, dailySets, monthlySets] = await Promise.all([
    loadDailySalesBySkuIdsInRange({
      skuIds: [input.skuId],
      fromDate: fromKey,
      toDate: windowEndKey,
      platform: 'ALL',
    }),
    loadFirstSaleDateBySkuIds({ skuIds: [input.skuId], platform: 'ALL' }),
    Promise.all(
      FORECAST_V41_PLATFORM_CODES.map((platform) =>
        loadDailySalesBySkuIdsInRange({
          skuIds: [input.skuId],
          fromDate: fromKey,
          toDate: windowEndKey,
          platform,
        }),
      ),
    ),
    Promise.all(
      FORECAST_V41_PLATFORM_CODES.map((platform) =>
        loadMonthlySalesBySkuIds({
          skuIds: [input.skuId],
          platform,
          minYear: monthlyFrom.getUTCFullYear(),
          minMonth: monthlyFrom.getUTCMonth() + 1,
          maxYear: input.windowEnd.getUTCFullYear(),
          maxMonth: input.windowEnd.getUTCMonth() + 1,
        }),
      ),
    ),
  ]);

  const dailyByPlatform = new Map<string, DailySalesPoint[]>();
  const monthlyByPlatform = new Map<string, MonthlySalesRow[]>();
  FORECAST_V41_PLATFORM_CODES.forEach((platform, index) => {
    dailyByPlatform.set(platform, dailySets[index]!.get(input.skuId) ?? []);
    monthlyByPlatform.set(platform, monthlySets[index]!.get(input.skuId) ?? []);
  });

  return computeDemandPlanInlineV41ForSku({
    sku: input.sku,
    windowEnd: input.windowEnd,
    horizonMonthKeys: input.horizonMonthKeys,
    dailyAllRows: dailyAllBySku.get(input.skuId) ?? [],
    dailyByPlatform,
    monthlyByPlatform,
    flexBiasShadow: input.flexBiasShadow,
    firstSaleDate: input.firstSaleDate ?? firstSaleBySku.get(input.skuId) ?? null,
  });
}
