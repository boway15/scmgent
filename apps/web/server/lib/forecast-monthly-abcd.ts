/**
 * 月级 ABCD 分模型（增强版，对齐 legacy near_anchor / floor / 品类池）。
 * A: near_anchor · B: damped_trend / b_promo · C: aggregate_decompose · D: floor_only
 */
import {
  applyACoreUpperBound,
  applyHorizonBiasBudgetCap,
  applySymmetricBiasBudgetCap,
  computeAClassForecast,
  computeBClassPointForecast,
  computeFloorForecast,
  computeHorizonBlendWeights,
  computeDeclinePrecisionBlendWeights,
  computeNearTermLevel,
  computeResidualInterval,
  computeYoYGrowthFactor,
  daysInCalendarMonth,
  isDecliningSalesSignal,
  roundDaily,
  type ACoreAlgoConfig,
  type SalesLifecycle,
} from './forecast-baseline.js';
import type { VolumeTier } from './forecast-eligibility.js';
import {
  buildCategoryPoolKey,
  computeSkuShare6m,
  type PoolKey,
  type SkuPoolInput,
} from './forecast-aggregate-pool.js';
import { forecastT1AnchorDaily } from './forecast-t1-anchor.js';
import { forecastT2StableDaily } from './forecast-t2-stable.js';
import { forecastT3SeasonalDaily } from './forecast-t3-seasonal.js';
import { evaluateAClassDemandRisk } from './forecast-a-risk.js';
import type { SalesTier, T1SubSegment } from './forecast-sales-tier.js';
import type { ProfileClass, ProfileSegment } from './forecast-profile-class.js';

export type MonthlyAbcdModel =
  | 'near_anchor'
  | 'seasonal_naive'
  | 'damped_trend'
  | 'b_promo'
  | 'aggregate_decompose'
  | 'median_6m'
  | 'floor_only'
  | 'zero_sales'
  | 'a_risk_zero'
  | 't1_anchor'
  | 't2_stable'
  | 't3_seasonal'
  | 'strategic_interval';

export function monthlyQtyToDailyAvg(qty: number, year: number, month: number): number {
  const days = daysInCalendarMonth(year, month);
  return roundDaily(Math.max(0, qty) / days);
}

export function computeSkuShare3m(monthlyQty: number[]): number {
  const recent = monthlyQty.slice(-3);
  return recent.reduce((s, q) => s + Math.max(0, q), 0);
}

export function computeDynamicSkuShare(monthlyQty: number[]): number {
  const s3 = computeSkuShare3m(monthlyQty);
  const s6 = computeSkuShare6m(monthlyQty);
  return s3 * 0.6 + s6 * 0.4;
}

/** 品类池近 6 月加权月均（非线性外推） */
export function poolWeightedMonthlyQty(monthlyQty: number[], horizonIndex: number): number {
  const ts = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  if (ts.length === 0) return 0;
  const recent6 = ts.slice(-6);
  if (recent6.length === 0) return 0;
  const weights = [0.1, 0.12, 0.14, 0.16, 0.2, 0.28];
  const slice = recent6.slice(-weights.length);
  const w = weights.slice(-slice.length);
  const wSum = w.reduce((a, b) => a + b, 0);
  const base = slice.reduce((s, q, i) => s + q * (w[i] ?? 0), 0) / (wSum || 1);
  if (horizonIndex <= 2) return Math.max(0, base);
  const recent3 = ts.slice(-3);
  const prior3 = ts.slice(-6, -3);
  const avg3 = recent3.length ? recent3.reduce((a, b) => a + b, 0) / recent3.length : base;
  const avgPrior =
    prior3.length ? prior3.reduce((a, b) => a + b, 0) / prior3.length : avg3;
  const growth = avgPrior > 0 ? Math.min(1.1, Math.max(0.9, avg3 / avgPrior)) : 1;
  return Math.max(0, base * growth ** horizonIndex);
}

