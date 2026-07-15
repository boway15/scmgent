/**
 * AllCategory V4.1 KPI tier system — ported from tmp_create_allcat_v41_kpi_forecast.sql
 */

import { roundDaily } from './forecast-baseline.js';
import { horizonBandFromIndex } from './forecast-horizon-band.js';
import {
  monthlyQtyToDailyAvg,
  seasonalNaiveMonthlyQty,
} from './forecast-monthly-abcd.js';
import { buildLast12MonthlyQty } from './forecast-profile-snapshot.js';

export type AllCatV41Tier = 'T1' | 'T2' | 'T3' | 'T3P' | 'T4A' | 'T4B' | 'T99';

/** T4B 稳定保底：连续性逃逸阈值（未进 T1–T4A 时启用） */
export const T4B_STABLE_FLOOR_THRESHOLDS = {
  minActive6: 4,
  minActive12: 8,
  minActive2: 2,
  maxCv6: 1.15,
} as const;

/** T4B 新品/短历史：近端连续有销但不满 12 月 */
export const T4B_NEW_PRODUCT_THRESHOLDS = {
  minActive2: 2,
  minActive6: 2,
  maxCv6: 1.25,
} as const;

export const ALLCAT_V41_TIER_SYSTEM = 'AllCategory-KPI-CoreFirst-T99-V41';
export const ALLCAT_V41_MODEL = 'allcat_kpi_corefirst_v41';

/** V4.1 KPI 分层中文名（与前端 forecast-labels 对齐） */
export const ALLCAT_V41_TIER_LABEL: Record<AllCatV41Tier, string> = {
  T1: 'T1 主力稳定',
  T2: 'T2 核心高量',
  T3: 'T3 中量',
  T3P: 'T3P 非亚马逊稳定',
  T4A: 'T4A 亚马逊边界',
  T4B: 'T4B 稳定保底',
  T99: 'T99 不预测',
};

export function formatAllCatV41TierLabel(tier?: string | null): string {
  if (!tier?.trim()) return '-';
  const key = tier.trim() as AllCatV41Tier;
  return ALLCAT_V41_TIER_LABEL[key] ?? tier;
}

/** 生成时持久化的套限幅因子（供前端 tooltip 对齐系统列，避免重算偏差） */
export type AllCatV41BoundedSnapshot = {
  productCategory?: string;
  effectiveTrendDecay?: number;
  monthFactor?: number;
  conservativeFactor?: number;
  tierCeiling?: number;
  nearHorizonFloor?: number | null;
  growthSignal?: boolean;
  rollingRatio?: number;
};

/** 抽屉/明细展示用 V4.1 因子（与 legacy HorizonFactorSnapshot 不同结构） */
export type AllCatV41HorizonDisplay = AllCatV41BoundedSnapshot & {
  tier: AllCatV41Tier;
  d6: number;
  d3: number;
  trendRatio: number;
  cv6: number;
  anchorDaily?: number;
  seasonalDaily?: number;
  levelDaily?: number;
  formula: string;
  algorithm: string;
};

export function parseAllCatV41HorizonFactors(raw: unknown): AllCatV41HorizonDisplay | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.tierSystem !== ALLCAT_V41_TIER_SYSTEM) return null;
  const tier = value.tier;
  if (
    tier !== 'T1' &&
    tier !== 'T2' &&
    tier !== 'T3' &&
    tier !== 'T3P' &&
    tier !== 'T4A' &&
    tier !== 'T4B' &&
    tier !== 'T99'
  ) {
    return null;
  }
  const num = (key: string): number | undefined => {
    const parsed = Number(value[key]);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const nearHorizonFloor = num('nearHorizonFloor');
  return {
    tier,
    d6: num('d6') ?? 0,
    d3: num('d3') ?? 0,
    trendRatio: num('trendRatio') ?? 1,
    cv6: num('cv6') ?? 0,
    anchorDaily: num('anchorDaily'),
    seasonalDaily: num('seasonalDaily'),
    levelDaily: num('levelDaily'),
    formula: typeof value.formula === 'string' ? value.formula : '',
    algorithm: typeof value.algorithm === 'string' ? value.algorithm : '',
    productCategory:
      typeof value.productCategory === 'string' ? value.productCategory : undefined,
    effectiveTrendDecay: num('effectiveTrendDecay'),
    monthFactor: num('monthFactor'),
    conservativeFactor: num('conservativeFactor'),
    tierCeiling: num('tierCeiling'),
    nearHorizonFloor: nearHorizonFloor != null ? nearHorizonFloor : undefined,
    growthSignal: value.growthSignal === true ? true : value.growthSignal === false ? false : undefined,
    rollingRatio: num('rollingRatio'),
  };
}

export type AllCatV41Metrics = {
  q1: number;
  q3: number;
  q6: number;
  q12: number;
  d2: number;
  d3: number;
  d6: number;
  d12: number;
  active2: number;
  active6: number;
  active12: number;
  cv6: number;
  trendRatio: number;
};

export const T99_RECENT_MONTH_DAILY_MIN = 0.2;

/** recent30/recent90 超过此值视为 growth，趋势衰减改用滚动口径且不低于 1.0 */
export const V41_GROWTH_RECENT_RATIO_MIN = 1.15;

/** 近端月（k≤2）系统输出不低于混合水平、d6、recent90 的此比例（主要用于 T4 保底层） */
export const V41_NEAR_HORIZON_BLEND_FLOOR = 0.85;
export const V41_NEAR_HORIZON_D6_FLOOR = 0.9;
export const V41_NEAR_HORIZON_RECENT90_FLOOR = 0.85;
/** T1/T2 近端仅防极端塌陷，不抬升至 d6/recent90 */
export const V41_CORE_NEAR_BLEND_FLOOR = 0.78;
export const V41_CORE_COLLAPSE_THRESHOLD = 0.7;

/** Q2 目标月（4–6 月）核心层额外季节折减 */
export const V41_Q2_TARGET_MONTHS = new Set([4, 5, 6]);
export const V41_Q2_SEASONAL_DISCOUNT = 0.92;
/** T2/T3 在 Q2 目标月再叠一层折减（压右尾高估） */
export const V41_Q2_MID_TIER_EXTRA_DISCOUNT = 0.95;

/** T4A 边界层保守化（四轮：上界再贴 recent + 弱动销扩闸） */
export const V41_T4A_CONSERVATIVE_FACTOR = 0.58;
export const V41_T4A_FLOOR_MIN_DAILY = 0;
export const V41_T4A_FLOOR_D6_RATIO = 0.08;
export const V41_T4A_NEAR_BLEND_FLOOR = 0;
export const V41_T4A_NEAR_D6_FLOOR = 0;
export const V41_T4A_NEAR_RECENT90_FLOOR = 0;
export const V41_T4A_FLEX_DECAY_FROM_K = 3;
export const V41_T4A_FLEX_DECAY_FACTOR = 0.72;
export const V41_T4A_MIN_TREND_RATIO = 0.8;
export const V41_T4_TAIL_MONTH_DISCOUNT = 0.8;

