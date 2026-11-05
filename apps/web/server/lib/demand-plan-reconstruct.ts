import {
  classifySalesLifecycle,
  computeForecastDailyAvgForMonth,
  computeHorizonBlendWeights,
  resolveEffectiveLastYearDailyAvg,
  type SalesLifecycle,
} from './forecast-baseline.js';
import { computeAgeDaysFromFirstSale } from './forecast-collaboration.js';
import type { ProfileClass } from './forecast-profile-class.js';
import {
  isoWeekKeyFromUtcDate,
  isoWeekMondayUtc,
  monthKeyFromUtcDate,
} from './planning-calendar.js';

export const DEMAND_SHAPE_CLIP_MIN = 0.5;
export const DEMAND_SHAPE_CLIP_MAX = 2.0;

/** 约 4 个 ISO 周对齐 1 个自然月地平线序号 k */
export function weekIndexToHorizonMonthIndex(weekIndex: number): number {
  return Math.max(0, Math.floor(weekIndex / 4));
}

export type DemandMonthSource = 'reconstructed_shape' | 'fallback_forecast';

function roundTo4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function clipDemandShape(shape: number): number {
  return Math.min(DEMAND_SHAPE_CLIP_MAX, Math.max(DEMAND_SHAPE_CLIP_MIN, shape));
}

export function warehouseShareWeight(
  warehouseCode: string,
  weights: Array<{ warehouse: string; weight: number }>,
): number | null {
  const match = weights.find((row) => row.warehouse === warehouseCode);
  return match ? match.weight : null;
}

export function championRefLevel(monthlyDaily: number[]): number {
  const positive = monthlyDaily.filter((value) => value > 0);
  if (positive.length === 0) {
    return 0;
  }
  const refMonths = positive.slice(0, 3);
  return refMonths.reduce((sum, value) => sum + value, 0) / refMonths.length;
}

export function systemDailyAvgForMonth(input: {
  unconstrainedRecentDaily: number;
  share: number;
  monthForecastDaily: number;
  championRefDaily: number;
}): number {
  if (input.unconstrainedRecentDaily <= 0) {
    return 0;
  }

  const shape =
    input.championRefDaily <= 0
      ? 1
      : clipDemandShape(input.monthForecastDaily / input.championRefDaily);

  return roundTo4(input.unconstrainedRecentDaily * input.share * shape);
}

export function classifyReconstructSource(input: {
  hasAvailabilitySeries: boolean;
  inStockDays: number;
}): DemandMonthSource {
  if (input.hasAvailabilitySeries && input.inStockDays > 0) {
    return 'reconstructed_shape';
  }
  return 'fallback_forecast';
}

export function weekWeightedForecastDaily(
  weekKey: string,
  monthlyDaily: Map<string, number>,
): number {
  const monday = isoWeekMondayUtc(weekKey);
  let acc = 0;
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(monday.getTime() + i * 86400000);
    const monthKey = monthKeyFromUtcDate(day);
    acc += monthlyDaily.get(monthKey) ?? 0;
  }
  return Math.round((acc / 7) * 10000) / 10000;
}

export type WeekSystemDailyBlend = {
  systemDailyAvg: number;
  wNear: number;
  wYoy: number;
};

/**
 * 近端：U × share × shape；远端：F_w × share。
 * 权重复用月侧 computeHorizonBlendWeights(k)，k = ⌊weekIndex/4⌋。
 */