/** 线性趋势外推第 horizonIndex 个未来月（0-based）的月销量 */
export function trendForecastMonthlyQty(monthlyQty: number[], horizonIndex: number): number {
  const ts = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  if (ts.length === 0) return 0;
  if (ts.length < 2) return ts[ts.length - 1] ?? 0;
  const n = ts.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += ts[i]!;
    sumXY += i * ts[i]!;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const projected = slope * (n + horizonIndex) + intercept;
  return Math.max(0, projected);
}

/** 季节朴素：取训练窗最后 period 个月，按位循环 */
export function seasonalNaiveMonthlyQty(
  monthlyQty: number[],
  horizonIndex: number,
  period = 12,
): number {
  const ts = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  if (ts.length === 0) return 0;
  if (ts.length < period) {
    return trendForecastMonthlyQty(ts, horizonIndex);
  }
  const base = ts.slice(-period);
  return Math.max(0, base[horizonIndex % period] ?? 0);
}

export function median6MonthlyQty(monthlyQty: number[]): number {
  const recent = monthlyQty.slice(-6).map((q) => Math.max(0, Number(q) || 0));
  if (recent.length === 0) return 0;
  const sorted = [...recent].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** 由月序列推断生命周期（回测/缺日级数据时用）；训练末 3 月环比下滑 → decline */
export function inferLifecycleFromMonthly(
  monthlyQty: number[],
  recent30DailyAvg?: number,
  recent90DailyAvg?: number,
): SalesLifecycle {
  const ts = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  const last3 = ts.slice(-3).reduce((a, b) => a + b, 0);
  const prior3 = ts.slice(-6, -3).reduce((a, b) => a + b, 0);
  if (prior3 > 0 && last3 < prior3 * 0.85) {
    return 'decline';
  }
  const r30 = recent30DailyAvg ?? 0;
  const r90 = recent90DailyAvg ?? 0;
  if (isDecliningSalesSignal('mature', r30, r90)) {
    return 'decline';
  }
  if (r90 > 0 && r30 >= r90 * 1.3) {
    return 'growth';
  }
  return 'mature';
}

/** 训练末月异常塌陷（缺货/断货），不宜作为 recent30 锚点 */
export function isLastMonthCollapsed(monthlyQty: number[]): boolean {
  const ts = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  if (ts.length < 2) return false;
  const last = ts[ts.length - 1] ?? 0;
  const prev = ts[ts.length - 2] ?? 0;
  const last3 = ts.slice(-3);
  const last6 = ts.slice(-6);
  const sorted3 = [...last3].sort((a, b) => a - b);
  const med3 = sorted3[Math.floor(sorted3.length / 2)] ?? 0;
  const sorted6 = [...last6].sort((a, b) => a - b);
  const med6 =
    sorted6.length % 2 === 1
      ? sorted6[Math.floor(sorted6.length / 2)] ?? 0
      : ((sorted6[sorted6.length / 2 - 1] ?? 0) + (sorted6[sorted6.length / 2] ?? 0)) / 2;
  if (last === 0 && prev > 0) return true;
  if (med6 > 0 && last < med6 * 0.35) return true;
  if (med3 > 0 && last < med3 * 0.45) return true;
  if (prev > 0 && last < prev * 0.45) return true;
  return false;
}

/** 训练末月断崖式下滑（非零但环比大跌 + 近季走弱），归入 T1.5 ghost 防控 */
export function isTrainEndFading(monthlyQty: number[]): boolean {
  if (isLastMonthCollapsed(monthlyQty)) return true;
  const ts = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  if (ts.length < 4) return false;
  const last = ts[ts.length - 1] ?? 0;
  const prev = ts[ts.length - 2] ?? 0;
  if (last <= 0 || prev <= 0) return false;
  const last3 = ts.slice(-3);
  const prior9 = ts.slice(-12, -3);
  const last3Avg = last3.reduce((a, b) => a + b, 0) / last3.length;
  const prior9Avg = prior9.length ? prior9.reduce((a, b) => a + b, 0) / prior9.length : 0;
  const q4Boost = prior9Avg > 0 ? last3Avg / prior9Avg : 1;
  if (last < prev * 0.55) return true;
  if (q4Boost < 0.88 && last < prev * 0.65) return true;
  return false;
}

/** Q4 训练高峰后预测 Q1 时，对季节性退潮 SKU 施加 fade */
export function computePostHolidayFadeFactor(
  monthlyQty: number[],
  forecastMonth: number,
): number {
  if (forecastMonth > 3) return 1;
  const ts = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  if (ts.length < 12) return 1;
  const last3 = ts.slice(-3);
  const prior9 = ts.slice(-12, -3);
  const q4Avg = last3.reduce((a, b) => a + b, 0) / last3.length;
  const priorAvg = prior9.reduce((a, b) => a + b, 0) / prior9.length;
  if (priorAvg <= 0 || q4Avg <= priorAvg * 1.15) return 1;
  const ratio = q4Avg / priorAvg;
  if (ratio >= 1.5) return 0.82;
  if (ratio >= 1.3) return 0.88;
  return 0.93;
}

export function deriveRecentDailyFromMonthly(
  monthlyQty: number[],
  forecastYear: number,
  forecastMonth: number,
): { recent30DailyAvg: number; recent90DailyAvg: number } {
  const ts = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  if (ts.length === 0) return { recent30DailyAvg: 0, recent90DailyAvg: 0 };
  const last = ts[ts.length - 1] ?? 0;
  const last3 = ts.slice(-3);
  const avg3 = last3.reduce((a, b) => a + b, 0) / last3.length;
  const med3 = [...last3].sort((a, b) => a - b)[Math.floor(last3.length / 2)] ?? avg3;
  const lastMonth = ((forecastMonth - 2 + 12) % 12) + 1;
  const lastYear = forecastMonth === 1 ? forecastYear - 1 : forecastYear;
  const daysLast = daysInCalendarMonth(lastYear, lastMonth);
  const recent30FromLast = last > 0 ? last / daysLast : 0;
  const recent30FromAvg3 = avg3 > 0 ? avg3 / daysLast : 0;
  const recent30FromMed3 = med3 > 0 ? med3 / daysLast : 0;
  const collapsed = isLastMonthCollapsed(ts);
  const spikeTail = !collapsed && med3 > 0 && last > med3 * 1.25;
  let recent30DailyAvg: number;
  if (collapsed) {
    recent30DailyAvg = roundDaily(Math.max(recent30FromAvg3, recent30FromMed3));
  } else if (spikeTail) {
    const prior2 = ts.slice(-3, -1);
    const avgPrior2 =
      prior2.length > 0 ? prior2.reduce((a, b) => a + b, 0) / prior2.length : avg3;
    recent30DailyAvg = roundDaily(
      Math.min(recent30FromLast, Math.max(recent30FromMed3, avgPrior2 / daysLast)),
    );
  } else {
    recent30DailyAvg = roundDaily(recent30FromLast || recent30FromAvg3);
  }
  return {
    recent30DailyAvg,
    recent90DailyAvg: roundDaily(avg3 / 30),
  };
}

export function resolveMonthlyAbcdModel(profileClass: ProfileClass): MonthlyAbcdModel {
  switch (profileClass) {
    case 'A':
      return 'near_anchor';
    case 'B':
      return 'damped_trend';
    case 'C':
      return 'aggregate_decompose';
    case 'D':
      return 'floor_only';
    default:
      return 'floor_only';
  }
}

export type MonthlyAbcdForecastResult = {
  forecastDailyAvg: number;
  model: MonthlyAbcdModel;
  baselineDailyAvg: number;
  forecastDailyP10?: number;
  forecastDailyP90?: number;
  strategicOnly?: boolean;
};

function forecastAClassDaily(input: {
  monthlyQty: number[];
  rawMonthlyQty?: number[];
  horizonIndex: number;
  forecastYear: number;
  forecastMonth: number;
  recent30DailyAvg?: number;
  recent90DailyAvg?: number;
  lastYearSameMonthDailyAvg?: number;
  yoyAnchorDailyAvg?: number;
  lifecycle?: SalesLifecycle;
  profileSegment?: ProfileSegment;
  volumeTier?: VolumeTier;
  aCoreConfig?: ACoreAlgoConfig;
  cv12m?: number;
}): MonthlyAbcdForecastResult {
  const derived = deriveRecentDailyFromMonthly(
    input.rawMonthlyQty ?? input.monthlyQty,
    input.forecastYear,
    input.forecastMonth,
  );
  const recent30 = input.recent30DailyAvg ?? derived.recent30DailyAvg;
  const recent90 = input.recent90DailyAvg ?? derived.recent90DailyAvg;
  const lifecycle = input.lifecycle ?? 'mature';
  const k = input.horizonIndex;
  const riskSeries = input.rawMonthlyQty ?? input.monthlyQty;
  const demandRisk = evaluateAClassDemandRisk(riskSeries);

  if (demandRisk.forceZero || (recent90 <= 0 && recent30 <= 0)) {
    return {
      forecastDailyAvg: 0,
      baselineDailyAvg: 0,
      model: 'a_risk_zero',
    };
  }

  if (k >= 6) {
    const anchor = computeNearTermLevel({
      recent30DailyAvg: recent30,
      recent90DailyAvg: recent90,
      lifecycle,
    });
    const band = computeResidualInterval({
      forecastDailyAvg: anchor,
      cv12m: input.cv12m ?? 0.5,
      profileSegment: input.profileSegment,
      calendarMonth: input.forecastMonth,
    });
    return {
      forecastDailyAvg: anchor,
      baselineDailyAvg: anchor,
      model: 'strategic_interval',
      forecastDailyP10: band.p10,
      forecastDailyP90: band.p90,
      strategicOnly: true,
    };
  }

  const lyQty =
    input.monthlyQty.length >= 12
      ? seasonalNaiveMonthlyQty(input.monthlyQty, k)
      : 0;
  const lyDaily =
    input.lastYearSameMonthDailyAvg ??
    (lyQty > 0 ? monthlyQtyToDailyAvg(lyQty, input.forecastYear - 1, input.forecastMonth) : 0);
  const yoyAnchor = input.yoyAnchorDailyAvg ?? recent90;
  const declining = isDecliningSalesSignal(lifecycle, recent30, recent90);
  const { wNear, wYoy } = computeHorizonBlendWeights(k, { decliningNearBias: declining });
  const nearLevel = computeNearTermLevel({
    recent30DailyAvg: recent30,
    recent90DailyAvg: recent90,
    lifecycle,
  });
  const structuralLevel =
    lyDaily > 0
      ? roundDaily(
          lyDaily *
            computeYoYGrowthFactor(nearLevel, yoyAnchor, {
              maxFactor: declining && k <= 2 ? 1.15 : 1.1,
            }),
        )
      : nearLevel;

  let forecastDailyAvg: number;
  const aForecast = computeAClassForecast({
    recent30DailyAvg: recent30,
    recent90DailyAvg: recent90,
    lastYearSameMonthDailyAvg: lyDaily,
    yoyAnchorDailyAvg: yoyAnchor,
    horizonMonthIndex: k,
    seasonalityFactor: 1,
    trendFactor: 1,
    structuralLevel,
    wNear,
    wYoy,
    aCoreConfig: input.aCoreConfig,
  });

  if (declining && k <= 2) {
    const { wNear: wNearDecline, wYoy: wYoyDecline } = computeDeclinePrecisionBlendWeights(k);
    const yoyLevel = structuralLevel > 0 ? structuralLevel : nearLevel;
    const declineBlend = roundDaily(wNearDecline * nearLevel + wYoyDecline * yoyLevel);
    forecastDailyAvg =
      aForecast != null
        ? roundDaily(0.5 * aForecast + 0.5 * declineBlend)
        : declineBlend;
  } else if (aForecast != null && (lifecycle === 'mature' || lifecycle === 'decline' || lifecycle === 'growth')) {
    forecastDailyAvg = aForecast;
  } else if (k <= 2) {
    forecastDailyAvg = roundDaily(0.7 * recent30 + 0.3 * recent90);
  } else {
    forecastDailyAvg = roundDaily(wNear * nearLevel + wYoy * structuralLevel);
  }

  if (demandRisk.demandDiscount < 1) {
    forecastDailyAvg = roundDaily(forecastDailyAvg * demandRisk.demandDiscount);
  }

  const med6Monthly = median6MonthlyQty(riskSeries);

  if (
    (input.profileSegment === 'A:core' || input.volumeTier === 'core') &&
    k <= 2 &&
    demandRisk.tier === 'stable' &&
    med6Monthly >= 150
  ) {
    const floorDaily = roundDaily(Math.min(recent30, recent90) * 0.93);
    if (floorDaily > 0) {
      forecastDailyAvg = roundDaily(Math.max(forecastDailyAvg, floorDaily));
    }
  }
  if (
    (input.profileSegment === 'A:core' || input.volumeTier === 'core') &&
    k <= 2 &&
    demandRisk.tier === 'spike'
  ) {
    const spikeCap = roundDaily(nearLevel * 1.06);
    if (spikeCap > 0) {
      forecastDailyAvg = roundDaily(Math.min(forecastDailyAvg, spikeCap));
    }
  }

  const med6Daily = monthlyQtyToDailyAvg(med6Monthly, input.forecastYear, input.forecastMonth);
  const last3 = riskSeries.slice(-3);
  const med3Monthly =
    last3.length > 0 ? last3.reduce((a, b) => a + Math.max(0, b), 0) / last3.length : med6Monthly;
  const med3Daily = monthlyQtyToDailyAvg(med3Monthly, input.forecastYear, input.forecastMonth);
  const robustAnchor = roundDaily(
    Math.min(
      recent30 > 0 ? recent30 : Number.POSITIVE_INFINITY,
      recent90 > 0 ? recent90 : Number.POSITIVE_INFINITY,
      med3Daily > 0 ? med3Daily : Number.POSITIVE_INFINITY,
      med6Daily > 0 ? med6Daily : Number.POSITIVE_INFINITY,
    ),
  );
  if (robustAnchor > 0 && Number.isFinite(robustAnchor)) {
    const collapsed = isLastMonthCollapsed(riskSeries);
    const robustHeadroom =
      demandRisk.tier === 'decline' || demandRisk.tier === 'spike'
        ? [1.02, 1.03, 1.04, 1.05, 1.06, 1.07][k] ?? 1.07
        : collapsed
          ? [1.06, 1.07, 1.08, 1.09, 1.1, 1.12][k] ?? 1.12
          : [1.04, 1.05, 1.06, 1.07, 1.08, 1.1][k] ?? 1.1;
    forecastDailyAvg = roundDaily(Math.min(forecastDailyAvg, robustAnchor * robustHeadroom));
  }

  if (input.profileSegment === 'A:core' || input.volumeTier === 'core') {
    forecastDailyAvg = applySymmetricBiasBudgetCap({
      forecastDailyAvg,
      recent30DailyAvg: recent30,
      recent90DailyAvg: recent90,
      horizonMonthIndex: k,
      lifecycle,
      profileSegment: 'A:core',
    });
    forecastDailyAvg = applyACoreUpperBound({
      forecastDailyAvg,
      recent30DailyAvg: recent30,
      recent90DailyAvg: recent90,
      horizonMonthIndex: k,
      lifecycle,
      aCoreConfig: input.aCoreConfig,
    });
    forecastDailyAvg = applyHorizonBiasBudgetCap({
      forecastDailyAvg,
      recent30DailyAvg: recent30,
      recent90DailyAvg: recent90,
      horizonMonthIndex: k,
      lifecycle,
      profileSegment: 'A:core',
    });
  }

  return {
    forecastDailyAvg,
    baselineDailyAvg: nearLevel,
    model: 'near_anchor',
  };
}

function forecastBClassDaily(input: {
  monthlyQty: number[];
  horizonIndex: number;
  forecastYear: number;
  forecastMonth: number;
  recent90DailyAvg?: number;
  promoMonths?: boolean[];
  cv12m?: number;
  profileSegment?: ProfileSegment;
  seasonalityFactor?: number;
}): MonthlyAbcdForecastResult {
  const derived = deriveRecentDailyFromMonthly(
    input.monthlyQty,
    input.forecastYear,
    input.forecastMonth,
  );
  const recent90 = input.recent90DailyAvg ?? derived.recent90DailyAvg;
  const ts = input.monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  const monthlyRows = ts.map((qty, i) => ({
    saleYear: input.forecastYear,
    month: ((input.forecastMonth - ts.length + i - 1 + 12) % 12) + 1,
    qtySold: qty,
  }));

  const hasPromo = input.promoMonths?.some(Boolean) === true;
  let forecastDailyAvg: number;
  let model: MonthlyAbcdModel = 'damped_trend';

  if (hasPromo) {
    forecastDailyAvg = computeBClassPointForecast({
      recent90DailyAvg: recent90,
      monthlyRows,
      calendarMonth: input.forecastMonth,
      seasonalityFactor: input.seasonalityFactor ?? 1,
    });
    model = 'b_promo';
  } else {
    const monthly = trendForecastMonthlyQty(ts, input.horizonIndex);
    forecastDailyAvg = monthlyQtyToDailyAvg(monthly, input.forecastYear, input.forecastMonth);
  }

  const band = computeResidualInterval({
    forecastDailyAvg,
    cv12m: input.cv12m ?? 1,
    profileSegment: input.profileSegment,
    calendarMonth: input.forecastMonth,
    promoIntensity: hasPromo ? 1.25 : 1,
  });

  return {
    forecastDailyAvg,
    baselineDailyAvg: recent90,
    model,
    forecastDailyP10: band.p10,
    forecastDailyP90: band.p90,
  };
}

function forecastDClassDaily(input: {
  monthlyQty: number[];
  forecastYear: number;
  forecastMonth: number;
  recent30DailyAvg?: number;
  recent90DailyAvg?: number;
  categoryP25DailyAvg?: number;
  forceForecast?: boolean;
}): MonthlyAbcdForecastResult {
  const derived = deriveRecentDailyFromMonthly(
    input.monthlyQty,
    input.forecastYear,
    input.forecastMonth,
  );
  const recent30 = input.recent30DailyAvg ?? derived.recent30DailyAvg;
  const recent90 = input.recent90DailyAvg ?? derived.recent90DailyAvg;
  const ts = input.monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  const recent6Sum = ts.slice(-6).reduce((a, b) => a + b, 0);
  const recent3Sum = ts.slice(-3).reduce((a, b) => a + b, 0);

  if (!input.forceForecast) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'zero_sales' };
  }

  if (
    (recent90 <= 0 && recent30 <= 0) ||
    recent6Sum === 0 ||
    recent3Sum === 0
  ) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'zero_sales' };
  }

  const floorDaily = computeFloorForecast({
    recent90DailyAvg: recent90,
    categoryP25: input.categoryP25DailyAvg,
  });
  const medMonthly = median6MonthlyQty(input.monthlyQty);
  const medDaily = monthlyQtyToDailyAvg(medMonthly, input.forecastYear, input.forecastMonth);
  const forecastDailyAvg = roundDaily(Math.min(floorDaily, medDaily > 0 ? medDaily : floorDaily));

  return {
    forecastDailyAvg,
    baselineDailyAvg: floorDaily,
    model: 'floor_only',
  };
}