/** T4B 稳定保底层：优先压 ghost，无近端抬底 */
export const V41_T4B_CONSERVATIVE_FACTOR = 0.6;
export const V41_T4B_FLOOR_MIN_DAILY = 0;
export const V41_T4B_FLOOR_D6_RATIO = 0.08;
export const V41_T4B_NEAR_BLEND_FLOOR = 0;
export const V41_T4B_NEAR_D6_FLOOR = 0;
export const V41_T4B_NEAR_RECENT90_FLOOR = 0;
export const V41_T4B_FLEX_DECAY_FROM_K = 3;
export const V41_T4B_FLEX_DECAY_FACTOR = 0.72;
/** T4 弱动销：日销低于此视为不可预测（ghost gate，四轮扩闸） */
export const V41_T4_WEAK_RECENT30_MIN = 0.35;
export const V41_T4_WEAK_RECENT90_MIN = 0.55;
export const V41_T4_WEAK_Q1_DAILY_MIN = 0.3;
/** 近端相对 90 天明显走弱 */
export const V41_T4_DECLINING_RECENT_RATIO_MAX = 0.65;
/** 日历趋势低于此值时 T4 直接 ghost */
export const V41_T4_GHOST_TREND_RATIO_MAX = 0.65;

/** 低量 SKU（d6/近端偏低）预测上界，抑制极低分母导致 WMAPE 爆表 */
export const V41_MICRO_D6_MAX = 0.5;
export const V41_MICRO_RECENT90_MAX = 0.4;
/** T3/T3P 弱动销 ghost：d6 偏低且近端走弱 */
export const V41_T3_MICRO_D6_MAX = 0.4;

/** T2/T3 右尾上界偏差预算（近端 / flex） */
export const V41_MID_NEAR_UPPER_BIAS = 0.05;
export const V41_MID_FLEX_UPPER_BIAS = 0.04;
export const V41_CORE_NEAR_UPPER_BIAS = 0.1;
export const V41_CORE_FLEX_UPPER_BIAS = 0.08;

/** T4A 上界相对 recent/anchor 的贴合系数 */
export const V41_T4A_ANCHOR_CAP = 0.95;
export const V41_T4A_RECENT90_CAP = 0.85;
export const V41_T4A_RECENT30_CAP = 0.8;
export const V41_T4A_D6_CAP = 0.9;
export const V41_T4B_ANCHOR_CAP = 1.0;
export const V41_T4B_RECENT90_CAP = 0.9;
export const V41_T4B_RECENT30_CAP = 0.85;
export const V41_T4B_D6_CAP = 0.95;

function nonNegative(value: number | undefined | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

/** 最近一个自然月折算日均（走步月表口径，约等于近 30 天） */
export function resolveRecentMonthDailyAvg(metrics: Pick<AllCatV41Metrics, 'q1'>): number {
  return metrics.q1 > 0 ? metrics.q1 / 30 : 0;
}

/** 近端零销 / 弱动销 / 下行趋势（T4A/T4B ghost 防控） */
export function isAllCatV41RecentSalesAbsent(input: {
  recent30DailyAvg?: number | null;
  recent90DailyAvg?: number | null;
  metrics?: Pick<AllCatV41Metrics, 'q1' | 'active2' | 'trendRatio'>;
  tier?: AllCatV41Tier;
}): boolean {
  const recent30 = nonNegative(input.recent30DailyAvg);
  const recent90 = nonNegative(input.recent90DailyAvg);
  const hasExplicitRecent =
    input.recent30DailyAvg != null || input.recent90DailyAvg != null;
  const active2 = input.metrics?.active2 ?? 0;
  const q1Daily = input.metrics?.q1 ? input.metrics.q1 / 30 : 0;
  const tailTier = input.tier === 'T4A' || input.tier === 'T4B';

  if (recent30 <= 0 && recent90 <= 0) {
    if (tailTier) {
      // 无日销滚动窗口时，用 Q1+active2 兜底，避免 T4B 稳定保底被误杀
      if (!hasExplicitRecent && q1Daily >= V41_T4_WEAK_Q1_DAILY_MIN && active2 >= 2) {
        return false;
      }
      return true;
    }
    return active2 < 2;
  }

  if (tailTier) {
    if (recent30 < V41_T4_WEAK_RECENT30_MIN && recent90 < V41_T4_WEAK_RECENT90_MIN) {
      return true;
    }
    if (q1Daily > 0 && q1Daily < V41_T4_WEAK_Q1_DAILY_MIN && recent30 < V41_T4_WEAK_RECENT30_MIN) {
      return true;
    }
    if (recent90 > 0 && recent30 > 0 && recent30 / recent90 < V41_T4_DECLINING_RECENT_RATIO_MAX) {
      return true;
    }
    if (input.metrics?.trendRatio != null && input.metrics.trendRatio < V41_T4_GHOST_TREND_RATIO_MAX) {
      return true;
    }
  }

  return false;
}

/** 近端仍有稳定动销时，避免轻易落入 T99 */
export function shouldBypassT99Classification(
  metrics: AllCatV41Metrics,
  recent30DailyAvg?: number | null,
  recent90DailyAvg?: number | null,
): boolean {
  const recent90 = nonNegative(recent90DailyAvg);
  if (recent90 <= 0 && metrics.active2 < 2) return false;
  const q1Daily = metrics.q1 > 0 ? metrics.q1 / 30 : 0;
  if (recent90 < V41_T4_WEAK_RECENT90_MIN && q1Daily < V41_T4_WEAK_Q1_DAILY_MIN && metrics.active2 < 2) {
    return false;
  }
  if (recent30DailyAvg != null && recent30DailyAvg > T99_RECENT_MONTH_DAILY_MIN) {
    return true;
  }
  return resolveRecentMonthDailyAvg(metrics) > T99_RECENT_MONTH_DAILY_MIN;
}

export type AllCatV41TierInput = {
  productCategory: string;
  platform: string;
  recent30DailyAvg?: number | null;
} & AllCatV41Metrics;

export type AllCatV41ForecastResult = {
  tier: AllCatV41Tier;
  baseDaily: number;
  forecastDaily: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  horizonBand: 'precision' | 'flex' | 'strategic';
  kpiTarget: string;
  algorithm: string;
  formula: string;
  metrics: AllCatV41Metrics;
  horizonFactors: Record<string, unknown>;
  forecastDailyP10: number;
  forecastDailyP90: number;
};

const NON_AMAZON_PLATFORMS = new Set(['UNKNOWN', 'WALMART', 'TEMU', 'TIKTOK']);

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthStartUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

/** 产品分类首字母 A/B/C/D/U，与 SQL COALESCE(product_category,'U') 对齐 */
export function resolveAllCatProductCategory(raw?: string | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) return 'U';
  const head = trimmed.charAt(0).toUpperCase();
  if (head === 'A' || head === 'B' || head === 'C' || head === 'D') return head;
  return 'U';
}

