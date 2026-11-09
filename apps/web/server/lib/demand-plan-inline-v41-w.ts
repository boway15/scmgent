/**
 * 周需求计划内联 V4.1-W：ISO 周 walk-forward，不依赖已发布月预测。
 */
import type { DailySalesPoint } from './sales-history-query.js';
import {
  classifySalesLifecycle,
  roundDaily,
  DEFAULT_SALES_HISTORY_LOOKBACK_DAYS,
} from './forecast-baseline.js';
import {
  aggregateDailyQtyByIsoWeek,
  computeAllCatV41WForecastForWeek,
  ALLCAT_V41_W_MODEL,
} from './forecast-allcat-v41-w.js';
import {
  isAllCatV41Forecastable,
  isAllCatV41RecentSalesAbsent,
} from './forecast-allcat-v41.js';
import { computeAgeDaysFromFirstSale } from './forecast-collaboration.js';
import { resolveRecentDemandWindows } from './forecast-demand-unconstrain.js';
import { FORECAST_V41_PLATFORM_CODES } from './forecast-platform-scope.js';
import { resolveAnchorProfileSegment } from './forecast-horizon.js';
import { isoWeekMondayUtc } from './planning-calendar.js';

type MonthlySalesRow = { saleYear: number; month: number; qtySold: number };

export type DemandPlanInlineV41WWeekCell = {
  weekKey: string;
  horizonWeekIndex: number;
  forecastDailyAvg: number;
  profileSegment: string | null;
  forecastModel: string;
  allCatV41WFactors: Record<string, unknown> | null;
};

export type DemandPlanInlineV41WSkuInput = {
  productCategory?: string | null;
  category?: string | null;
  forceForecast?: boolean | null;
};