export function forecastMonthlyQtyForProfile(input: {
  profileClass: ProfileClass;
  monthlyQty: number[];
  horizonIndex: number;
  poolMonthlyQty?: number[];
  usePoolWeighted?: boolean;
}): { monthlyQty: number; model: MonthlyAbcdModel } {
  const ts = input.monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  if (ts.reduce((s, q) => s + q, 0) === 0) {
    return { monthlyQty: 0, model: 'zero_sales' };
  }

  switch (input.profileClass) {
    case 'A':
      return {
        monthlyQty: seasonalNaiveMonthlyQty(ts, input.horizonIndex),
        model: 'near_anchor',
      };
    case 'B':
      return {
        monthlyQty: trendForecastMonthlyQty(ts, input.horizonIndex),
        model: 'damped_trend',
      };
    case 'C': {
      const poolTs = input.poolMonthlyQty ?? ts;
      const monthlyQty = input.usePoolWeighted
        ? poolWeightedMonthlyQty(poolTs, input.horizonIndex)
        : trendForecastMonthlyQty(poolTs, input.horizonIndex);
      return { monthlyQty, model: 'aggregate_decompose' };
    }
    case 'D':
      return { monthlyQty: median6MonthlyQty(ts), model: 'floor_only' };
    default:
      return { monthlyQty: median6MonthlyQty(ts), model: 'floor_only' };
  }
}