export function isAllCatV41Forecastable(tier: AllCatV41Tier): boolean {
  return tier !== 'T99';
}

const ALLCAT_V41_TIER_CODES = new Set<string>(['T1', 'T2', 'T3', 'T3P', 'T4A', 'T4B', 'T99']);

export function isAllCatV41TierCode(segment?: string | null): segment is AllCatV41Tier {
  if (!segment?.trim()) return false;
  return ALLCAT_V41_TIER_CODES.has(segment.trim());
}

/** T4B 保底 / T99 不预测层不参与主 KPI 准确率 */
export function isAllCatV41KpiComparableTier(segment?: string | null): boolean {
  if (!segment?.trim() || !isAllCatV41TierCode(segment)) return true;
  const tier = segment.trim() as AllCatV41Tier;
  return tier !== 'T99' && tier !== 'T4B';
}

/** 有历史连续性但未达 T1–T4A 门槛时，给予保守保底预测（覆盖 U 类、低 d6 等误杀） */
export function resolveStableFloorTier(metrics: AllCatV41Metrics): 'T4B' | null {
  const { d6, d12, active2, active6, active12, cv6, q1 } = metrics;
  const t = T4B_STABLE_FLOOR_THRESHOLDS;
  if (d6 <= 0 && d12 <= 0) return null;
  if (q1 <= 0 && active2 < 2) return null;
  if (active6 < t.minActive6) return null;
  if (active12 < t.minActive12) return null;
  if (active2 < t.minActive2) return null;
  if (cv6 > t.maxCv6) return null;
  return 'T4B';
}

/** 新品或短历史：近 2 月连续有销即可保底（不满 stable 的 12 月门槛） */
export function resolveNewProductFloorTier(metrics: AllCatV41Metrics): 'T4B' | null {
  const { d6, d3, active2, active6, active12, cv6 } = metrics;
  const t = T4B_NEW_PRODUCT_THRESHOLDS;
  if (d6 <= 0 && d3 <= 0) return null;
  if (active2 < t.minActive2) return null;
  if (active6 < t.minActive6) return null;
  if (active12 >= T4B_STABLE_FLOOR_THRESHOLDS.minActive12) return null;
  if (cv6 > t.maxCv6) return null;
  return 'T4B';
}

export function isT4BShortHistory(metrics: Pick<AllCatV41Metrics, 'active12'>): boolean {
  return metrics.active12 < T4B_STABLE_FLOOR_THRESHOLDS.minActive12;
}

/** 最近一个自然月有动销但日均偏低、未达 T4B 双月门槛时，仍给保守保底预测 */
export function resolveSparseRecentSaleFloorTier(
  metrics: Pick<AllCatV41Metrics, 'q1' | 'active2'>,
): 'T4B' | null {
  if (metrics.q1 <= 0) return null;
  if (metrics.q1 / 30 < V41_T4_WEAK_Q1_DAILY_MIN) return null;
  if (metrics.active2 < 2) return null;
  return 'T4B';
}

function resolveT4AIfEligible(input: AllCatV41TierInput): 'T4A' | null {
  if (input.active2 < 2) return null;
  if (input.trendRatio < V41_T4A_MIN_TREND_RATIO) return null;
  if (input.cv6 > 1.0) return null;
  const recent30 = nonNegative(input.recent30DailyAvg);
  if (recent30 > 0 && recent30 < V41_T4_WEAK_RECENT30_MIN) return null;
  const q1Daily = input.q1 > 0 ? input.q1 / 30 : 0;
  if (q1Daily > 0 && q1Daily < V41_T4_WEAK_Q1_DAILY_MIN && recent30 < V41_T4_WEAK_RECENT30_MIN) {
    return null;
  }
  return 'T4A';
}

export function resolveAllCatV41Tier(input: AllCatV41TierInput): AllCatV41Tier {
  const cat = input.productCategory;
  const plat = input.platform.trim().toUpperCase() || 'UNKNOWN';
  const { d6, active2, active6, cv6, d3 } = input;

  if (cat === 'A' && plat === 'AMAZON') {
    if (d6 >= 20 && active6 === 6 && cv6 <= 0.65 && active2 === 2) return 'T1';
    if (d6 >= 10 && active6 >= 5 && cv6 <= 0.8 && active2 === 2) return 'T2';
    if (d6 >= 5 && active6 >= 5 && cv6 <= 0.95 && active2 === 2) return 'T3';
    if (d6 >= 3 && active6 >= 5 && cv6 <= 0.95 && active2 === 2) {
      const t4a = resolveT4AIfEligible(input);
      if (t4a) return t4a;
    }
  }
  if (cat === 'B' && plat === 'AMAZON') {
    if (d6 >= 18 && active6 === 6 && cv6 <= 0.7 && active2 === 2) return 'T1';
    if (d6 >= 8 && active6 >= 5 && cv6 <= 0.9 && active2 === 2) return 'T2';
    if (d6 >= 3.5 && active6 >= 5 && cv6 <= 1.05 && active2 === 2) return 'T3';
    if (d6 >= 1.8 && active6 >= 5 && cv6 <= 0.95 && active2 === 2) {
      const t4a = resolveT4AIfEligible(input);
      if (t4a) return t4a;
    }
  }
  if (cat === 'B' && NON_AMAZON_PLATFORMS.has(plat)) {
    if (d6 >= 6 && active6 === 6 && active2 === 2 && cv6 <= 0.55) return 'T3P';
  }
  if (cat === 'C' && plat === 'AMAZON') {
    if (d6 >= 20 && active6 === 6 && cv6 <= 0.65 && active2 === 2) return 'T1';
    if (d6 >= 8 && active6 >= 5 && cv6 <= 0.85 && active2 === 2) return 'T2';
    if (d6 >= 4 && active6 >= 5 && cv6 <= 0.95 && active2 === 2) return 'T3';
    if (d6 >= 2.2 && active6 >= 5 && cv6 <= 0.9 && active2 === 2) {
      const t4a = resolveT4AIfEligible(input);
      if (t4a) return t4a;
    }
  }
  if (cat === 'C' && NON_AMAZON_PLATFORMS.has(plat)) {
    if (d6 >= 8 && active6 === 6 && active2 === 2 && cv6 <= 0.5) return 'T3P';
  }
  if (cat === 'D' && plat === 'AMAZON') {
    if (d6 >= 2 && active6 >= 5 && active2 === 2 && cv6 <= 0.7) {
      const t4a = resolveT4AIfEligible(input);
      if (t4a) return t4a;
    }
  }
  const stableFloor = resolveStableFloorTier(input);
  if (stableFloor) return stableFloor;
  const newProductFloor = resolveNewProductFloorTier(input);
  if (newProductFloor) return newProductFloor;
  const sparseRecent = resolveSparseRecentSaleFloorTier(input);
  if (sparseRecent) return sparseRecent;
  if (shouldBypassT99Classification(input, input.recent30DailyAvg)) {
    return 'T4B';
  }
  return 'T99';
}

