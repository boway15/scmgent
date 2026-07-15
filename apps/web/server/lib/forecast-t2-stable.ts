/**
 * T2·稳定腰部：专用预测核（均值锚定 + 需求概率缩放），不硬套 T1.3 锚定。
 */
import { evaluateAClassDemandRisk } from './forecast-a-risk.js';
import { roundDaily } from './forecast-baseline.js';
import type { T1AnchorForecastInput } from './forecast-t1-anchor.js';
import {
  deriveRecentDailyFromMonthly,
  isTrainEndFading,
  median6MonthlyQty,
  monthlyQtyToDailyAvg,
  seasonalNaiveMonthlyQty,
  type MonthlyAbcdForecastResult,
} from './forecast-monthly-abcd.js';

export type T2DemandProfile = {
  activeLast12: number;
  zeroMonthsLast12: number;
  /** 近 12 月有销月占比，用于 ghost 缩放 */
  demandRate: number;
  avg12Monthly: number;
  med6Monthly: number;
  lastMonth: number;
  last3Sum: number;
  prior3Sum: number;
};

export function assessT2DemandProfile(monthlyQty: number[]): T2DemandProfile {
  const ts = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  const last12 = ts.slice(-12);
  const activeLast12 = last12.filter((q) => q > 0).length;
  const zeroMonthsLast12 = last12.length - activeLast12;
  const avg12Monthly =
    last12.length > 0 ? last12.reduce((a, b) => a + b, 0) / last12.length : 0;
  return {
    activeLast12,
    zeroMonthsLast12,
    demandRate: last12.length > 0 ? activeLast12 / last12.length : 0,
    avg12Monthly,
    med6Monthly: median6MonthlyQty(ts),
    lastMonth: ts[ts.length - 1] ?? 0,
    last3Sum: ts.slice(-3).reduce((a, b) => a + b, 0),
    prior3Sum: ts.slice(-6, -3).reduce((a, b) => a + b, 0),
  };
}

function t2HorizonDiscount(k: number): number {
  if (k <= 0) return 1;
  if (k === 1) return 0.98;
  if (k === 2) return 0.93;
  return 0.88;
}

function t2DemandProbabilityScale(k: number, profile: T2DemandProfile): number {
  const base = profile.demandRate;
  if (profile.lastMonth > 0 && k <= 1) return Math.max(0.92, base);
  if (k <= 1) return Math.max(0.85, base);
  if (profile.zeroMonthsLast12 >= 3) return Math.max(0.58, base * 0.9);
  if (profile.zeroMonthsLast12 >= 2) return Math.max(0.68, base * 0.94);
  return Math.max(0.78, base * 0.97);
}