export type DemandPlanInlineV41WResult = {
  weekMap: Map<string, number>;
  weekByPlatform: Map<string, Map<string, number>>;
  profileSegment: string | null;
  lifecycle: string | null;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  weekCells: DemandPlanInlineV41WWeekCell[];
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

export function computeDemandPlanInlineV41WForSku(input: {
  sku: DemandPlanInlineV41WSkuInput;
  windowEnd: Date;
  horizonWeekKeys: string[];
  dailyAllRows: DailySalesPoint[];
  dailyByPlatform: Map<string, DailySalesPoint[]>;
  monthlyByPlatform: Map<string, MonthlySalesRow[]>;
  flexBiasShadow?: boolean;
  firstSaleDate?: string | null;
}): DemandPlanInlineV41WResult {
  const recentWindowEnd = input.windowEnd;
  const historyCapEnd = input.windowEnd;
  const recent30Since = addDays(recentWindowEnd, -29);
  const recent90Since = addDays(recentWindowEnd, -89);
  const allChannelRows = mapDailyRows(input.dailyAllRows);
  const allRecent30DailyAvg = roundDaily(sumQtySince(allChannelRows, recent30Since) / 30);
  const allRecent90DailyAvg = roundDaily(sumQtySince(allChannelRows, recent90Since) / 90);

  const empty: DemandPlanInlineV41WResult = {
    weekMap: new Map(),
    weekByPlatform: new Map(),
    profileSegment: null,
    lifecycle: null,
    recent30DailyAvg: allRecent30DailyAvg,
    recent90DailyAvg: allRecent90DailyAvg,
    weekCells: [],
  };

  if (!input.horizonWeekKeys.length) return empty;

  const anchorWeekKey = input.horizonWeekKeys[0]!;
  const anchorMonday = isoWeekMondayUtc(anchorWeekKey);
  const anchorForecastYear = anchorMonday.getUTCFullYear();
  const anchorMonth = anchorMonday.getUTCMonth() + 1;
  const tierPickRows: Array<{
    forecastYear: number;
    month: number;
    platform: string;
    profileSegment: string | null;
  }> = [];
  const weekByPlatform = new Map<string, Map<string, number>>();
  const weekCellsByKey = new Map<string, DemandPlanInlineV41WWeekCell>();

  let anchorLifecycle: string | null = null;
  let resolvedRecent30 = allRecent30DailyAvg;
  let resolvedRecent90 = allRecent90DailyAvg;

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
    if (platform === 'AMAZON') {
      resolvedRecent30 = recent30DailyAvg;
      resolvedRecent90 = recent90DailyAvg;
    }

    const weeklyQty = aggregateDailyQtyByIsoWeek(rawSalesRows);
    const peerPlatformRecentDaily = roundDaily(Math.max(0, allRecent30DailyAvg - calendar30));

    const anchorForecast = computeAllCatV41WForecastForWeek({
      productCategory: input.sku.productCategory ?? input.sku.category,
      platform,
      targetWeekKey: anchorWeekKey,
      horizonWeekIndex: 0,
      anchorWeekKey,
      weeklyQty,
      monthlyRows: monthlySalesRows,
      recent30DailyAvg,
      recent90DailyAvg,
      peerPlatformRecentDaily,
      historyCapEnd,
      demandReconstruct: recentWindows.demandReconstruct,
      flexBiasShadow: input.flexBiasShadow,
    });
    const anchorTier = anchorForecast.tier;

    if (
      (anchorTier === 'T4A' || anchorTier === 'T4B') &&
      !(input.sku.forceForecast ?? false) &&
      isAllCatV41RecentSalesAbsent({
        recent30DailyAvg,
        recent90DailyAvg,
        metrics: {
          q1: anchorForecast.metrics.q4,
          q3: anchorForecast.metrics.q8,
          q6: anchorForecast.metrics.q8,
          q12: anchorForecast.metrics.q16,
          d2: anchorForecast.metrics.w4,
          d3: anchorForecast.metrics.w4,
          d6: anchorForecast.metrics.w8,
          d12: anchorForecast.metrics.w16,
          active2: anchorForecast.metrics.activeW4,
          active6: anchorForecast.metrics.activeW8,
          active12: anchorForecast.metrics.activeW16,
          cv6: anchorForecast.metrics.cv8,
          trendRatio: anchorForecast.metrics.trendRatioW,
        },
        tier: anchorTier === 'T4A' || anchorTier === 'T4B' ? anchorTier : undefined,
      })
    ) {
      continue;
    }

    tierPickRows.push({
      forecastYear: anchorForecastYear,
      month: anchorMonth,
      platform,
      profileSegment: anchorTier,
    });

    const platformWeekMap = new Map<string, number>();
    weekByPlatform.set(platform, platformWeekMap);

    input.horizonWeekKeys.forEach((weekKey, horizonWeekIndex) => {
      const v41w = computeAllCatV41WForecastForWeek({
        productCategory: input.sku.productCategory ?? input.sku.category,
        platform,
        targetWeekKey: weekKey,
        horizonWeekIndex,
        anchorWeekKey,
        weeklyQty,
        monthlyRows: monthlySalesRows,
        recent30DailyAvg,
        recent90DailyAvg,
        peerPlatformRecentDaily,
        historyCapEnd,
        demandReconstruct: recentWindows.demandReconstruct,
        flexBiasShadow: input.flexBiasShadow,
      });
      if (!isAllCatV41Forecastable(anchorTier) && v41w.forecastDaily <= 0) {
        return;
      }
      platformWeekMap.set(weekKey, v41w.forecastDaily);
      const existing = weekCellsByKey.get(weekKey);
      if (!existing || platform === 'AMAZON') {
        weekCellsByKey.set(weekKey, {
          weekKey,
          horizonWeekIndex,
          forecastDailyAvg: v41w.forecastDaily,
          profileSegment: anchorTier,
          forecastModel: ALLCAT_V41_W_MODEL,
          allCatV41WFactors: v41w.horizonFactors,
        });
      }
    });
  }

  if (!tierPickRows.length) return empty;

  const profileSegment = resolveAnchorProfileSegment(tierPickRows);

  const weekMap = new Map<string, number>();
  for (const weekKey of input.horizonWeekKeys) {
    let sum = 0;
    for (const platformMap of weekByPlatform.values()) {
      sum += platformMap.get(weekKey) ?? 0;
    }
    if (sum > 0) {
      weekMap.set(weekKey, roundDaily(sum));
    }
  }

  const weekCells = input.horizonWeekKeys
    .map((weekKey) => weekCellsByKey.get(weekKey))
    .filter((cell): cell is DemandPlanInlineV41WWeekCell => Boolean(cell))
    .map((cell) => ({
      ...cell,
      forecastDailyAvg: weekMap.get(cell.weekKey) ?? cell.forecastDailyAvg,
      profileSegment,
    }));

  return {
    weekMap,
    weekByPlatform,
    profileSegment,
    lifecycle: anchorLifecycle,
    recent30DailyAvg: resolvedRecent30,
    recent90DailyAvg: resolvedRecent90,
    weekCells,
  };
}

export async function loadDemandPlanSkuInlineV41WHorizon(input: {
  skuId: string;
  sku: DemandPlanInlineV41WSkuInput;
  windowEnd: Date;
  horizonWeekKeys: string[];
  firstSaleDate?: string | null;
  flexBiasShadow?: boolean;
}): Promise<DemandPlanInlineV41WResult> {
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

  return computeDemandPlanInlineV41WForSku({
    sku: input.sku,
    windowEnd: input.windowEnd,
    horizonWeekKeys: input.horizonWeekKeys,
    dailyAllRows: dailyAllBySku.get(input.skuId) ?? [],
    dailyByPlatform,
    monthlyByPlatform,
    flexBiasShadow: input.flexBiasShadow,
    firstSaleDate: input.firstSaleDate ?? firstSaleBySku.get(input.skuId) ?? null,
  });
}