export function computeAllCatV41BaseDaily(
  tier: AllCatV41Tier,
  m: Pick<AllCatV41Metrics, 'd2' | 'd3' | 'd6' | 'd12' | 'active12'>,
): number {
  switch (tier) {
    case 'T1':
      return 0.15 * m.d2 + 0.55 * m.d6 + 0.3 * m.d12;
    case 'T2':
      return 0.25 * m.d3 + 0.55 * m.d6 + 0.2 * m.d12;
    case 'T3':
      return 0.35 * m.d3 + 0.5 * m.d6 + 0.15 * m.d12;
    case 'T3P':
      return 0.45 * m.d3 + 0.45 * m.d6 + 0.1 * m.d12;
    case 'T4A':
      return 0.35 * m.d3 + 0.4 * m.d6 + 0.25 * m.d12;
    case 'T4B':
      if (isT4BShortHistory(m)) {
        return 0.45 * m.d3 + 0.4 * m.d6;
      }
      return 0.3 * m.d3 + 0.4 * m.d6 + 0.3 * m.d12;
    default:
      return 0;
  }
}

export function trendDecayFactor(trendRatio: number): number {
  const t = Number.isFinite(trendRatio) ? trendRatio : 1;
  if (t < 0.45) return 0.4;
  if (t < 0.65) return 0.62;
  if (t < 0.85) return 0.85;
  if (t > 2.0) return 1.12;
  if (t > 1.35) return 1.06;
  return 1.0;
}

/** growth 时用滚动 recent30/recent90 映射趋势衰减；T1/T2 日历走弱时不豁免 */
export function resolveEffectiveTrendDecay(input: {
  tier?: AllCatV41Tier;
  metrics: AllCatV41Metrics;
  recent30DailyAvg?: number | null;
  recent90DailyAvg?: number | null;
}): { factor: number; growthSignal: boolean; rollingRatio: number } {
  const recent30 = nonNegative(input.recent30DailyAvg);
  const recent90 = nonNegative(input.recent90DailyAvg);
  const rollingRatio = recent90 > 0 ? recent30 / recent90 : 1;
  const coreTier = input.tier === 'T1' || input.tier === 'T2';
  const midTier = input.tier === 'T3';
  const tailTier = input.tier === 'T4A' || input.tier === 'T4B';
  const calendarSoft = input.metrics.trendRatio < 0.85;
  const growthBlocked =
    tailTier ||
    (coreTier && calendarSoft) ||
    (midTier && calendarSoft && input.metrics.cv6 > 0.85);
  const growthSignal = rollingRatio >= V41_GROWTH_RECENT_RATIO_MIN && !growthBlocked;
  if (growthSignal) {
    return {
      factor: Math.max(1.0, trendDecayFactor(rollingRatio)),
      growthSignal: true,
      rollingRatio: roundDaily(rollingRatio),
    };
  }
  return {
    factor: trendDecayFactor(input.metrics.trendRatio),
    growthSignal: false,
    rollingRatio: roundDaily(rollingRatio),
  };
}

/** 4–12 月折减：T1/T2 首月仍保留轻度折减；Q2 目标月核心层叠加季节折减 */
export function resolveV41MonthFactor(
  forecastMonth: number,
  horizonIndex: number,
  tier?: AllCatV41Tier,
): number {
  if (forecastMonth < 4) return 1.0;
  const k = Math.max(0, Math.floor(horizonIndex));
  const coreTier = tier === 'T1' || tier === 'T2';
  const coreTier123 = tier === 'T1' || tier === 'T2' || tier === 'T3';
  let factor: number;
  if (k <= 0) factor = coreTier ? 0.98 : 1.0;
  else if (k === 1) factor = 0.98;
  else if (k === 2) factor = 0.96;
  else if (k === 3) factor = 0.92;
  else if (k === 4) factor = 0.9;
  else factor = 0.88;
  if (coreTier123 && V41_Q2_TARGET_MONTHS.has(forecastMonth)) {
    factor *= V41_Q2_SEASONAL_DISCOUNT;
    if (tier === 'T2' || tier === 'T3') {
      factor *= V41_Q2_MID_TIER_EXTRA_DISCOUNT;
    }
  }
  if ((tier === 'T4A' || tier === 'T4B') && forecastMonth >= 4) {
    factor *= V41_T4_TAIL_MONTH_DISCOUNT;
  }
  if (tier === 'T4A' && k >= V41_T4A_FLEX_DECAY_FROM_K) {
    factor *= V41_T4A_FLEX_DECAY_FACTOR;
  }
  if (tier === 'T4B' && k >= V41_T4B_FLEX_DECAY_FROM_K) {
    factor *= V41_T4B_FLEX_DECAY_FACTOR;
  }
  return factor;
}

export function tierConservativeFactor(tier: AllCatV41Tier, productCategory: string): number {
  if (productCategory === 'C' && tier === 'T2') return 0.85;
  if (productCategory === 'B' && tier === 'T1') return 0.82;
  switch (tier) {
    case 'T1':
      return 0.84;
    case 'T2':
      return 0.87;
    case 'T3':
      return 0.9;
    case 'T4A':
      return V41_T4A_CONSERVATIVE_FACTOR;
    case 'T4B':
      return V41_T4B_CONSERVATIVE_FACTOR;
    default:
      return 1.0;
  }
}

/** T1–T3 核心层上界偏差预算（只压高估） */
export function applyV41CoreUpperBiasCap(input: {
  tier: AllCatV41Tier;
  forecastDaily: number;
  anchorDaily: number;
  horizonIndex: number;
}): number {
  if (input.tier !== 'T1' && input.tier !== 'T2' && input.tier !== 'T3') {
    return input.forecastDaily;
  }
  const anchor = input.anchorDaily;
  if (anchor <= 0) return input.forecastDaily;
  const k = Math.max(0, Math.floor(input.horizonIndex));
  const isMid = input.tier === 'T2' || input.tier === 'T3';
  const budget = k <= 2
    ? (isMid ? V41_MID_NEAR_UPPER_BIAS : V41_CORE_NEAR_UPPER_BIAS)
    : isMid
      ? V41_MID_FLEX_UPPER_BIAS
      : V41_CORE_FLEX_UPPER_BIAS;
  const maxF = roundDaily(anchor * (1 + budget));
  return roundDaily(Math.min(input.forecastDaily, maxF));
}

