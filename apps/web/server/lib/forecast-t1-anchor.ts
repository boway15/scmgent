/**
 * T1·主力锚定 点预测：近端锚定 + YoY 参考 + 风险分层，主攻层专用。
 */
import {
  applyACoreUpperBound,
  applyHorizonBiasBudgetCap,
  applySymmetricBiasBudgetCap,
  computeDeclinePrecisionBlendWeights,
  computeHorizonBlendWeights,
  computeYoYGrowthFactor,
  daysInCalendarMonth,
  isDecliningSalesSignal,
  roundDaily,
  type SalesLifecycle,
} from './forecast-baseline.js';
import { evaluateAClassDemandRisk } from './forecast-a-risk.js';
import type { ACoreAlgoConfig } from './forecast-profile-config.js';
import type { T1SubSegment } from './forecast-sales-tier.js';
import {
  deriveRecentDailyFromMonthly,
  isLastMonthCollapsed,
  median6MonthlyQty,
  monthlyQtyToDailyAvg,
  seasonalNaiveMonthlyQty,
  type MonthlyAbcdForecastResult,
} from './forecast-monthly-abcd.js';

export type T1AnchorForecastInput = {
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
  aCoreConfig?: ACoreAlgoConfig;
  cv12m?: number;
  /** 子层路由：T1.1 启用对称偏差预算与远期折扣；T1.3 保持原参数 */
  t1SubSegment?: T1SubSegment;
};

const T1_ELITE_NEAR_YOY_BLEND = { near: 0.78, yoy: 0.22 } as const;
const T1_DEFAULT_NEAR_YOY_BLEND = { near: 0.72, yoy: 0.28 } as const;

function q4BoostFromSeries(monthlyQty: number[]): number {
  const ts = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  const last3 = ts.slice(-3);
  const prior9 = ts.slice(-12, -3);
  const last3Avg = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : 0;
  const prior9Avg = prior9.length ? prior9.reduce((a, b) => a + b, 0) / prior9.length : 0;
  return prior9Avg > 0 ? last3Avg / prior9Avg : 1;
}

/** T1.1 上界偏差预算（只压高估，不抬高低估） */
export function applyT1EliteUpperBiasCap(input: {
  forecastDailyAvg: number;
  anchorDaily: number;
  horizonMonthIndex: number;
}): number {
  const k = input.horizonMonthIndex;
  const budget = k <= 0 ? 0.12 : k <= 2 ? 0.15 : 0.18;
  const anchor = input.anchorDaily;
  if (anchor <= 0) return input.forecastDailyAvg;
  const maxF = roundDaily(anchor * (1 + budget));
  return roundDaily(Math.min(input.forecastDailyAvg, maxF));
}

function t1HorizonMacroDiscount(k: number, sub: T1SubSegment | undefined, q4Boost: number): number {
  if (sub !== 'T1.1_elite_stable') return 1;
  const weakQ4 = q4Boost < 0.95;
  if (k <= 0) return 1;
  if (k === 1) return weakQ4 ? 0.93 : 0.96;
  if (k === 2) return weakQ4 ? 0.88 : 0.91;
  let disc = weakQ4 ? 0.85 : 0.88;
  if (k >= 3) disc *= 0.95;
  return disc;
}

function isT1StableSub(sub: T1SubSegment | undefined): boolean {
  return sub === 'T1.1_elite_stable' || sub === 'T1.3_anchor_stable';
}

/** T1 近端锚：以 recent90 为主，尖峰/塌陷时修正 */
export function computeT1NearAnchorDaily(input: {
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  riskSeries: number[];
  forecastYear: number;
  forecastMonth: number;
}): number {
  const recent30 = input.recent30DailyAvg;
  const recent90 = input.recent90DailyAvg;
  const collapsed = isLastMonthCollapsed(input.riskSeries);
  if (collapsed) {
    return recent90 > 0 ? recent90 : recent30;
  }
  const last3 = input.riskSeries.slice(-3);
  const med3 = last3.length
    ? [...last3].sort((a, b) => a - b)[Math.floor(last3.length / 2)] ?? 0
    : 0;
  const daysLast = daysInCalendarMonth(
    input.forecastMonth === 1 ? input.forecastYear - 1 : input.forecastYear,
    ((input.forecastMonth - 2 + 12) % 12) + 1,
  );
  const med3Daily = med3 > 0 ? med3 / daysLast : 0;
  const last = input.riskSeries[input.riskSeries.length - 1] ?? 0;
  if (med3 > 0 && last > med3 * 1.2) {
    return roundDaily(Math.max(med3Daily, recent90 * 0.95));
  }
  return roundDaily(recent90 > 0 ? Math.min(recent30, recent90) * 0.98 + recent90 * 0.02 : recent30);
}