export function systemDailyAvgForWeekWithBlend(input: {
  unconstrainedRecentDaily: number;
  share: number;
  weekForecastDaily: number;
  championRefDaily: number;
  weekIndex: number;
}): WeekSystemDailyBlend {
  const { wNear, wYoy } = computeHorizonBlendWeights(
    weekIndexToHorizonMonthIndex(input.weekIndex),
  );
  const near = systemDailyAvgForMonth({
    unconstrainedRecentDaily: input.unconstrainedRecentDaily,
    share: input.share,
    monthForecastDaily: input.weekForecastDaily,
    championRefDaily: input.championRefDaily,
  });
  if (near <= 0) return { systemDailyAvg: 0, wNear, wYoy };

  const share = Number.isFinite(input.share) ? Math.max(0, input.share) : 0;
  const farRaw =
    input.weekForecastDaily > 0 && Number.isFinite(input.weekForecastDaily)
      ? roundTo4(input.weekForecastDaily * share)
      : 0;
  const far = farRaw > 0 ? farRaw : near;
  return {
    systemDailyAvg: roundTo4(near * wNear + far * wYoy),
    wNear,
    wYoy,
  };
}

export function systemDailyAvgForWeek(input: {
  unconstrainedRecentDaily: number;
  share: number;
  weekForecastDaily: number;
  championRefDaily: number;
  weekIndex: number;
}): number {
  return systemDailyAvgForWeekWithBlend(input).systemDailyAvg;
}

/** 任一 horizon 月有预测日均即视为可用季节形状；不强制 6 个月全覆盖。 */
export function hasForecastShape(monthlyDaily: Map<string, number>, periods: string[]): boolean {
  return periods.some((period) => (monthlyDaily.get(period) ?? 0) > 0);
}

/** 无月预测时周需求拉平为近窗反推日均；有预测时仅作季节形状（月权重低）。 */
export function weekForecastDailyForPlan(input: {
  weekKey: string;
  monthlyDaily: Map<string, number>;
  flatDaily: number;
  useForecastShape: boolean;
}): number {
  if (!input.useForecastShape) {
    return input.flatDaily;
  }
  return weekWeightedForecastDaily(input.weekKey, input.monthlyDaily);
}

export function lastYearIsoWeekKey(weekKey: string): string | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) return null;
  return `${Number(match[1]) - 1}-W${match[2]}`;
}