/** T4A/T4B 上界：锚定 + recent 滚动 + d6 取最小，抑制边界层系统性高估 */
export function applyV41TailUpperBiasCap(input: {
  tier: AllCatV41Tier;
  forecastDaily: number;
  anchorDaily: number;
  recent90DailyAvg?: number | null;
  recent30DailyAvg?: number | null;
  d6: number;
}): number {
  if (input.tier !== 'T4A' && input.tier !== 'T4B') return input.forecastDaily;
  const recent90 = nonNegative(input.recent90DailyAvg);
  const recent30 = nonNegative(input.recent30DailyAvg);
  const caps: number[] = [];
  if (input.tier === 'T4A') {
    if (input.anchorDaily > 0) caps.push(input.anchorDaily * V41_T4A_ANCHOR_CAP);
    if (recent90 > 0) caps.push(recent90 * V41_T4A_RECENT90_CAP);
    if (recent30 > 0) caps.push(recent30 * V41_T4A_RECENT30_CAP);
    if (input.d6 > 0) caps.push(input.d6 * V41_T4A_D6_CAP);
  } else {
    if (input.anchorDaily > 0) caps.push(input.anchorDaily * V41_T4B_ANCHOR_CAP);
    if (recent90 > 0) caps.push(recent90 * V41_T4B_RECENT90_CAP);
    if (recent30 > 0) caps.push(recent30 * V41_T4B_RECENT30_CAP);
    if (input.d6 > 0) caps.push(input.d6 * V41_T4B_D6_CAP);
  }
  if (!caps.length) return input.forecastDaily;
  return roundDaily(Math.min(input.forecastDaily, ...caps));
}

/** 低量 SKU 上界：近端/ d6 偏低时禁止预测远高于近期动销 */
export function applyV41MicroSalesUpperCap(input: {
  tier: AllCatV41Tier;
  forecastDaily: number;
  d6: number;
  recent30DailyAvg?: number | null;
  recent90DailyAvg?: number | null;
}): number {
  if (input.tier === 'T1' || input.tier === 'T99') return input.forecastDaily;
  const recent30 = nonNegative(input.recent30DailyAvg);
  const recent90 = nonNegative(input.recent90DailyAvg);
  const micro = input.d6 < V41_MICRO_D6_MAX || recent90 < V41_MICRO_RECENT90_MAX;
  if (!micro) return input.forecastDaily;
  const caps: number[] = [];
  if (recent90 > 0) caps.push(recent90 * 1.1);
  if (recent30 > 0) caps.push(recent30 * 1.05);
  if (input.d6 > 0) caps.push(input.d6 * 1.05);
  if (!caps.length) return input.forecastDaily;
  return roundDaily(Math.min(input.forecastDaily, ...caps));
}

function tierFloorDaily(tier: AllCatV41Tier, d6: number): number {
  switch (tier) {
    case 'T1':
      return d6 * 0.55;
    case 'T2':
      return d6 * 0.5;
    case 'T3':
      return d6 * 0.4;
    case 'T3P':
      return d6 * 0.35;
    case 'T4A':
    case 'T4B':
      return 0;
    default:
      return 0;
  }
}

function tierCeilingDaily(
  tier: AllCatV41Tier,
  d6: number,
  d3: number,
  recent30DailyAvg?: number | null,
  recent90DailyAvg?: number | null,
): number {
  let ceiling: number;
  switch (tier) {
    case 'T1':
      ceiling = Math.max(d6 * 1.05, d3 * 1.02);
      break;
    case 'T2':
      ceiling = Math.max(d6 * 1.1, d3 * 1.06);
      break;
    case 'T3':
      ceiling = Math.max(d6 * 1.15, d3 * 1.1);
      break;
    case 'T3P':
      ceiling = Math.max(d6 * 1.1, d3 * 1.05);
      break;
    case 'T4A':
      ceiling = Math.max(d6 * 1.02, d3 * 1.01);
      break;
    case 'T4B':
      ceiling = Math.max(d6 * 1.02, d3 * 1.0);
      break;
    default:
      return 0;
  }
  if (tier === 'T4A') {
    const recent90 = nonNegative(recent90DailyAvg);
    if (recent90 > 0) {
      ceiling = Math.min(ceiling, recent90 * 1.0);
    }
  } else if (tier === 'T4B') {
    const recent90 = nonNegative(recent90DailyAvg);
    const recent30 = nonNegative(recent30DailyAvg);
    const recentAnchor = Math.max(
      recent90 > 0 ? recent90 * 1.0 : 0,
      recent30 > 0 ? recent30 * 0.85 : 0,
    );
    if (recentAnchor > 0) {
      ceiling = Math.min(ceiling, recentAnchor);
    }
  }
  return ceiling;
}

function resolveNearHorizonFloor(input: {
  tier: AllCatV41Tier;
  blendLevel: number;
  d6: number;
  recent90DailyAvg?: number | null;
  horizonIndex: number;
}): number {
  const k = Math.max(0, Math.floor(input.horizonIndex));
  if (k > 2) return 0;
  if (input.tier === 'T1' || input.tier === 'T2') {
    return input.blendLevel * V41_CORE_NEAR_BLEND_FLOOR;
  }
  if (input.tier === 'T3' || input.tier === 'T3P') {
    return Math.max(input.blendLevel * 0.82, input.d6 * 0.85);
  }
  if (input.tier === 'T4A') {
    const recent90 = nonNegative(input.recent90DailyAvg);
    return Math.max(
      input.blendLevel * V41_T4A_NEAR_BLEND_FLOOR,
      input.d6 * V41_T4A_NEAR_D6_FLOOR,
      recent90 > 0 ? recent90 * V41_T4A_NEAR_RECENT90_FLOOR : 0,
    );
  }
  if (input.tier === 'T4B') {
    const recent90 = nonNegative(input.recent90DailyAvg);
    return Math.max(
      input.blendLevel * V41_T4B_NEAR_BLEND_FLOOR,
      input.d6 * V41_T4B_NEAR_D6_FLOOR,
      recent90 > 0 ? recent90 * V41_T4B_NEAR_RECENT90_FLOOR : 0,
    );
  }
  const recent90 = nonNegative(input.recent90DailyAvg);
  return Math.max(
    input.blendLevel * V41_NEAR_HORIZON_BLEND_FLOOR,
    input.d6 * V41_NEAR_HORIZON_D6_FLOOR,
    recent90 > 0 ? recent90 * V41_NEAR_HORIZON_RECENT90_FLOOR : 0,
  );
}

function applyNearHorizonFloor(input: {
  tier: AllCatV41Tier;
  result: number;
  blendLevel: number;
  d6: number;
  recent90DailyAvg?: number | null;
  horizonIndex: number;
}): number {
  const k = Math.max(0, Math.floor(input.horizonIndex));
  if (k > 2) return input.result;
  if (input.tier === 'T4A' || input.tier === 'T4B') return input.result;

  if (input.tier === 'T1' || input.tier === 'T2') {
    const collapseThreshold = input.blendLevel * V41_CORE_COLLAPSE_THRESHOLD;
    if (input.result >= collapseThreshold) return input.result;
    const floor = input.blendLevel * V41_CORE_NEAR_BLEND_FLOOR;
    return Math.max(input.result, roundDaily(floor));
  }

  const floor = resolveNearHorizonFloor(input);
  if (floor <= 0) return input.result;
  return Math.max(input.result, roundDaily(floor));
}