export function computeMonthlyAbcdForecastDailyAvg(input: {
  profileClass: ProfileClass;
  monthlyQty: number[];
  /** 原始月序列，用于 A 类风险识别（缺省同 monthlyQty） */
  rawMonthlyQty?: number[];
  horizonIndex: number;
  forecastYear: number;
  forecastMonth: number;
  poolMonthlyQty?: number[];
  poolShare?: number;
  recent30DailyAvg?: number;
  recent90DailyAvg?: number;
  lastYearSameMonthDailyAvg?: number;
  yoyAnchorDailyAvg?: number;
  lifecycle?: SalesLifecycle;
  profileSegment?: ProfileSegment;
  volumeTier?: VolumeTier;
  aCoreConfig?: ACoreAlgoConfig;
  categoryP25DailyAvg?: number;
  promoMonths?: boolean[];
  cv12m?: number;
  seasonalityFactor?: number;
  forceForecast?: boolean;
  /** T1 主攻层：走专用锚定预测 */
  salesTier?: SalesTier;
  t1SubSegment?: T1SubSegment;
}): MonthlyAbcdForecastResult {
  const ts = input.monthlyQty.map((q) => Math.max(0, Number(q) || 0));

  if (input.salesTier === 'T1_anchor') {
    return forecastT1AnchorDaily({
      monthlyQty: input.monthlyQty,
      rawMonthlyQty: input.rawMonthlyQty,
      horizonIndex: input.horizonIndex,
      forecastYear: input.forecastYear,
      forecastMonth: input.forecastMonth,
      recent30DailyAvg: input.recent30DailyAvg,
      recent90DailyAvg: input.recent90DailyAvg,
      lastYearSameMonthDailyAvg: input.lastYearSameMonthDailyAvg,
      yoyAnchorDailyAvg: input.yoyAnchorDailyAvg,
      lifecycle: input.lifecycle,
      aCoreConfig: input.aCoreConfig,
      cv12m: input.cv12m,
      t1SubSegment: input.t1SubSegment,
    });
  }

  if (input.salesTier === 'T2_stable') {
    return forecastT2StableDaily({
      monthlyQty: input.monthlyQty,
      rawMonthlyQty: input.rawMonthlyQty,
      horizonIndex: input.horizonIndex,
      forecastYear: input.forecastYear,
      forecastMonth: input.forecastMonth,
      recent30DailyAvg: input.recent30DailyAvg,
      recent90DailyAvg: input.recent90DailyAvg,
      lastYearSameMonthDailyAvg: input.lastYearSameMonthDailyAvg,
      yoyAnchorDailyAvg: input.yoyAnchorDailyAvg,
      lifecycle: input.lifecycle,
      aCoreConfig: input.aCoreConfig,
      cv12m: input.cv12m,
    });
  }

  if (input.salesTier === 'T3_seasonal') {
    return forecastT3SeasonalDaily({
      monthlyQty: input.monthlyQty,
      horizonIndex: input.horizonIndex,
      forecastYear: input.forecastYear,
      forecastMonth: input.forecastMonth,
      recent90DailyAvg: input.recent90DailyAvg,
      seasonalityFactor: input.seasonalityFactor,
      cv12m: input.cv12m,
    });
  }

  if (input.profileClass === 'A') {
    return forecastAClassDaily(input);
  }
  if (input.profileClass === 'B') {
    return forecastBClassDaily(input);
  }
  if (input.profileClass === 'D') {
    return forecastDClassDaily({ ...input, forceForecast: input.forceForecast });
  }

  if (input.profileClass === 'C') {
    const derived = deriveRecentDailyFromMonthly(
      input.monthlyQty,
      input.forecastYear,
      input.forecastMonth,
    );
    const recent30 = input.recent30DailyAvg ?? derived.recent30DailyAvg;
    const recent90 = input.recent90DailyAvg ?? derived.recent90DailyAvg;
    if (recent90 <= 0 && recent30 <= 0) {
      return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'zero_sales' };
    }
    if (input.poolShare == null) {
      return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'zero_sales' };
    }
  }

  const { monthlyQty: forecastMonthQty, model } = forecastMonthlyQtyForProfile({
    profileClass: input.profileClass,
    monthlyQty: ts,
    horizonIndex: input.horizonIndex,
    poolMonthlyQty: input.poolMonthlyQty,
    usePoolWeighted: true,
  });

  let effectiveMonthly = forecastMonthQty;
  if (input.profileClass === 'C' && input.poolShare != null) {
    effectiveMonthly = forecastMonthQty * Math.max(0, input.poolShare);
  }

  const forecastDailyAvg = monthlyQtyToDailyAvg(
    effectiveMonthly,
    input.forecastYear,
    input.forecastMonth,
  );

  const recent = ts.slice(-3);
  const baselineMonthly =
    recent.length > 0 ? recent.reduce((s, q) => s + q, 0) / recent.length : effectiveMonthly;
  const baselineDailyAvg = monthlyQtyToDailyAvg(
    baselineMonthly,
    input.forecastYear,
    input.forecastMonth,
  );

  return { forecastDailyAvg, model, baselineDailyAvg };
}