/** 去年同一 ISO 周日均，周预测频率下的同比结构。 */
export function lastYearSameWeekDailyAvg(
  dailyRows: Array<{ saleDate: string; qtySold: number }>,
  weekKey: string,
): number {
  const lyWeek = lastYearIsoWeekKey(weekKey);
  if (!lyWeek) return 0;
  let qty = 0;
  for (const row of dailyRows) {
    const dateKey = String(row.saleDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    if (isoWeekKeyFromUtcDate(new Date(`${dateKey}T00:00:00.000Z`)) === lyWeek) {
      qty += Number(row.qtySold) || 0;
    }
  }
  return roundTo4(qty / 7);
}

function dateOnlyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function calendarDailyInRange(
  rows: Array<{ saleDate: string; qtySold: number }>,
  start: Date,
  end: Date,
  days: number,
): number {
  const startKey = dateOnlyUtc(start);
  const endKey = dateOnlyUtc(end);
  let qty = 0;
  for (const row of rows) {
    const dateKey = String(row.saleDate).slice(0, 10);
    if (dateKey >= startKey && dateKey <= endKey) qty += Number(row.qtySold) || 0;
  }
  return days > 0 ? qty / days : 0;
}

function salesDaysSince(rows: Array<{ saleDate: string; qtySold: number }>, since: Date): number {
  const sinceKey = dateOnlyUtc(since);
  const days = new Set<string>();
  for (const row of rows) {
    const dateKey = String(row.saleDate).slice(0, 10);
    if (dateKey >= sinceKey && Number(row.qtySold) > 0) days.add(dateKey);
  }
  return days.size;
}

function maxZeroRunDays(
  rows: Array<{ saleDate: string; qtySold: number }>,
  start: Date,
  end: Date,
): number {
  const qtyByDate = new Map(rows.map((row) => [String(row.saleDate).slice(0, 10), Number(row.qtySold)]));
  let maxRun = 0;
  let current = 0;
  for (let cursor = new Date(start.getTime()); cursor <= end; cursor = addUtcDays(cursor, 1)) {
    if ((qtyByDate.get(dateOnlyUtc(cursor)) ?? 0) <= 0) {
      current += 1;
      maxRun = Math.max(maxRun, current);
    } else {
      current = 0;
    }
  }
  return maxRun;
}

/** 与月预测 classifySalesLifecycle 同口径，近窗截止为规划 windowEnd。 */
export function classifyDemandPlanLifecycle(input: {
  sales: Array<{ saleDate: string; qtySold: number }>;
  windowEnd: Date;
  firstSaleDate?: string | null;
}): SalesLifecycle {
  const recent90Since = addUtcDays(input.windowEnd, -89);
  const recent30Since = addUtcDays(input.windowEnd, -29);
  return classifySalesLifecycle({
    ageDays: computeAgeDaysFromFirstSale(input.firstSaleDate, addUtcDays(input.windowEnd, 1)),
    salesDayRatio90: salesDaysSince(input.sales, recent90Since) / 90,
    recent30DailyAvg: calendarDailyInRange(input.sales, recent30Since, input.windowEnd, 30),
    recent90DailyAvg: calendarDailyInRange(input.sales, recent90Since, input.windowEnd, 90),
    maxZeroRunDays: maxZeroRunDays(input.sales, recent90Since, input.windowEnd),
  });
}

/**
 * 周预测复用月预测公式：近窗 × 同比结构 × 季节/趋势 × 地平线混合。
 * 同比优先去年同 ISO 周，其次已发布月插值，再次去年同月。
 */
export function systemDailyAvgForWeekFromMonthlyAlgo(input: {
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  lastYearSameWeekDailyAvg: number;
  lastYearSameMonthDailyAvg?: number;
  weekForecastDaily: number;
  weekIndex: number;
  calendarMonth: number;
  seasonalityFactor?: number;
  trendFactor?: number;
  lifecycle?: SalesLifecycle;
  profileClass?: ProfileClass | null;
  monthlyRows?: Array<{ saleYear: number; month: number; qtySold: number }>;
  refYear?: number;
  refMonth?: number;
  share?: number;
}): WeekSystemDailyBlend {
  const share = Number.isFinite(input.share) ? Math.max(0, input.share ?? 1) : 1;
  const lastYear =
    input.lastYearSameWeekDailyAvg > 0
      ? input.lastYearSameWeekDailyAvg
      : input.weekForecastDaily > 0
        ? input.weekForecastDaily
        : (input.lastYearSameMonthDailyAvg ?? 0);

  const monthly = computeForecastDailyAvgForMonth({
    recent30DailyAvg: input.recent30DailyAvg,
    recent90DailyAvg: input.recent90DailyAvg,
    lastYearSameMonthDailyAvg: lastYear,
    lifecycle: input.lifecycle ?? 'mature',
    horizonMonthIndex: weekIndexToHorizonMonthIndex(input.weekIndex),
    calendarMonth: input.calendarMonth,
    monthlyRows: input.monthlyRows,
    seasonalityFactor: input.seasonalityFactor,
    trendFactor: input.trendFactor,
    profileClass: input.profileClass ?? undefined,
    refYear: input.refYear,
    refMonth: input.refMonth,
  });

  return {
    systemDailyAvg: roundTo4(monthly.forecastDailyAvg * share),
    wNear: monthly.horizonFactors.wNear,
    wYoy: monthly.horizonFactors.wYoy,
  };
}

export function resolveWeekLastYearDailyAvg(input: {
  dailyRows: Array<{ saleDate: string; qtySold: number }>;
  monthlyRows: Array<{ saleYear: number; month: number; qtySold: number }>;
  weekKey: string;
  forecastYear: number;
  month: number;
}): { lastYearSameWeekDaily: number; lastYearSameMonthDaily: number } {
  return {
    lastYearSameWeekDaily: lastYearSameWeekDailyAvg(input.dailyRows, input.weekKey),
    lastYearSameMonthDaily: resolveEffectiveLastYearDailyAvg({
      dailyRows: input.dailyRows,
      monthlyRows: input.monthlyRows,
      forecastYear: input.forecastYear,
      month: input.month,
    }),
  };
}