function p10Multiplier(tier: AllCatV41Tier): number {
  switch (tier) {
    case 'T1':
      return 0.82;
    case 'T2':
      return 0.78;
    case 'T3':
    case 'T3P':
      return 0.7;
    default:
      return 0.6;
  }
}

function p90Multiplier(tier: AllCatV41Tier): number {
  switch (tier) {
    case 'T1':
      return 1.18;
    case 'T2':
      return 1.25;
    case 'T3':
    case 'T3P':
      return 1.35;
    default:
      return 1.5;
  }
}

export type AllCatV41BoundedDailyResult = {
  forecastDaily: number;
  trendDecay: number;
  monthFactor: number;
  conservativeFactor: number;
  growthSignal: boolean;
  rollingRatio: number;
  tierFloor: number;
  tierCeiling: number;
  nearHorizonFloor: number | null;
  ghostGated?: boolean;
};

function zeroBoundedDailyResult(ghostGated = false): AllCatV41BoundedDailyResult {
  return {
    forecastDaily: 0,
    trendDecay: 1,
    monthFactor: 1,
    conservativeFactor: 1,
    growthSignal: false,
    rollingRatio: 1,
    tierFloor: 0,
    tierCeiling: 0,
    nearHorizonFloor: null,
    ghostGated,
  };
}

export function computeAllCatV41BoundedDaily(input: {
  tier: AllCatV41Tier;
  baseDaily: number;
  productCategory: string;
  forecastMonth: number;
  horizonIndex?: number;
  metrics: AllCatV41Metrics;
  recent30DailyAvg?: number | null;
  recent90DailyAvg?: number | null;
}): AllCatV41BoundedDailyResult {
  if (input.tier === 'T99') {
    return zeroBoundedDailyResult(false);
  }
  if (
    (input.tier === 'T4A' || input.tier === 'T4B') &&
    isAllCatV41RecentSalesAbsent({
      recent30DailyAvg: input.recent30DailyAvg,
      recent90DailyAvg: input.recent90DailyAvg,
      metrics: input.metrics,
      tier: input.tier,
    })
  ) {
    return zeroBoundedDailyResult(true);
  }
  if (
    (input.tier === 'T3' || input.tier === 'T3P') &&
    input.metrics.d6 < V41_T3_MICRO_D6_MAX &&
    isAllCatV41RecentSalesAbsent({
      recent30DailyAvg: input.recent30DailyAvg,
      recent90DailyAvg: input.recent90DailyAvg,
      metrics: input.metrics,
      tier: 'T4A',
    })
  ) {
    return zeroBoundedDailyResult(true);
  }
  const { tier, baseDaily, productCategory, forecastMonth, metrics } = input;
  const horizonIndex = input.horizonIndex ?? 0;
  const trend = resolveEffectiveTrendDecay({
    tier,
    metrics,
    recent30DailyAvg: input.recent30DailyAvg,
    recent90DailyAvg: input.recent90DailyAvg,
  });
  const monthFactor = resolveV41MonthFactor(forecastMonth, horizonIndex, tier);
  const conservativeFactor = tierConservativeFactor(tier, productCategory);
  const adjusted = baseDaily * trend.factor * monthFactor * conservativeFactor;
  const floor = tierFloorDaily(tier, metrics.d6);
  const ceiling = tierCeilingDaily(
    tier,
    metrics.d6,
    metrics.d3,
    input.recent30DailyAvg,
    input.recent90DailyAvg,
  );
  const clamped = Math.min(Math.max(adjusted, floor), ceiling);
  const nearHorizonFloor =
    horizonIndex <= 2
      ? resolveNearHorizonFloor({
          tier,
          blendLevel: baseDaily,
          d6: metrics.d6,
          recent90DailyAvg: input.recent90DailyAvg,
          horizonIndex,
        })
      : 0;
  let forecastDaily = roundDaily(
    applyNearHorizonFloor({
      tier,
      result: clamped,
      blendLevel: baseDaily,
      d6: metrics.d6,
      recent90DailyAvg: input.recent90DailyAvg,
      horizonIndex,
    }),
  );
  forecastDaily = applyV41CoreUpperBiasCap({
    tier,
    forecastDaily,
    anchorDaily: baseDaily,
    horizonIndex,
  });
  forecastDaily = applyV41TailUpperBiasCap({
    tier,
    forecastDaily,
    anchorDaily: baseDaily,
    recent90DailyAvg: input.recent90DailyAvg,
    recent30DailyAvg: input.recent30DailyAvg,
    d6: metrics.d6,
  });
  forecastDaily = applyV41MicroSalesUpperCap({
    tier,
    forecastDaily,
    d6: metrics.d6,
    recent30DailyAvg: input.recent30DailyAvg,
    recent90DailyAvg: input.recent90DailyAvg,
  });
  return {
    forecastDaily,
    trendDecay: trend.factor,
    monthFactor,
    conservativeFactor,
    growthSignal: trend.growthSignal,
    rollingRatio: trend.rollingRatio,
    tierFloor: roundDaily(floor),
    tierCeiling: roundDaily(ceiling),
    nearHorizonFloor: nearHorizonFloor > 0 ? roundDaily(nearHorizonFloor) : null,
  };
}

/** 向前批量：用截止 historyCapEnd 的 12 月序列做季节朴素，得到逐月结构水平 */
export function computeForwardSeasonalDaily(input: {
  monthlyRows: Array<{ saleYear: number; month: number; qtySold: number }>;
  historyCapEnd: Date;
  horizonIndex: number;
  forecastYear: number;
  forecastMonth: number;
}): number {
  const monthlyQty = buildLast12MonthlyQty(input.monthlyRows, input.historyCapEnd);
  if (monthlyQty.every((q) => q <= 0)) return 0;
  const seasonalQty = seasonalNaiveMonthlyQty(monthlyQty, input.horizonIndex);
  return monthlyQtyToDailyAvg(seasonalQty, input.forecastYear, input.forecastMonth);
}

/** 锚定水平 + 季节水平按 horizon 混合（近端偏锚定，远端偏季节） */
export function blendForwardForecastLevel(
  anchorDaily: number,
  seasonalDaily: number,
  horizonIndex: number,
): number {
  if (seasonalDaily <= 0) return anchorDaily;
  if (anchorDaily <= 0) return seasonalDaily;
  const wSeason = Math.min(0.62, 0.28 + horizonIndex * 0.07);
  return roundDaily(anchorDaily * (1 - wSeason) + seasonalDaily * wSeason);
}

function tierAlgorithm(tier: AllCatV41Tier): string {
  switch (tier) {
    case 'T1':
      return 'core_stable_high_volume_conservative_blend';
    case 'T2':
      return 'core_high_volume_conservative_blend';
    case 'T3':
      return 'mid_volume_blend';
    case 'T3P':
      return 'non_amazon_premium_stable_blend';
    case 'T4A':
      return 'amazon_boundary_blend';
    case 'T4B':
      return 'stable_continuity_floor_blend';
    default:
      return 'no_forecast';
  }
}