export function sumPoolMonthlyQty(poolSkus: SkuPoolInput[]): number[] {
  const len = Math.max(12, ...poolSkus.map((s) => s.monthlyQty.length));
  const totals = new Array(len).fill(0);
  for (const sku of poolSkus) {
    const offset = len - sku.monthlyQty.length;
    sku.monthlyQty.forEach((q, i) => {
      totals[offset + i] = (totals[offset + i] ?? 0) + Math.max(0, q);
    });
  }
  return totals.slice(-12);
}

export type MonthlyAbcdCPoolContext = {
  poolMonthlyQtyByKey: Map<PoolKey, number[]>;
  poolShareBySkuId: Map<string, number>;
};

export function buildMonthlyAbcdCPoolContext(cPoolInputs: SkuPoolInput[]): MonthlyAbcdCPoolContext {
  const poolMonthlyQtyByKey = new Map<PoolKey, number[]>();
  const poolShareBySkuId = new Map<string, number>();

  const byPool = new Map<PoolKey, SkuPoolInput[]>();
  for (const row of cPoolInputs) {
    const poolKey = buildCategoryPoolKey(row.category, row.station, row.platform);
    const list = byPool.get(poolKey) ?? [];
    list.push(row);
    byPool.set(poolKey, list);
  }

  for (const [poolKey, poolSkus] of byPool) {
    const totals = sumPoolMonthlyQty(poolSkus);
    poolMonthlyQtyByKey.set(poolKey, totals);
    const shareSum = poolSkus.reduce((s, row) => s + computeDynamicSkuShare(row.monthlyQty), 0);
    for (const row of poolSkus) {
      const share =
        shareSum > 0
          ? computeDynamicSkuShare(row.monthlyQty) / shareSum
          : 1 / poolSkus.length;
      poolShareBySkuId.set(row.skuId, share);
    }
  }

  return { poolMonthlyQtyByKey, poolShareBySkuId };
}

export function resolvePoolKeyForSku(
  category: string | null | undefined,
  station: string,
  platform: string,
): PoolKey {
  return buildCategoryPoolKey(category, station, platform);
}