export function forecastT2StableDaily(
  input: Omit<T1AnchorForecastInput, 't1SubSegment'>,
): MonthlyAbcdForecastResult {
  const series = input.rawMonthlyQty ?? input.monthlyQty;
  const ts = series.map((q) => Math.max(0, Number(q) || 0));
  const k = input.horizonIndex;
  const risk = evaluateAClassDemandRisk(ts);
  const profile = assessT2DemandProfile(ts);
  const derived = deriveRecentDailyFromMonthly(ts, input.forecastYear, input.forecastMonth);
  const recent90 = input.recent90DailyAvg ?? derived.recent90DailyAvg;
  const recent30 = input.recent30DailyAvg ?? derived.recent30DailyAvg;

  const last6 = ts.slice(-6);
  const activeLast6 = last6.filter((q) => q > 0).length;
  const last2Sum = ts.slice(-2).reduce((a, b) => a + b, 0);
  const ratio =
    profile.prior3Sum > 0 ? profile.last3Sum / profile.prior3Sum : null;

  if (risk.forceZero || last2Sum === 0 || activeLast6 <= 1) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'a_risk_zero' };
  }
  if (profile.last3Sum === 0 && k <= 2) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'a_risk_zero' };
  }
  if (isTrainEndFading(ts) && k <= 1 && profile.lastMonth === 0) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'a_risk_zero' };
  }

  const avg12Daily = monthlyQtyToDailyAvg(
    profile.avg12Monthly,
    input.forecastYear,
    input.forecastMonth,
  );
  const med6Daily =
    profile.med6Monthly > 0
      ? monthlyQtyToDailyAvg(profile.med6Monthly, input.forecastYear, input.forecastMonth)
      : 0;
  const anchorDaily = roundDaily(
    recent90 > 0 ? Math.min(recent30 > 0 ? recent30 : recent90, recent90) : med6Daily,
  );
  const anchorBoosted =
    profile.lastMonth > 0 && recent30 > anchorDaily
      ? roundDaily(anchorDaily * 0.82 + recent30 * 0.18)
      : anchorDaily;

  const intermittentWithinT2 =
    profile.zeroMonthsLast12 >= 2 || profile.demandRate < 0.75 || risk.tier === 'intermittent';

  let levelDaily: number;
  if (profile.lastMonth > 0) {
    levelDaily = roundDaily(0.6 * anchorBoosted + 0.26 * med6Daily + 0.14 * avg12Daily);
  } else if (intermittentWithinT2) {
    levelDaily = roundDaily(0.38 * avg12Daily + 0.34 * med6Daily + 0.28 * anchorBoosted);
  } else {
    const lyQty = ts.length >= 12 ? seasonalNaiveMonthlyQty(ts, k) : 0;
    const lyDaily =
      lyQty > 0
        ? monthlyQtyToDailyAvg(lyQty, input.forecastYear - 1, input.forecastMonth)
        : 0;
    const core = roundDaily(0.5 * anchorBoosted + 0.32 * med6Daily + 0.18 * avg12Daily);
    if (lyDaily > 0 && lyDaily >= core * 0.5 && lyDaily <= core * 1.45) {
      levelDaily = roundDaily(0.62 * core + 0.38 * lyDaily);
    } else {
      levelDaily = core;
    }
  }

  if (profile.lastMonth === 0 && activeLast6 >= 4) {
    levelDaily = roundDaily(Math.min(levelDaily, avg12Daily * 0.85));
  } else if (profile.lastMonth === 0 && activeLast6 <= 3 && k <= 2) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'a_risk_zero' };
  }

  let forecastDailyAvg = roundDaily(
    levelDaily *
      t2HorizonDiscount(k) *
      (profile.lastMonth > 0 && k <= 1 ? 1 : t2DemandProbabilityScale(k, profile)),
  );

  if (ratio != null && ratio < 0.75) {
    forecastDailyAvg = roundDaily(forecastDailyAvg * Math.max(0.62, ratio));
  } else if (risk.demandDiscount < 1) {
    forecastDailyAvg = roundDaily(forecastDailyAvg * risk.demandDiscount);
  }

  const capDaily = roundDaily(
    Math.min(
      med6Daily > 0 ? med6Daily * 1.12 : forecastDailyAvg,
      avg12Daily > 0 ? avg12Daily * 1.28 : forecastDailyAvg,
      anchorBoosted > 0 ? anchorBoosted * 1.15 : forecastDailyAvg,
    ),
  );
  if (capDaily > 0) {
    forecastDailyAvg = roundDaily(Math.min(forecastDailyAvg, capDaily));
  }

  if (profile.zeroMonthsLast12 >= 3 && k >= 2 && profile.lastMonth === 0) {
    forecastDailyAvg = roundDaily(Math.min(forecastDailyAvg, avg12Daily * 0.55));
  }

  if (
    profile.lastMonth > 0 &&
    activeLast6 >= 5 &&
    forecastDailyAvg > 0 &&
    avg12Daily > 0
  ) {
    const floorDaily = roundDaily(Math.min(avg12Daily, med6Daily > 0 ? med6Daily : avg12Daily) * 0.52);
    forecastDailyAvg = roundDaily(Math.max(forecastDailyAvg, floorDaily));
  }

  if (
    profile.lastMonth > 0 &&
    profile.zeroMonthsLast12 <= 1 &&
    activeLast6 >= 5 &&
    k <= 2
  ) {
    forecastDailyAvg = roundDaily(forecastDailyAvg * (k <= 1 ? 1.09 : 1.04));
  }

  if (forecastDailyAvg <= 0 && recent90 <= 0 && profile.avg12Monthly < 15) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'a_risk_zero' };
  }

  return {
    forecastDailyAvg,
    baselineDailyAvg: anchorBoosted > 0 ? anchorBoosted : avg12Daily,
    model: 't2_stable',
  };
}