function tierAlgorithmForTier(tier: AllCatV41Tier, metrics: AllCatV41Metrics): string {
  if (tier === 'T4B' && isT4BShortHistory(metrics)) {
    return 'new_product_short_history_floor_blend';
  }
  return tierAlgorithm(tier);
}

function tierFormula(tier: AllCatV41Tier, metrics?: Pick<AllCatV41Metrics, 'active12'>): string {
  switch (tier) {
    case 'T1':
      return '0.15*d2 + 0.55*d6 + 0.30*d12';
    case 'T2':
      return '0.25*d3 + 0.55*d6 + 0.20*d12';
    case 'T3':
      return '0.35*d3 + 0.50*d6 + 0.15*d12';
    case 'T3P':
      return '0.45*d3 + 0.45*d6 + 0.10*d12';
    case 'T4A':
      return '0.50*d3 + 0.45*d6 + 0.05*d12';
    case 'T4B':
      if (metrics && isT4BShortHistory(metrics)) {
        return '0.55*d3 + 0.45*d6';
      }
      return '0.35*d3 + 0.45*d6 + 0.20*d12';
    default:
      return 'no_forecast';
  }
}

function tierKpiTarget(tier: AllCatV41Tier): string {
  switch (tier) {
    case 'T1':
      return 'KPI_STRICT_CORE_WMAPE_LE_20_BIAS_PM10';
    case 'T2':
      return 'KPI_CORE_WMAPE_LE_25_BIAS_PM10';
    case 'T3':
    case 'T3P':
      return 'KPI_MID_WMAPE_LE_35_BIAS_PM15';
    case 'T4A':
      return 'KPI_BOUNDARY_WMAPE_LE_40_BIAS_PM20';
    case 'T4B':
      return 'KPI_FLOOR_WMAPE_LE_50_BIAS_PM25';
    default:
      return 'NO_FORECAST_T99_EXCEPTION';
  }
}

function tierConfidence(tier: AllCatV41Tier): 'high' | 'medium' | 'low' {
  if (tier === 'T1') return 'high';
  if (tier === 'T2' || tier === 'T3' || tier === 'T3P') return 'medium';
  return 'low';
}

export function buildAllCatV41HorizonFactors(input: {
  tier: AllCatV41Tier;
  productCategory: string;
  metrics: AllCatV41Metrics;
  historyCutoff: string;
}): Record<string, unknown> {
  const { tier, productCategory, metrics, historyCutoff } = input;
  return {
    tier,
    tierSystem: ALLCAT_V41_TIER_SYSTEM,
    productCategory,
    kpiTarget: tierKpiTarget(tier),
    statsScope: tier === 'T1' || tier === 'T2' ? 'core_kpi' : 'main_kpi',
    excludedFromMainStats: tier === 'T99' || tier === 'T4B',
    algorithm: tierAlgorithmForTier(tier, metrics),
    formula: tierFormula(tier, metrics),
    q1: roundDaily(metrics.q1),
    q3: roundDaily(metrics.q3),
    q6: roundDaily(metrics.q6),
    q12: roundDaily(metrics.q12),
    d3: roundDaily(metrics.d3),
    d6: roundDaily(metrics.d6),
    d12: roundDaily(metrics.d12),
    active2: metrics.active2,
    active6: metrics.active6,
    active12: metrics.active12,
    cv6: roundDaily(metrics.cv6),
    trendRatio: roundDaily(metrics.trendRatio),
    walkForward: true,
    historyCutoff,
  };
}

export function computeAllCatV41ForecastForMonth(input: {
  productCategory: string;
  platform: string;
  forecastYear: number;
  forecastMonth: number;
  horizonIndex: number;
  monthlyRows: Array<{ saleYear: number; month: number; qtySold: number }>;
  /** 日销量折算的近 30 天日均；用于抑制误判 T99、growth 信号与近端上下限 */
  recent30DailyAvg?: number | null;
  /** 滚动近 90 天日均；用于 T4 上限与近端地板 */
  recent90DailyAvg?: number | null;
  /**
   * 批量向前预测时传入 effectiveRecentWindowEnd（上月末）。
   * 特征截止于此，避免未完成自然月（零销量）进入走步窗口导致 T99。
   * 回测场景勿传，以保持 strict walk-forward。
   */
  historyCapEnd?: Date;
}): AllCatV41ForecastResult {
  const tierMetrics = computeWalkForwardMetrics(
    input.monthlyRows,
    input.forecastYear,
    input.forecastMonth,
    input.historyCapEnd,
  );
  const productCategory = resolveAllCatProductCategory(input.productCategory);
  const platform = input.platform.trim().toUpperCase() || 'UNKNOWN';
  const tier = resolveAllCatV41Tier({
    productCategory,
    platform,
    recent30DailyAvg: input.recent30DailyAvg,
    ...tierMetrics,
  });
  const anchorDaily = computeAllCatV41BaseDaily(tier, tierMetrics);

  let levelDaily = anchorDaily;
  let seasonalDaily: number | undefined;
  if (input.historyCapEnd) {
    seasonalDaily = computeForwardSeasonalDaily({
      monthlyRows: input.monthlyRows,
      historyCapEnd: input.historyCapEnd,
      horizonIndex: input.horizonIndex,
      forecastYear: input.forecastYear,
      forecastMonth: input.forecastMonth,
    });
    levelDaily = blendForwardForecastLevel(anchorDaily, seasonalDaily, input.horizonIndex);
  }

  const bounded = computeAllCatV41BoundedDaily({
    tier,
    baseDaily: levelDaily,
    productCategory,
    forecastMonth: input.forecastMonth,
    horizonIndex: input.horizonIndex,
    metrics: tierMetrics,
    recent30DailyAvg: input.recent30DailyAvg,
    recent90DailyAvg: input.recent90DailyAvg,
  });
  const forecastDaily = bounded.forecastDaily;
  const effectiveTarget = resolveWalkForwardMetricsTarget(
    input.forecastYear,
    input.forecastMonth,
    input.historyCapEnd,
  );
  const targetMonth = monthStartUtc(effectiveTarget.year, effectiveTarget.month);
  const historyCutoff = input.historyCapEnd
    ? input.historyCapEnd.toISOString().slice(0, 10)
    : new Date(targetMonth.getTime() - 86400000).toISOString().slice(0, 10);

  const horizonFactors = buildAllCatV41HorizonFactors({
    tier,
    productCategory,
    metrics: tierMetrics,
    historyCutoff,
  });
  if (input.recent30DailyAvg != null && input.recent30DailyAvg > 0) {
    horizonFactors.recent30DailyAvg = roundDaily(input.recent30DailyAvg);
  }
  if (input.recent90DailyAvg != null && input.recent90DailyAvg > 0) {
    horizonFactors.recent90DailyAvg = roundDaily(input.recent90DailyAvg);
  }
  horizonFactors.effectiveTrendDecay = bounded.trendDecay;
  horizonFactors.monthFactor = bounded.monthFactor;
  horizonFactors.conservativeFactor = bounded.conservativeFactor;
  horizonFactors.growthSignal = bounded.growthSignal;
  horizonFactors.rollingRatio = bounded.rollingRatio;
  if (bounded.nearHorizonFloor != null) {
    horizonFactors.nearHorizonFloor = bounded.nearHorizonFloor;
  }
  horizonFactors.tierCeiling = bounded.tierCeiling;
  if (bounded.ghostGated) {
    horizonFactors.zeroSalesGhostGate = true;
    horizonFactors.model = 'zero_sales_ghost_gate';
  }

  if (input.historyCapEnd) {
    horizonFactors.forwardHistoryCap = true;
    horizonFactors.metricsTargetMonth = monthKey(effectiveTarget.year, effectiveTarget.month);
    horizonFactors.forecastTargetMonth = monthKey(input.forecastYear, input.forecastMonth);
    horizonFactors.anchorDaily = roundDaily(anchorDaily);
    horizonFactors.seasonalDaily = seasonalDaily != null ? roundDaily(seasonalDaily) : undefined;
    horizonFactors.levelDaily = roundDaily(levelDaily);
  }

  return {
    tier,
    baseDaily: roundDaily(levelDaily),
    forecastDaily,
    confidenceLevel: tierConfidence(tier),
    horizonBand: horizonBandFromIndex(input.horizonIndex),
    kpiTarget: tierKpiTarget(tier),
    algorithm: tierAlgorithmForTier(tier, tierMetrics),
    formula: tierFormula(tier, tierMetrics),
    metrics: tierMetrics,
    horizonFactors,
    forecastDailyP10: roundDaily(forecastDaily * p10Multiplier(tier)),
    forecastDailyP90: roundDaily(forecastDaily * p90Multiplier(tier)),
  };
}

