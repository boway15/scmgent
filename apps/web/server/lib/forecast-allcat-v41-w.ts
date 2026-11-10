/**
 * AllCategory V4.1-W：ISO 周 walk-forward 特征（w4/w8/w12/w16）+ 复用 V4.1 套限幅。
 */
import { roundDaily } from './forecast-baseline.js';
import type { DemandReconstructAudit } from './forecast-demand-unconstrain.js';
import {
  ALLCAT_V41_TIER_SYSTEM,
  blendForwardForecastLevel,
  applyPeerPlatformNearFloor,
  applyV41NearRecentRunRateCap,
  applyV41SecondaryChannelRunRateCap,
  computeAllCatV41BoundedDaily,
  computeForwardSeasonalDaily,
  resolveAllCatProductCategory,
  resolveAllCatV41Tier,
  type AllCatV41Metrics,
  type AllCatV41Tier,
  type AllCatV41TierInput,
} from './forecast-allcat-v41.js';
import {
  applyFlexBiasShadowCorrection,
  mergeFlexBiasShadowHorizonFactors,
} from './forecast-flex-bias-shadow.js';
import { horizonBandFromIndex } from './forecast-horizon-band.js';
import { resolveT99SystemFloorDiscount } from './forecast-demand.js';
import { addIsoWeeks, isoWeekKeyFromUtcDate, isoWeekMondayUtc } from './planning-calendar.js';
import { weekIndexToHorizonMonthIndex } from './demand-plan-reconstruct.js';

export const ALLCAT_V41_W_MODEL = 'allcat_v41_w';
export const ALLCAT_V41_W_TIER_SYSTEM = 'AllCategory-KPI-CoreFirst-T99-V41-W';

export type AllCatV41WMetrics = {
  q4: number;
  q8: number;
  q12: number;
  q16: number;
  w4: number;
  w8: number;
  w12: number;
  w16: number;
  activeW4: number;
  activeW8: number;
  activeW16: number;
  cv8: number;
  trendRatioW: number;
};

export type AllCatV41WForecastResult = {
  tier: AllCatV41Tier;
  baseDaily: number;
  forecastDaily: number;
  metrics: AllCatV41WMetrics;
  horizonFactors: Record<string, unknown>;
  formula: string;
};