export function forecastT1AnchorDaily(input: T1AnchorForecastInput): MonthlyAbcdForecastResult {
  const derived = deriveRecentDailyFromMonthly(
    input.rawMonthlyQty ?? input.monthlyQty,
    input.forecastYear,
    input.forecastMonth,
  );
  const recent30 = input.recent30DailyAvg ?? derived.recent30DailyAvg;
  const recent90 = input.recent90DailyAvg ?? derived.recent90DailyAvg;
  const lifecycle = input.lifecycle ?? 'mature';
  const k = input.horizonIndex;
  const sub = input.t1SubSegment;
  const riskSeries = input.rawMonthlyQty ?? input.monthlyQty;
  const demandRisk = evaluateAClassDemandRisk(riskSeries);
  const lastMonth = riskSeries[riskSeries.length - 1] ?? 0;
  const prevMonth = riskSeries[riskSeries.length - 2] ?? 0;
  const collapsed = isLastMonthCollapsed(riskSeries);

  if (sub === 'T1.5_train_collapse' && k <= 2) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'a_risk_zero' };
  }

  const eliteDecline = sub === 'T1.2_elite_decline';
  const anchorDecline = sub === 'T1.4_anchor_decline';
  const declineSub = eliteDecline || anchorDecline;

  if (demandRisk.forceZero || (recent90 <= 0 && recent30 <= 0)) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'a_risk_zero' };
  }
  if (lastMonth === 0 && prevMonth > 0) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'a_risk_zero' };
  }
  if (
    collapsed &&
    k <= 2 &&
    demandRisk.tier !== 'stable' &&
    (demandRisk.last3ToPrior3Ratio ?? 1) < 0.85
  ) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'a_risk_zero' };
  }

  const nearAnchor = computeT1NearAnchorDaily({
    recent30DailyAvg: recent30,
    recent90DailyAvg: recent90,
    riskSeries,
    forecastYear: input.forecastYear,
    forecastMonth: input.forecastMonth,
  });

  const lyQty =
    input.monthlyQty.length >= 12 ? seasonalNaiveMonthlyQty(input.monthlyQty, k) : 0;
  const lyDaily =
    input.lastYearSameMonthDailyAvg ??
    (lyQty > 0 ? monthlyQtyToDailyAvg(lyQty, input.forecastYear - 1, input.forecastMonth) : 0);

  let forecastDailyAvg: number;
  const eliteStable = sub === 'T1.1_elite_stable';
  const q4Boost = q4BoostFromSeries(riskSeries);
  const nearYoy = eliteStable ? T1_ELITE_NEAR_YOY_BLEND : T1_DEFAULT_NEAR_YOY_BLEND;

  if (
    eliteStable &&
    k <= 2 &&
    demandRisk.tier === 'spike' &&
    lastMonth > 0 &&
    prevMonth > 0 &&
    lastMonth < prevMonth * 0.5
  ) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'a_risk_zero' };
  }

  if (declineSub && k <= 2) {
    const med6MonthlyDecl = median6MonthlyQty(riskSeries);
    const med6DailyDecl = monthlyQtyToDailyAvg(med6MonthlyDecl, input.forecastYear, input.forecastMonth);
    const horizonDisc = eliteDecline
      ? ([0.96, 0.9, 0.85] as const)[k] ?? 0.82
      : ([0.97, 0.92, 0.87] as const)[k] ?? 0.84;
    const level = roundDaily(
      Math.min(nearAnchor, med6DailyDecl > 0 ? med6DailyDecl : nearAnchor) * (0.88 + q4Boost * 0.1),
    );
    forecastDailyAvg = roundDaily(level * horizonDisc);
  } else if (declineSub) {
    const med6MonthlyDecl = median6MonthlyQty(riskSeries);
    const med6DailyDecl = monthlyQtyToDailyAvg(med6MonthlyDecl, input.forecastYear, input.forecastMonth);
    const horizonDisc = eliteDecline ? 0.82 : 0.86;
    const level = roundDaily(
      Math.min(nearAnchor, med6DailyDecl > 0 ? med6DailyDecl : nearAnchor) * (0.86 + q4Boost * 0.08),
    );
    forecastDailyAvg = roundDaily(level * horizonDisc);
  } else if (k <= 2) {
    if (lyDaily > 0 && demandRisk.tier === 'stable' && isT1StableSub(sub)) {
      const lyLo = eliteStable ? 0.8 : 0.75;
      const lyHi = eliteStable ? 1.2 : 1.35;
      let lyBounded =
        lyDaily >= nearAnchor * lyLo && lyDaily <= nearAnchor * lyHi ? lyDaily : nearAnchor;
      if (eliteStable && q4Boost < 1 && k >= 1) {
        lyBounded = Math.min(lyBounded, nearAnchor * 1.02);
      }
      if (eliteStable && k === 2 && q4Boost < 0.98) {
        forecastDailyAvg = nearAnchor;
      } else if (eliteStable && k === 1 && q4Boost < 0.96) {
        forecastDailyAvg = roundDaily(nearAnchor * 0.97 + nearYoy.yoy * Math.min(lyBounded, nearAnchor) * 0.03);
      } else {
        forecastDailyAvg = roundDaily(nearYoy.near * nearAnchor + nearYoy.yoy * lyBounded);
      }
    } else if (demandRisk.tier === 'decline' || demandRisk.tier === 'spike') {
      forecastDailyAvg = roundDaily(nearAnchor * (demandRisk.tier === 'spike' ? 0.96 : 0.92));
    } else {
      forecastDailyAvg = nearAnchor;
    }
  } else {
    const declining = isDecliningSalesSignal(lifecycle, recent30, recent90);
    let wNear: number;
    let wYoy: number;
    if (eliteStable) {
      wNear = 0.88;
      wYoy = 0.12;
    } else {
      ({ wNear, wYoy } = computeHorizonBlendWeights(k, { decliningNearBias: declining }));
    }
    const yoyAnchor = input.yoyAnchorDailyAvg ?? recent90;
    const maxYoY = eliteStable ? 1.05 : 1.08;
    const structuralLevel =
      lyDaily > 0
        ? roundDaily(
            lyDaily *
              computeYoYGrowthFactor(nearAnchor, yoyAnchor, {
                maxFactor: maxYoY,
              }),
          )
        : nearAnchor;
    forecastDailyAvg = roundDaily(wNear * nearAnchor + wYoy * structuralLevel);
  }

  if (demandRisk.demandDiscount < 1) {
    forecastDailyAvg = roundDaily(forecastDailyAvg * demandRisk.demandDiscount);
  }

  if (eliteStable && q4Boost < 0.92) {
    forecastDailyAvg = roundDaily(forecastDailyAvg * (0.88 + q4Boost * 0.08));
  }

  const med6Monthly = median6MonthlyQty(riskSeries);
  const med6Daily = monthlyQtyToDailyAvg(med6Monthly, input.forecastYear, input.forecastMonth);
  const headroom = [1.04, 1.05, 1.06, 1.07, 1.08, 1.1][k] ?? 1.1;
  const capAnchor = roundDaily(
    Math.min(
      nearAnchor > 0 ? nearAnchor : Number.POSITIVE_INFINITY,
      med6Daily > 0 ? med6Daily : Number.POSITIVE_INFINITY,
    ),
  );
  if (capAnchor > 0) {
    const declineHeadroom = ([1.02, 1.025, 1.03, 1.035, 1.04, 1.05] as const)[k] ?? 1.05;
    const eliteHeadroom = eliteStable
      ? declineHeadroom
      : declineSub
        ? declineHeadroom
        : headroom;
    forecastDailyAvg = roundDaily(Math.min(forecastDailyAvg, capAnchor * eliteHeadroom));
  }

  if (collapsed && k <= 2 && lastMonth > 0 && !declineSub) {
    const floorDaily = roundDaily(recent90 * 0.9);
    if (floorDaily > 0 && demandRisk.tier === 'stable' && sub !== 'T1.1_elite_stable') {
      forecastDailyAvg = roundDaily(Math.max(forecastDailyAvg, floorDaily));
    }
  }

  if (eliteStable) {
    forecastDailyAvg = applyT1EliteUpperBiasCap({
      forecastDailyAvg,
      anchorDaily: nearAnchor,
      horizonMonthIndex: k,
    });
  } else if (!declineSub) {
    forecastDailyAvg = applySymmetricBiasBudgetCap({
      forecastDailyAvg,
      recent30DailyAvg: recent30,
      recent90DailyAvg: recent90,
      horizonMonthIndex: k,
      lifecycle,
      profileSegment: 'A:core',
    });
  }

  const macroDisc = t1HorizonMacroDiscount(k, sub, q4Boost);
  if (macroDisc < 1) {
    forecastDailyAvg = roundDaily(forecastDailyAvg * macroDisc);
  }

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

  return {
    forecastDailyAvg,
    baselineDailyAvg: nearAnchor,
    model: 't1_anchor',
  };
}