function formatAllCatV41PlatformLabel(platform: string): string {
  const normalized = platform.trim().toUpperCase() || 'UNKNOWN';
  return normalized === 'UNKNOWN' ? '未知' : platform.trim();
}

export function buildT99ReviewMessage(input: {
  skuCode: string;
  productCategory: string;
  platform: string;
  metrics: AllCatV41Metrics;
}): string {
  const platformLabel = formatAllCatV41PlatformLabel(input.platform);
  return (
    `T99 系统不预测（全品类 V4.1）：${input.skuCode}，商品分类 ${input.productCategory}，平台 ${platformLabel}；` +
    `波动较大 / 销量连续性不足 / 核心渠道信号不足；` +
    `近6月变异系数 cv6=${roundDaily(input.metrics.cv6)}，趋势比 trend=${roundDaily(input.metrics.trendRatio)}`
  );
}

/**
 * 向前批量预测时，将走步特征截止在 historyCapEnd（上月末），
 * 使 horizonIndex>=1 与首月使用同一分层特征，不回填预测值。
 */
export function resolveWalkForwardMetricsTarget(
  targetYear: number,
  targetMonth: number,
  historyCapEnd?: Date,
): { year: number; month: number } {
  if (!historyCapEnd) {
    return { year: targetYear, month: targetMonth };
  }
  const capYear = historyCapEnd.getUTCFullYear();
  const capMonth = historyCapEnd.getUTCMonth() + 1;
  const firstForecastYear = capMonth === 12 ? capYear + 1 : capYear;
  const firstForecastMonth = capMonth === 12 ? 1 : capMonth + 1;
  const firstForecastStart = monthStartUtc(firstForecastYear, firstForecastMonth);
  const targetStart = monthStartUtc(targetYear, targetMonth);
  if (targetStart.getTime() <= firstForecastStart.getTime()) {
    return { year: targetYear, month: targetMonth };
  }
  return { year: firstForecastYear, month: firstForecastMonth };
}

/** 走步特征：仅使用 targetMonth 之前的历史（与 SQL target_month 对齐） */
export function computeWalkForwardMetrics(
  monthlyRows: Array<{ saleYear: number; month: number; qtySold: number }>,
  targetYear: number,
  targetMonth: number,
  historyCapEnd?: Date,
): AllCatV41Metrics {
  const qtyByMonth = new Map<string, number>();
  for (const row of monthlyRows) {
    const key = monthKey(row.saleYear, row.month);
    qtyByMonth.set(key, (qtyByMonth.get(key) ?? 0) + row.qtySold);
  }

  const effective = resolveWalkForwardMetricsTarget(targetYear, targetMonth, historyCapEnd);
  const target = monthStartUtc(effective.year, effective.month);

  const sumInMonthsBefore = (monthCount: number): number => {
    let sum = 0;
    for (let i = 1; i <= monthCount; i++) {
      const d = monthStartUtc(target.getUTCFullYear(), target.getUTCMonth() + 1 - i);
      sum += qtyByMonth.get(monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1)) ?? 0;
    }
    return sum;
  };

  const countActiveInMonthsBefore = (monthCount: number): number => {
    let count = 0;
    for (let i = 1; i <= monthCount; i++) {
      const d = monthStartUtc(target.getUTCFullYear(), target.getUTCMonth() + 1 - i);
      const qty = qtyByMonth.get(monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1)) ?? 0;
      if (qty > 0) count += 1;
    }
    return count;
  };

  const positiveQtysLast6 = (): number[] => {
    const vals: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const d = monthStartUtc(target.getUTCFullYear(), target.getUTCMonth() + 1 - i);
      const qty = qtyByMonth.get(monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1)) ?? 0;
      if (qty > 0) vals.push(qty);
    }
    return vals;
  };

  const q1 = sumInMonthsBefore(1);
  const q2 = sumInMonthsBefore(2);
  const q3 = sumInMonthsBefore(3);
  const q6 = sumInMonthsBefore(6);
  const q12 = sumInMonthsBefore(12);

  const pos6 = positiveQtysLast6();
  const avgPos6 = pos6.length > 0 ? pos6.reduce((a, b) => a + b, 0) / pos6.length : 0;
  let cv6 = 9;
  if (pos6.length >= 2 && avgPos6 > 0) {
    const variance =
      pos6.reduce((sum, v) => sum + (v - avgPos6) ** 2, 0) / (pos6.length - 1);
    cv6 = Math.sqrt(variance) / avgPos6;
  } else if (pos6.length === 1 && avgPos6 > 0) {
    cv6 = 0;
  }

  const trendDenom = q6 - q3;
  const trendRatio = trendDenom > 0 ? q3 / trendDenom : 1;

  return {
    q1,
    q3,
    q6,
    q12,
    d2: q2 / 60,
    d3: q3 / 91,
    d6: q6 / 182,
    d12: q12 / 365,
    active2: countActiveInMonthsBefore(2),
    active6: countActiveInMonthsBefore(6),
    active12: countActiveInMonthsBefore(12),
    cv6,
    trendRatio,
  };
}