export function aggregateDailyQtyByIsoWeek(
  dailyRows: Array<{ saleDate: string; qtySold: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of dailyRows) {
    const key = String(row.saleDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const weekKey = isoWeekKeyFromUtcDate(new Date(`${key}T12:00:00.000Z`));
    map.set(weekKey, (map.get(weekKey) ?? 0) + Number(row.qtySold));
  }
  return map;
}

function sumQtyInWeeksBefore(weeklyQty: Map<string, number>, targetWeekKey: string, weekCount: number): number {
  let sum = 0;
  for (let i = 1; i <= weekCount; i += 1) {
    sum += weeklyQty.get(addIsoWeeks(targetWeekKey, -i)) ?? 0;
  }
  return sum;
}

function countActiveWeeksBefore(weeklyQty: Map<string, number>, targetWeekKey: string, weekCount: number): number {
  let count = 0;
  for (let i = 1; i <= weekCount; i += 1) {
    const qty = weeklyQty.get(addIsoWeeks(targetWeekKey, -i)) ?? 0;
    if (qty > 0) count += 1;
  }
  return count;
}

function positiveQtysLast8Weeks(weeklyQty: Map<string, number>, targetWeekKey: string): number[] {
  const vals: number[] = [];
  for (let i = 1; i <= 8; i += 1) {
    const qty = weeklyQty.get(addIsoWeeks(targetWeekKey, -i)) ?? 0;
    if (qty > 0) vals.push(qty);
  }
  return vals;
}

/** 批量生成时 horizonWeekIndex>0 冻结于首周锚点 */
export function resolveWalkForwardWeeklyMetricsTargetWeek(
  targetWeekKey: string,
  anchorWeekKey: string | undefined,
  horizonWeekIndex: number,
): string {
  if (horizonWeekIndex <= 0 || !anchorWeekKey) return targetWeekKey;
  return anchorWeekKey;
}

export function computeWalkForwardWeeklyMetrics(
  weeklyQty: Map<string, number>,
  targetWeekKey: string,
): AllCatV41WMetrics {
  const q4 = sumQtyInWeeksBefore(weeklyQty, targetWeekKey, 4);
  const q8 = sumQtyInWeeksBefore(weeklyQty, targetWeekKey, 8);
  const q12 = sumQtyInWeeksBefore(weeklyQty, targetWeekKey, 12);
  const q16 = sumQtyInWeeksBefore(weeklyQty, targetWeekKey, 16);

  const pos8 = positiveQtysLast8Weeks(weeklyQty, targetWeekKey);
  const avgPos8 = pos8.length > 0 ? pos8.reduce((a, b) => a + b, 0) / pos8.length : 0;
  let cv8 = 9;
  if (pos8.length >= 2 && avgPos8 > 0) {
    const variance = pos8.reduce((sum, v) => sum + (v - avgPos8) ** 2, 0) / (pos8.length - 1);
    cv8 = Math.sqrt(variance) / avgPos8;
  } else if (pos8.length === 1 && avgPos8 > 0) {
    cv8 = 0;
  }

  const trendDenom = q8 - q4;
  const trendRatioW = trendDenom > 0 ? q4 / trendDenom : 1;

  return {
    q4,
    q8,
    q12,
    q16,
    w4: q4 / 28,
    w8: q8 / 56,
    w12: q12 / 84,
    w16: q16 / 112,
    activeW4: countActiveWeeksBefore(weeklyQty, targetWeekKey, 4),
    activeW8: countActiveWeeksBefore(weeklyQty, targetWeekKey, 8),
    activeW16: countActiveWeeksBefore(weeklyQty, targetWeekKey, 16),
    cv8,
    trendRatioW,
  };
}

/** 将周特征映射为 V4.1 分层输入（active 窗口等价换算） */
export function legacyTierMetricsFromWeekly(w: AllCatV41WMetrics): AllCatV41Metrics {
  return {
    q1: w.q4,
    q3: w.q8,
    q6: w.q8,
    q12: w.q16,
    d2: w.w4,
    d3: w.w4,
    d6: w.w8,
    d12: w.w16,
    active2: w.activeW4 >= 4 ? 2 : w.activeW4 >= 2 ? 2 : 0,
    active6: w.activeW8 >= 8 ? 6 : w.activeW8 >= 5 ? 5 : w.activeW8,
    active12: w.activeW16 >= 10 ? 8 : w.activeW16,
    cv6: w.cv8,
    trendRatio: w.trendRatioW,
  };
}

export function computeAllCatV41WBaseDaily(tier: AllCatV41Tier, m: AllCatV41WMetrics): number {
  switch (tier) {
    case 'T1':
      return 0.15 * m.w4 + 0.55 * m.w8 + 0.3 * m.w16;
    case 'T2':
      return 0.25 * m.w4 + 0.55 * m.w8 + 0.2 * m.w16;
    case 'T3':
      return 0.35 * m.w4 + 0.5 * m.w8 + 0.15 * m.w16;
    case 'T3P':
      return 0.45 * m.w4 + 0.45 * m.w8 + 0.1 * m.w16;
    case 'T4A':
      return 0.5 * m.w4 + 0.45 * m.w8 + 0.05 * m.w16;
    case 'T4B':
      if (m.activeW16 < 10) {
        return 0.45 * m.w4 + 0.4 * m.w8;
      }
      return 0.3 * m.w4 + 0.4 * m.w8 + 0.3 * m.w16;
    default:
      return 0;
  }
}

function tierFormulaW(tier: AllCatV41Tier, m: AllCatV41WMetrics): string {
  switch (tier) {
    case 'T1':
      return '0.15*w4 + 0.55*w8 + 0.30*w16';
    case 'T2':
      return '0.25*w4 + 0.55*w8 + 0.20*w16';
    case 'T3':
      return '0.35*w4 + 0.50*w8 + 0.15*w16';
    case 'T3P':
      return '0.45*w4 + 0.45*w8 + 0.10*w16';
    case 'T4A':
      return '0.50*w4 + 0.45*w8 + 0.05*w16';
    case 'T4B':
      return m.activeW16 < 10 ? '0.45*w4 + 0.40*w8' : '0.30*w4 + 0.40*w8 + 0.30*w16';
    case 'T99':
      return 'max(recent30,recent90,w4)*1.0 near / max(r)*0.8 far';
    default:
      return 'no_forecast';
  }
}

export function computeAllCatV41WForecastForWeek(input: {
  productCategory: string;
  platform: string;
  targetWeekKey: string;
  horizonWeekIndex: number;
  anchorWeekKey?: string;
  weeklyQty: Map<string, number>;
  monthlyRows: Array<{ saleYear: number; month: number; qtySold: number }>;
  recent30DailyAvg?: number | null;
  recent90DailyAvg?: number | null;
  peerPlatformRecentDaily?: number | null;
  historyCapEnd?: Date;
  demandReconstruct?: DemandReconstructAudit;
  flexBiasShadow?: boolean | null;
}): AllCatV41WForecastResult {
  const metricsWeekKey = resolveWalkForwardWeeklyMetricsTargetWeek(
    input.targetWeekKey,
    input.anchorWeekKey,
    input.horizonWeekIndex,
  );
  const wMetrics = computeWalkForwardWeeklyMetrics(input.weeklyQty, metricsWeekKey);
  const legacyMetrics = legacyTierMetricsFromWeekly(wMetrics);
  const productCategory = resolveAllCatProductCategory(input.productCategory);
  const platform = input.platform.trim().toUpperCase() || 'UNKNOWN';

  const tierInput: AllCatV41TierInput = {
    productCategory,
    platform,
    recent30DailyAvg: input.recent30DailyAvg,
    ...legacyMetrics,
  };
  const tier = resolveAllCatV41Tier(tierInput);
  const anchorDaily = computeAllCatV41WBaseDaily(tier, wMetrics);

  const monday = isoWeekMondayUtc(input.targetWeekKey);
  const forecastYear = monday.getUTCFullYear();
  const forecastMonth = monday.getUTCMonth() + 1;
  const horizonIndex = weekIndexToHorizonMonthIndex(input.horizonWeekIndex);

  let levelDaily = anchorDaily;
  let seasonalDaily: number | undefined;
  if (input.historyCapEnd) {
    seasonalDaily = computeForwardSeasonalDaily({
      monthlyRows: input.monthlyRows,
      historyCapEnd: input.historyCapEnd,
      horizonIndex,
      forecastYear,
      forecastMonth,
    });
    levelDaily = blendForwardForecastLevel(anchorDaily, seasonalDaily, horizonIndex);
  }

  const bounded = computeAllCatV41BoundedDaily({
    tier,
    baseDaily: levelDaily,
    productCategory,
    forecastMonth,
    horizonIndex,
    metrics: legacyMetrics,
    recent30DailyAvg: input.recent30DailyAvg,
    recent90DailyAvg: input.recent90DailyAvg,
  });

  const secondaryPrePeer = applyV41SecondaryChannelRunRateCap({
    forecastDaily: bounded.forecastDaily,
    platform: input.platform,
    recent30DailyAvg: input.recent30DailyAvg,
  });

  const peerLift =
    tier === 'T99' || bounded.ghostGated
      ? { forecastDaily: secondaryPrePeer, peerPlatformFloor: null as number | null }
      : applyPeerPlatformNearFloor({
          forecastDaily: secondaryPrePeer,
          horizonIndex,
          peerPlatformRecentDaily: input.peerPlatformRecentDaily,
          platform: input.platform,
          recent30DailyAvg: input.recent30DailyAvg,
        });
  const secondaryPostPeer = applyV41SecondaryChannelRunRateCap({
    forecastDaily: peerLift.forecastDaily,
    platform: input.platform,
    recent30DailyAvg: input.recent30DailyAvg,
  });

  const flexBiasShadow = applyFlexBiasShadowCorrection({
    tier,
    horizonIndex,
    forecastDaily: secondaryPostPeer,
    flexBiasShadow: input.flexBiasShadow,
  });
  const nearRunRate = applyV41NearRecentRunRateCap({
    forecastDaily: flexBiasShadow.forecastDaily,
    horizonIndex,
    forecastMonth,
    recent30DailyAvg: input.recent30DailyAvg,
    d6: legacyMetrics.d6,
  });
  const forecastDaily = nearRunRate;
  const secondaryEffective =
    secondaryPostPeer + 1e-9 < peerLift.forecastDaily
      ? secondaryPostPeer
      : secondaryPrePeer + 1e-9 < bounded.forecastDaily
        ? secondaryPrePeer
        : null;
  const optimismDamp = {
    nearRunRateCap:
      nearRunRate + 1e-9 < flexBiasShadow.forecastDaily ? nearRunRate : null,
    secondaryChannelCap: secondaryEffective,
  };

  const historyCutoff = input.historyCapEnd
    ? input.historyCapEnd.toISOString().slice(0, 10)
    : addIsoWeeks(metricsWeekKey, -1);

  const horizonFactors: Record<string, unknown> = {
    tier,
    tierSystem: ALLCAT_V41_W_TIER_SYSTEM,
    model: ALLCAT_V41_W_MODEL,
    productCategory,
    formula: tierFormulaW(tier, wMetrics),
    w4: roundDaily(wMetrics.w4),
    w8: roundDaily(wMetrics.w8),
    w12: roundDaily(wMetrics.w12),
    w16: roundDaily(wMetrics.w16),
    activeW4: wMetrics.activeW4,
    activeW8: wMetrics.activeW8,
    activeW16: wMetrics.activeW16,
    cv8: roundDaily(wMetrics.cv8),
    trendRatioW: roundDaily(wMetrics.trendRatioW),
    walkForward: true,
    historyCutoff,
    targetWeekKey: input.targetWeekKey,
    metricsWeekKey,
    horizonWeekIndex: input.horizonWeekIndex,
    horizonBand: horizonBandFromIndex(horizonIndex),
    anchorDaily: roundDaily(anchorDaily),
    seasonalDaily: seasonalDaily != null ? roundDaily(seasonalDaily) : undefined,
    levelDaily: roundDaily(levelDaily),
    effectiveTrendDecay: bounded.trendDecay,
    monthFactor: bounded.monthFactor,
    conservativeFactor: bounded.conservativeFactor,
    growthSignal: bounded.growthSignal,
    rollingRatio: bounded.rollingRatio,
  };
  Object.assign(horizonFactors, input.demandReconstruct ?? {});
  mergeFlexBiasShadowHorizonFactors(horizonFactors, flexBiasShadow);
  if (optimismDamp.nearRunRateCap != null) {
    horizonFactors.nearRunRateCap = optimismDamp.nearRunRateCap;
  }
  if (optimismDamp.secondaryChannelCap != null) {
    horizonFactors.secondaryChannelCap = optimismDamp.secondaryChannelCap;
  }

  return {
    tier,
    baseDaily: roundDaily(levelDaily),
    forecastDaily,
    metrics: wMetrics,
    horizonFactors,
    formula: tierFormulaW(tier, wMetrics),
  };
}
