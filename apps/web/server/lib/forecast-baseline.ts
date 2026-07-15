import type { ProfileClass, ProfileSegment } from './forecast-profile-class.js';
import type { VolumeTier } from './forecast-eligibility.js';
import { resolveResidualSpreadRatio } from './forecast-residual-bucket.js';
import type { ACoreAlgoConfig } from './forecast-profile-config.js';
import { DEFAULT_ACORE_ALGO_CONFIG } from './forecast-profile-config.js';
import { MAX_FORECAST_MONTH_COUNT } from './forecast-limits.js';

export type SalesLifecycle =
  | 'mature'
  | 'growth'
  | 'decline'
  | 'new'
  | 'intermittent'
  | 'stockout_suspected';

export type ForecastHorizonMonth = {
  forecastYear: number;
  month: number;
};

export type SalesLifecycleInput = {
  ageDays: number;
  salesDayRatio90: number;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  maxZeroRunDays: number;
};

export type BaselineDailyAvgInput = {
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  lastYearSameMonthDailyAvg?: number;
  categoryReferenceDailyAvg?: number;
  lifecycle?: SalesLifecycle;
};

export type LifecycleBaselineWeights = {
  w90: number;
  w30: number;
  wLy: number;
  wCat: number;
};

export type ClipSeasonalityResult = {
  factor: number;
  wasClipped: boolean;
};

export type TrendBoundsResult = {
  factor: number;
  applied: boolean;
};

/** 跨境预测默认读取近 12 个月日销量，用于同比与季节校准 */
export const DEFAULT_SALES_HISTORY_LOOKBACK_DAYS = 365;

export type MonthlyForecastDailyAvgResult = {
  baselineDailyAvg: number;
  forecastDailyAvg: number;
  categoryTrendApplied: boolean;
  combinedTrendFactor: number;
  skuTrendFactor: number;
  seasonalityWasClipped: boolean;
  horizonFactors: HorizonFactorSnapshot;
};

export type HorizonFactorSnapshot = {
  nearLevel: number;
  structuralLevel: number;
  yoyMonthLevel: number;
  yoyAnchorLevel: number;
  growthFactor: number;
  wNear: number;
  wYoy: number;
  horizonMonthIndex: number;
};

export function parseHorizonFactors(raw: unknown): HorizonFactorSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const num = (key: string) => {
    const parsed = Number(value[key]);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const nearLevel = num('nearLevel');
  const structuralLevel = num('structuralLevel');
  const yoyMonthLevel = num('yoyMonthLevel');
  const yoyAnchorLevel = num('yoyAnchorLevel');
  const growthFactor = num('growthFactor');
  const wNear = num('wNear');
  const wYoy = num('wYoy');
  const horizonMonthIndex = num('horizonMonthIndex');
  if (
    nearLevel == null ||
    structuralLevel == null ||
    yoyMonthLevel == null ||
    yoyAnchorLevel == null ||
    growthFactor == null ||
    wNear == null ||
    wYoy == null ||
    horizonMonthIndex == null
  ) {
    return null;
  }
  return {
    nearLevel,
    structuralLevel,
    yoyMonthLevel,
    yoyAnchorLevel,
    growthFactor,
    wNear,
    wYoy,
    horizonMonthIndex,
  };
}

export function computeLifecycleBaselineWeights(lifecycle: SalesLifecycle = 'mature'): LifecycleBaselineWeights {
  switch (lifecycle) {
    case 'growth':
      return { w90: 0.35, w30: 0.5, wLy: 0.15, wCat: 0 };
    case 'decline':
      return { w90: 0.55, w30: 0.25, wLy: 0.2, wCat: 0 };
    case 'new':
      return { w90: 0, w30: 0.7, wLy: 0, wCat: 0.3 };
    case 'intermittent':
      return { w90: 0.8, w30: 0.2, wLy: 0, wCat: 0 };
    case 'stockout_suspected':
    case 'mature':
    default:
      return { w90: 0.5, w30: 0.3, wLy: 0.2, wCat: 0 };
  }
}

/** SKU 级短期趋势系数（recent30 / recent90），按生命周期限制幅度 */
export function computeSkuTrendFactor(
  recent30DailyAvg: number,
  recent90DailyAvg: number,
  lifecycle: SalesLifecycle = 'mature',
): number {
  if (recent90DailyAvg <= 0) return 1;
  const raw = recent30DailyAvg / recent90DailyAvg;

  switch (lifecycle) {
    case 'growth':
      return roundDaily(Math.min(1.3, Math.max(1, raw)));
    case 'decline':
      return roundDaily(Math.max(0.7, Math.min(1, raw)));
    case 'mature':
    case 'stockout_suspected':
      return roundDaily(Math.max(0.85, Math.min(1.15, raw)));
    default:
      return roundDaily(Math.max(0.7, Math.min(1.3, raw)));
  }
}

/** 趋势系数随预测月份衰减，避免 12 个月线性外推 */
export function applyHorizonTrendDecay(
  skuTrendFactor: number,
  monthIndex: number,
  halfLifeMonths = 6,
): number {
  if (!Number.isFinite(skuTrendFactor) || skuTrendFactor <= 0 || monthIndex <= 0) {
    return skuTrendFactor > 0 ? skuTrendFactor : 1;
  }
  const decay = Math.max(0, 1 - monthIndex / halfLifeMonths);
  if (decay <= 0) return 1;
  return roundDaily(skuTrendFactor ** decay);
}

export const SEASONALITY_CLIP_MIN = 0.85;
export const SEASONALITY_CLIP_MAX = 1.15;
export const SEASONALITY_WINDOW_MONTHS = 6;
export const SEASONALITY_TREND_RECENT_MONTHS = 3;
export const SEASONALITY_MIN_POSITIVE_MONTHS = 2;
export const SEASONALITY_MIN_MONTH_QTY = 100;

export function clipCombinedSeasonality(raw: number): ClipSeasonalityResult {
  if (!Number.isFinite(raw) || raw <= 0) {
    return { factor: 1, wasClipped: false };
  }
  const clipped = Math.max(SEASONALITY_CLIP_MIN, Math.min(SEASONALITY_CLIP_MAX, raw));
  return { factor: roundDaily(clipped), wasClipped: clipped !== raw };
}

/** 保守品类系数：超出 [0.85,1.15] 时不应用（返回 1） */
export function resolveConservativeCategoryFactor(raw: number): ClipSeasonalityResult & { applied: boolean } {
  if (!Number.isFinite(raw) || raw <= 0) {
    return { factor: 1, wasClipped: false, applied: false };
  }
  if (raw < SEASONALITY_CLIP_MIN || raw > SEASONALITY_CLIP_MAX) {
    return { factor: 1, wasClipped: true, applied: false };
  }
  return { factor: roundDaily(raw), wasClipped: false, applied: true };
}

export function buildMonthlyForecastHorizon(
  today = new Date(),
  monthCount = 12,
): ForecastHorizonMonth[] {
  const count = Math.min(
    MAX_FORECAST_MONTH_COUNT,
    Math.max(0, Math.floor(monthCount)),
  );
  // 当月视为未来月：地平线从当前自然月起算（非下月）；近期窗口仍截止到上月末。
  const startMonthIndex = today.getUTCMonth();

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(today.getUTCFullYear(), startMonthIndex + index, 1));

    return {
      forecastYear: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
    };
  });
}

export function classifySalesLifecycle(input: SalesLifecycleInput): SalesLifecycle {
  if (
    input.maxZeroRunDays >= 7 &&
    input.recent90DailyAvg > 0 &&
    input.ageDays >= 90 &&
    input.salesDayRatio90 >= 0.1
  ) {
    return 'stockout_suspected';
  }

  if (input.ageDays < 90) {
    return 'new';
  }

  if (input.salesDayRatio90 < 0.1) {
    return 'intermittent';
  }

  if (input.recent90DailyAvg > 0) {
    if (input.recent30DailyAvg >= input.recent90DailyAvg * 1.3) {
      return 'growth';
    }

    if (input.recent30DailyAvg <= input.recent90DailyAvg * 0.7) {
      return 'decline';
    }
  }

  return 'mature';
}

export function computeBaselineDailyAvg(input: BaselineDailyAvgInput): number {
  const recent30 = nonNegative(input.recent30DailyAvg);
  const recent90 = nonNegative(input.recent90DailyAvg);
  const lastYear = nonNegative(input.lastYearSameMonthDailyAvg);
  const category = nonNegative(input.categoryReferenceDailyAvg);
  const lifecycle = input.lifecycle ?? 'mature';
  const weights = computeLifecycleBaselineWeights(lifecycle);

  const useCategory =
    category > 0 &&
    (lifecycle === 'new' || (weights.wCat > 0 && recent90 <= 0));

  if (useCategory) {
    if (recent30 > 0) {
      return roundDaily(recent30 * (1 - weights.wCat) + category * weights.wCat);
    }
    return roundDaily(category);
  }

  if (recent90 > 0 && lastYear > 0 && weights.wLy > 0) {
    return roundDaily(recent90 * weights.w90 + recent30 * weights.w30 + lastYear * weights.wLy);
  }

  if (recent90 > 0) {
    if (lifecycle === 'mature' || lifecycle === 'stockout_suspected') {
      return roundDaily(recent90 * 0.65 + recent30 * 0.35);
    }

    const w90 = weights.w90 + weights.wLy;
    const w30 = weights.w30;
    const sum = w90 + w30;
    return roundDaily((recent90 * w90 + recent30 * w30) / (sum || 1));
  }

  if (category > 0) {
    return roundDaily(recent30 * 0.7 + category * 0.3);
  }

  return roundDaily(recent30);
}

/** 仅含近 30/90 天的短期水平，不含去年同月——用于近端预测月 */
export function computeNearTermLevel(input: {
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  categoryReferenceDailyAvg?: number;
  lifecycle?: SalesLifecycle;
}): number {
  const lifecycle = input.lifecycle ?? 'mature';
  const recent30 = nonNegative(input.recent30DailyAvg);
  const recent90 = nonNegative(input.recent90DailyAvg);
  const category = nonNegative(input.categoryReferenceDailyAvg);

  if (lifecycle === 'new' && category > 0) {
    return roundDaily(recent30 > 0 ? recent30 * 0.7 + category * 0.3 : category);
  }

  if (recent90 > 0) {
    if (lifecycle === 'mature' || lifecycle === 'stockout_suspected') {
      return roundDaily(recent90 * 0.65 + recent30 * 0.35);
    }
    const weights = computeLifecycleBaselineWeights(lifecycle);
    const w90 = weights.w90 + weights.wLy;
    const w30 = weights.w30;
    const sum = w90 + w30 || 1;
    return roundDaily((recent90 * w90 + recent30 * w30) / sum);
  }

  if (category > 0) {
    return roundDaily(recent30 > 0 ? recent30 * 0.7 + category * 0.3 : category);
  }

  return roundDaily(recent30);
}

/**
 * 预测距离越远，越降低「当前近30/90天」权重，提高「目标月同比结构」权重。
 * k=0 当月仍保留较多近期信号；k≥6 以同比+增长为主（90%）。
 */
export function computeHorizonBlendWeights(
  horizonMonthIndex: number,
  options?: { decliningNearBias?: boolean },
): { wNear: number; wYoy: number } {
  const k = Math.max(0, Math.floor(horizonMonthIndex));
  if (k === 0 && options?.decliningNearBias) {
    return { wNear: 0.5, wYoy: 0.5 };
  }
  if (k === 0) return { wNear: 0.65, wYoy: 0.35 };
  if (k === 1) return { wNear: 0.5, wYoy: 0.5 };
  if (k === 2) return { wNear: 0.35, wYoy: 0.65 };
  if (k <= 5) {
    const wNear = Math.max(0.15, 0.35 - (k - 2) * 0.07);
    return { wNear, wYoy: 1 - wNear };
  }
  return { wNear: 0.1, wYoy: 0.9 };
}

/** decline 场景近端 1–3 月：适度抬高近月锚定，平衡总量低估与 A:core 精度 */
export function computeDeclinePrecisionBlendWeights(horizonMonthIndex: number): {
  wNear: number;
  wYoy: number;
} {
  const k = Math.max(0, Math.floor(horizonMonthIndex));
  if (k === 0) return { wNear: 0.55, wYoy: 0.45 };
  if (k === 1) return { wNear: 0.5, wYoy: 0.5 };
  if (k === 2) return { wNear: 0.45, wYoy: 0.55 };
  return computeHorizonBlendWeights(k, { decliningNearBias: true });
}

export function computeYoYGrowthFactor(
  nearLevel: number,
  yoyAnchorLevel: number,
  options?: { maxFactor?: number },
): number {
  if (yoyAnchorLevel <= 0 || nearLevel <= 0) return 1;
  const maxFactor = options?.maxFactor ?? 1.3;
  return roundDaily(Math.max(0.7, Math.min(maxFactor, nearLevel / yoyAnchorLevel)));
}

export function isDecliningSalesSignal(
  lifecycle: SalesLifecycle,
  recent30DailyAvg: number,
  recent90DailyAvg: number,
): boolean {
  return (
    lifecycle === 'decline' ||
    (recent90DailyAvg > 0 && recent30DailyAvg < recent90DailyAvg * 0.8)
  );
}

export function shrinkSeasonalityForDecline(
  seasonality: number,
  trend: number,
  declining: boolean,
): { seasonality: number; trend: number } {
  if (!declining) return { seasonality, trend };
  return {
    seasonality: 1 + (seasonality - 1) * 0.5,
    trend: Math.min(trend, 1),
  };
}

export function computeNewProductRampDecay(horizonMonthIndex: number): number {
  const k = Math.max(0, Math.floor(horizonMonthIndex));
  return Math.min(1, 0.5 + k * 0.15);
}

/** 业务偏差预算：k=0~2 月 |bias|≤15%，k=3~5 月 ≤25%（相对近期锚定销量） */
export const HORIZON_BIAS_BUDGET_NEAR = 0.15;
export const HORIZON_BIAS_BUDGET_FAR = 0.25;

export function getHorizonBiasBudget(horizonMonthIndex: number): number {
  return horizonMonthIndex < 3 ? HORIZON_BIAS_BUDGET_NEAR : HORIZON_BIAS_BUDGET_FAR;
}

/**
 * 偏差预算锚定：在 YoY 增长因子抬高近期水平、或 mature 平盘时收缩锚点；远月再按预算衰减。
 * 假设实际销量接近锚点，则 forecast ≤ anchor/(1−budget) 可控制高估侧 |bias|。
 */
export function computeBiasBudgetAnchor(input: {
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  horizonMonthIndex: number;
  lifecycle: SalesLifecycle;
  growthFactor?: number;
  profileSegment?: ProfileSegment;
}): number {
  const recent30 = nonNegative(input.recent30DailyAvg);
  const recent90 = nonNegative(input.recent90DailyAvg);
  const base = recent90 > 0 ? Math.min(recent30, recent90) : recent30;
  if (base <= 0) return 0;

  const k = Math.max(0, Math.floor(input.horizonMonthIndex));

  if (input.profileSegment === 'A:core') {
    const recent30 = nonNegative(input.recent30DailyAvg);
    const recent90 = nonNegative(input.recent90DailyAvg);
    const base = recent90 > 0 ? Math.min(recent30, recent90) : recent30;
    if (base <= 0) return 0;
    let anchor = base;
    if (k < 3) {
      const nearFactors = [0.94, 0.95, 0.96];
      anchor = roundDaily(base * (nearFactors[k] ?? 0.96));
    } else {
      const budget = getHorizonBiasBudget(k);
      const farDecay = (1 - budget) ** (1 + (k - 3) * 0.2);
      anchor = roundDaily(base * farDecay);
    }
    return anchor;
  }

  let anchor = base;
  const growthFactor = input.growthFactor ?? 1;
  if (growthFactor > 1) {
    anchor = roundDaily(anchor / growthFactor);
  }

  const flatOrSoft =
    (input.lifecycle === 'mature' || input.lifecycle === 'decline') &&
    recent90 > 0 &&
    recent30 <= recent90 * 1.05;
  if (flatOrSoft) {
    anchor = roundDaily(anchor * 0.85);
  }

  const budget = getHorizonBiasBudget(input.horizonMonthIndex);
  if (k < 3) {
    const nearFactors = [0.74, 0.77, 0.78];
    anchor = roundDaily(anchor * (nearFactors[k] ?? 0.8));
  } else {
    const farDecay = (1 - budget) ** (1 + (k - 3) * 0.3);
    anchor = roundDaily(anchor * farDecay);
  }

  return anchor;
}

/**
 * 成熟/下滑/增长 SKU：将预测封顶在偏差预算内，抑制季节因子与 YoY 增长叠加导致的高估。
 */
export function applyHorizonBiasBudgetCap(input: {
  forecastDailyAvg: number;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  horizonMonthIndex: number;
  lifecycle: SalesLifecycle;
  growthFactor?: number;
  profileSegment?: ProfileSegment;
}): number {
  if (
    input.lifecycle !== 'mature' &&
    input.lifecycle !== 'decline' &&
    input.lifecycle !== 'growth'
  ) {
    return input.forecastDailyAvg;
  }

  const anchor = computeBiasBudgetAnchor({
    recent30DailyAvg: input.recent30DailyAvg,
    recent90DailyAvg: input.recent90DailyAvg,
    horizonMonthIndex: input.horizonMonthIndex,
    lifecycle: input.lifecycle,
    growthFactor: input.growthFactor,
    profileSegment: input.profileSegment,
  });
  if (anchor <= 0) return input.forecastDailyAvg;

  const budget = getHorizonBiasBudget(input.horizonMonthIndex);
  const maxForecast = roundDaily((anchor / (1 - budget)) * 0.985);
  return roundDaily(Math.min(input.forecastDailyAvg, maxForecast));
}

/** A·常青款·主力：双向偏差预算封顶（近月锚定） */
export function applySymmetricBiasBudgetCap(input: {
  forecastDailyAvg: number;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  horizonMonthIndex: number;
  lifecycle: SalesLifecycle;
  growthFactor?: number;
  profileSegment?: ProfileSegment;
}): number {
  if (input.profileSegment === 'A:core') {
    return input.forecastDailyAvg;
  }
  if (input.lifecycle !== 'mature' && input.lifecycle !== 'decline') {
    return input.forecastDailyAvg;
  }
  const anchor = computeBiasBudgetAnchor({
    recent30DailyAvg: input.recent30DailyAvg,
    recent90DailyAvg: input.recent90DailyAvg,
    horizonMonthIndex: input.horizonMonthIndex,
    lifecycle: input.lifecycle,
    growthFactor: input.growthFactor,
    profileSegment: input.profileSegment,
  });
  if (anchor <= 0) return input.forecastDailyAvg;
  const budget = getHorizonBiasBudget(input.horizonMonthIndex);
  const minForecast = roundDaily(anchor * (1 - budget));
  const maxForecast = roundDaily(anchor * (1 + budget));
  return roundDaily(Math.min(Math.max(input.forecastDailyAvg, minForecast), maxForecast));
}

/** A·主力：仅上限封顶，防止放松对称 cap 后系统性过预测 */
export function applyACoreUpperBound(input: {
  forecastDailyAvg: number;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  horizonMonthIndex: number;
  lifecycle: SalesLifecycle;
  aCoreConfig?: ACoreAlgoConfig;
}): number {
  if (
    input.lifecycle !== 'mature' &&
    input.lifecycle !== 'decline' &&
    input.lifecycle !== 'growth'
  ) {
    return input.forecastDailyAvg;
  }
  const cfg = input.aCoreConfig ?? DEFAULT_ACORE_ALGO_CONFIG;
  const k = Math.max(0, Math.floor(input.horizonMonthIndex));
  const recent30 = nonNegative(input.recent30DailyAvg);
  const recent90 = nonNegative(input.recent90DailyAvg);
  let anchor = recent90 > 0 ? Math.min(recent30, recent90) : recent30;
  if (recent90 > 0 && recent30 < recent90 * cfg.declineRecent30Ratio) {
    anchor = recent30;
  }
  if (anchor <= 0) return input.forecastDailyAvg;
  let headroom = cfg.upperHeadroom[k] ?? 1.2;
  const cap = roundDaily(anchor * headroom);
  return roundDaily(Math.min(input.forecastDailyAvg, cap));
}

export function computeFloorForecast(input: {
  recent90DailyAvg: number;
  categoryP25?: number;
}): number {
  const recent = Math.max(0, input.recent90DailyAvg);
  if (recent <= 0) return 0;
  const floor = Math.max(recent * 0.1, input.categoryP25 ?? 0);
  return roundDaily(Math.min(floor, recent));
}

export function computeBClassPointForecast(input: {
  recent90DailyAvg: number;
  monthlyRows: Array<{ saleYear: number; month: number; qtySold: number }>;
  calendarMonth: number;
  seasonalityFactor: number;
}): number {
  const recent90 = nonNegative(input.recent90DailyAvg);
  if (recent90 <= 0) return 0;

  const sameMonthDailies: number[] = [];
  for (const row of input.monthlyRows) {
    if (row.month === input.calendarMonth && Number(row.qtySold) > 0) {
      sameMonthDailies.push(Number(row.qtySold) / daysInCalendarMonth(row.saleYear, row.month));
    }
  }

  let seasonalFactor = 1;
  if (sameMonthDailies.length >= 2) {
    const sorted = [...sameMonthDailies].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? recent90;
    const avgAll =
      sameMonthDailies.reduce((s, x) => s + x, 0) / sameMonthDailies.length;
    if (avgAll > 0) {
      seasonalFactor = Math.min(1.25, Math.max(0.75, median / avgAll));
    }
  }

  const season = nonNegative(input.seasonalityFactor) || 1;
  const clippedSeason = Math.min(1.15, Math.max(0.85, season));
  return roundDaily(recent90 * seasonalFactor * clippedSeason);
}

export function computeResidualInterval(input: {
  forecastDailyAvg: number;
  cv12m: number;
  promoIntensity?: number;
  profileSegment?: ProfileSegment | string | null;
  calendarMonth?: number;
}): { p10: number; p90: number } {
  const spread = resolveResidualSpreadRatio({
    profileSegment: input.profileSegment,
    calendarMonth: input.calendarMonth,
    cv12m: input.cv12m,
  });
  const bump = input.promoIntensity ?? 1;
  const p50 = Math.max(0, input.forecastDailyAvg);
  return {
    p10: roundDaily(p50 * Math.max(0, 1 - spread)),
    p90: roundDaily(p50 * (1 + spread * bump)),
  };
}

/** A·常青款近月强锚定（mature/decline） */
export function computeAClassForecast(input: {
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  lastYearSameMonthDailyAvg: number;
  yoyAnchorDailyAvg: number;
  horizonMonthIndex: number;
  seasonalityFactor: number;
  trendFactor: number;
  structuralLevel: number;
  wNear: number;
  wYoy: number;
  aCoreConfig?: ACoreAlgoConfig;
}): number | null {
  const cfg = input.aCoreConfig ?? DEFAULT_ACORE_ALGO_CONFIG;
  const k = Math.max(0, Math.floor(input.horizonMonthIndex));
  const recent30 = nonNegative(input.recent30DailyAvg);
  const recent90 = nonNegative(input.recent90DailyAvg);
  let base: number;

  if (k === 0) {
    const w30 = cfg.k0Recent30Weight;
    base = roundDaily(w30 * recent30 + (1 - w30) * recent90);
  } else if (k === 1) {
    const w30 = cfg.k1Recent30Weight;
    base = roundDaily(w30 * recent30 + (1 - w30) * recent90);
  } else if (k === 2) {
    const nearBlend = roundDaily(0.4 * recent30 + 0.6 * recent90);
    const yoy =
      input.lastYearSameMonthDailyAvg > 0
        ? input.lastYearSameMonthDailyAvg
        : input.yoyAnchorDailyAvg;
    const growth = recent90 > 0 && yoy > 0 ? recent90 / yoy : 1;
    const clippedGrowth = Math.min(1.1, Math.max(0.9, growth));
    const yoyCap = yoy > 0 ? roundDaily(yoy * clippedGrowth) : 0;
    base = roundDaily(Math.max(nearBlend, yoyCap));
  } else if (k >= 3 && k <= 5) {
    base = roundDaily(0.75 * input.structuralLevel + 0.25 * (recent90 || recent30));
  } else {
    return null;
  }

  let season = nonNegative(input.seasonalityFactor) || 1;
  let trend = nonNegative(input.trendFactor) || 1;
  const combined = season * trend;
  if (k <= 2) {
    const clipped = Math.min(1.1, Math.max(0.9, combined));
    season = Math.sqrt(clipped);
    trend = Math.sqrt(clipped);
  } else {
    const clipped = Math.min(1.15, Math.max(0.85, combined));
    season = Math.sqrt(clipped);
    trend = Math.sqrt(clipped);
  }

  return roundDaily(base * season * trend);
}

/** 近 3 个自然月日均 vs 去年同 3 个月日均，作为 YoY 增长锚点 */
export function computeYoyAnchorDailyAvg(
  monthlyRows: Array<{ saleYear: number; month: number; qtySold: number }>,
  refYear: number,
  refMonth: number,
): number {
  const recentDailies: number[] = [];
  const lyDailies: number[] = [];
  let y = refYear;
  let m = refMonth;

  for (let index = 0; index < 3; index++) {
    const total = monthlyRows
      .filter((row) => row.saleYear === y && row.month === m)
      .reduce((sum, row) => sum + Number(row.qtySold), 0);
    if (total > 0) {
      recentDailies.push(total / daysInCalendarMonth(y, m));
    }

    const lyTotal = monthlyRows
      .filter((row) => row.saleYear === y - 1 && row.month === m)
      .reduce((sum, row) => sum + Number(row.qtySold), 0);
    if (lyTotal > 0) {
      lyDailies.push(lyTotal / daysInCalendarMonth(y - 1, m));
    }

    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }

  if (!lyDailies.length) {
    return recentDailies.length
      ? roundDaily(recentDailies.reduce((sum, value) => sum + value, 0) / recentDailies.length)
      : 0;
  }
  return roundDaily(lyDailies.reduce((sum, value) => sum + value, 0) / lyDailies.length);
}

export function applyTrendBounds(factor: number): TrendBoundsResult {
  if (!Number.isFinite(factor) || factor <= 0) {
    return { factor: 1, applied: false };
  }

  if (factor < 0.7 || factor > 1.3) {
    return { factor, applied: false };
  }

  return { factor, applied: true };
}

export function applyCombinedSeasonalityBounds(combined: number): TrendBoundsResult {
  return applyTrendBounds(combined);
}

export function daysInCalendarMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function sumQtyInCalendarMonth(
  rows: Array<{ saleDate: string; qtySold: number }>,
  year: number,
  month: number,
): number {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  return rows.reduce((sum, row) => {
    const date = String(row.saleDate).slice(0, 10);
    return date.startsWith(prefix) ? sum + Number(row.qtySold) : sum;
  }, 0);
}

export function computeLastYearSameMonthDailyAvg(
  rows: Array<{ saleDate: string; qtySold: number }>,
  forecastYear: number,
  month: number,
): number {
  const lastYear = forecastYear - 1;
  const total = sumQtyInCalendarMonth(rows, lastYear, month);
  if (total <= 0) return 0;
  return roundDaily(total / daysInCalendarMonth(lastYear, month));
}

export function resolveLastYearSameMonthDailyAvg(input: {
  dailyRows: Array<{ saleDate: string; qtySold: number }>;
  monthlyRows?: Array<{ saleYear: number; month: number; qtySold: number }>;
  forecastYear: number;
  month: number;
}): number {
  const fromDaily = computeLastYearSameMonthDailyAvg(
    input.dailyRows,
    input.forecastYear,
    input.month,
  );
  if (fromDaily > 0) {
    return fromDaily;
  }

  const lastYear = input.forecastYear - 1;
  const monthlyTotal = (input.monthlyRows ?? []).reduce((sum, row) => {
    return row.saleYear === lastYear && row.month === input.month ? sum + row.qtySold : sum;
  }, 0);
  if (monthlyTotal <= 0) {
    return 0;
  }

  return roundDaily(monthlyTotal / daysInCalendarMonth(lastYear, input.month));
}

export function estimateCalendarMonthDailyAvg(
  monthlyRows: Array<{ saleYear: number; month: number; qtySold: number }>,
  calendarMonth: number,
): number {
  const dailies: number[] = [];
  for (const row of monthlyRows) {
    if (row.month !== calendarMonth || row.qtySold <= 0) continue;
    dailies.push(row.qtySold / daysInCalendarMonth(row.saleYear, row.month));
  }
  if (!dailies.length) return 0;
  return roundDaily(dailies.reduce((sum, value) => sum + value, 0) / dailies.length);
}

export function resolveEffectiveLastYearDailyAvg(input: {
  dailyRows: Array<{ saleDate: string; qtySold: number }>;
  monthlyRows?: Array<{ saleYear: number; month: number; qtySold: number }>;
  forecastYear: number;
  month: number;
}): number {
  const fromYoY = resolveLastYearSameMonthDailyAvg(input);
  if (fromYoY > 0) return fromYoY;
  return estimateCalendarMonthDailyAvg(input.monthlyRows ?? [], input.month);
}

export function computeForecastDailyAvgForMonth(input: {
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  lastYearSameMonthDailyAvg: number;
  categoryReferenceDailyAvg?: number;
  lifecycle?: SalesLifecycle;
  horizonMonthIndex?: number;
  skuTrendFactor?: number;
  seasonalityFactor?: number;
  trendFactor?: number;
  calendarMonth?: number;
  monthlyRows?: Array<{ saleYear: number; month: number; qtySold: number }>;
  yoyAnchorDailyAvg?: number;
  refYear?: number;
  refMonth?: number;
  profileClass?: ProfileClass;
  volumeTier?: VolumeTier;
  aCoreConfig?: ACoreAlgoConfig;
}): MonthlyForecastDailyAvgResult {
  const lifecycle = input.lifecycle ?? 'mature';
  const horizonIndex = input.horizonMonthIndex ?? 0;
  const calendarMonth = input.calendarMonth ?? 1;
  const recent30 = nonNegative(input.recent30DailyAvg);
  const recent90 = nonNegative(input.recent90DailyAvg);

  if (lifecycle === 'intermittent') {
    const baseline = recent90 > 0 ? recent90 : recent30;
    const cap = Math.max(recent30, recent90) * 1.15;
    const forecastDailyAvg = roundDaily(Math.min(baseline, cap > 0 ? cap : baseline));
    return {
      baselineDailyAvg: roundDaily(baseline),
      forecastDailyAvg,
      categoryTrendApplied: true,
      combinedTrendFactor: 1,
      skuTrendFactor: 1,
      seasonalityWasClipped: false,
      horizonFactors: {
        nearLevel: baseline,
        structuralLevel: baseline,
        yoyMonthLevel: 0,
        yoyAnchorLevel: 0,
        growthFactor: 1,
        wNear: 1,
        wYoy: 0,
        horizonMonthIndex: horizonIndex,
      },
    };
  }

  const nearLevel = computeNearTermLevel({
    recent30DailyAvg: input.recent30DailyAvg,
    recent90DailyAvg: input.recent90DailyAvg,
    categoryReferenceDailyAvg: input.categoryReferenceDailyAvg,
    lifecycle,
  });

  const computedYoyAnchor =
    input.refYear && input.refMonth
      ? computeYoyAnchorDailyAvg(input.monthlyRows ?? [], input.refYear, input.refMonth)
      : 0;
  const yoyAnchor =
    input.yoyAnchorDailyAvg ??
    (computedYoyAnchor > 0
      ? computedYoyAnchor
      : input.lastYearSameMonthDailyAvg > 0
        ? input.lastYearSameMonthDailyAvg
        : nearLevel);

  const growthCap = lifecycle === 'stockout_suspected' ? 1.0 : 1.3;
  const growthFactor =
    lifecycle === 'new'
      ? 1
      : computeYoYGrowthFactor(nearLevel, yoyAnchor, { maxFactor: growthCap });

  const yoyMonthLevel =
    input.lastYearSameMonthDailyAvg > 0
      ? input.lastYearSameMonthDailyAvg
      : estimateCalendarMonthDailyAvg(input.monthlyRows ?? [], calendarMonth);

  let structuralLevel =
    yoyMonthLevel > 0 ? roundDaily(yoyMonthLevel * growthFactor) : nearLevel;

  const declining = isDecliningSalesSignal(lifecycle, recent30, recent90);
  const { wNear, wYoy } = computeHorizonBlendWeights(horizonIndex, {
    decliningNearBias: declining && (lifecycle === 'mature' || lifecycle === 'decline'),
  });

  let baselineDailyAvg = roundDaily(wNear * nearLevel + wYoy * structuralLevel);
  if (lifecycle === 'new' && horizonIndex >= 3) {
    const ramp = computeNewProductRampDecay(horizonIndex);
    baselineDailyAvg = roundDaily(nearLevel * ramp);
    structuralLevel = baselineDailyAvg;
  }

  let seasonality = nonNegative(input.seasonalityFactor) || 1;
  let trend = nonNegative(input.trendFactor) || 1;
  if (lifecycle === 'new') {
    seasonality = 1;
    trend = 1;
  } else {
    const shrunk = shrinkSeasonalityForDecline(seasonality, trend, declining);
    seasonality = shrunk.seasonality;
    trend = shrunk.trend;
    if (declining && horizonIndex >= 3) {
      seasonality = Math.min(seasonality, 1);
    }
  }

  const rawCombined = seasonality * trend;
  const clipped = clipCombinedSeasonality(rawCombined);
  const seasonalityFactor = clipCombinedSeasonality(seasonality).factor;
  const trendFactor = clipCombinedSeasonality(trend).factor;
  const combinedTrendFactor = clipped.factor;

  const skuTrendFactor =
    input.skuTrendFactor ??
    (nearLevel > 0 ? roundDaily(structuralLevel / nearLevel) : 1);

  let forecastDailyAvg = roundDaily(baselineDailyAvg * seasonalityFactor * trendFactor);

  if (
    input.profileClass === 'A' &&
    (lifecycle === 'mature' || lifecycle === 'decline')
  ) {
    const aForecast = computeAClassForecast({
      recent30DailyAvg: recent30,
      recent90DailyAvg: recent90,
      lastYearSameMonthDailyAvg: input.lastYearSameMonthDailyAvg,
      yoyAnchorDailyAvg: yoyAnchor,
      horizonMonthIndex: horizonIndex,
      seasonalityFactor,
      trendFactor,
      structuralLevel,
      wNear,
      wYoy,
      aCoreConfig: input.aCoreConfig,
    });
    if (aForecast != null) {
      forecastDailyAvg = aForecast;
    }
  }

  forecastDailyAvg = applyHorizonBiasBudgetCap({
    forecastDailyAvg,
    recent30DailyAvg: recent30,
    recent90DailyAvg: recent90,
    horizonMonthIndex: horizonIndex,
    lifecycle,
    growthFactor,
    profileSegment:
      input.profileClass === 'A' && input.volumeTier === 'core' ? 'A:core' : undefined,
  });

  if (input.profileClass === 'A' && input.volumeTier === 'core') {
    forecastDailyAvg = applySymmetricBiasBudgetCap({
      forecastDailyAvg,
      recent30DailyAvg: recent30,
      recent90DailyAvg: recent90,
      horizonMonthIndex: horizonIndex,
      lifecycle,
      growthFactor,
      profileSegment: 'A:core',
    });
    forecastDailyAvg = applyACoreUpperBound({
      forecastDailyAvg,
      recent30DailyAvg: recent30,
      recent90DailyAvg: recent90,
      horizonMonthIndex: horizonIndex,
      lifecycle,
      aCoreConfig: input.aCoreConfig,
    });
  }

  return {
    baselineDailyAvg,
    forecastDailyAvg,
    categoryTrendApplied: rawCombined !== 1,
    combinedTrendFactor,
    skuTrendFactor,
    seasonalityWasClipped: clipped.wasClipped,
    horizonFactors: {
      nearLevel,
      structuralLevel,
      yoyMonthLevel,
      yoyAnchorLevel: yoyAnchor,
      growthFactor,
      wNear,
      wYoy,
      horizonMonthIndex: horizonIndex,
    },
  };
}

export function roundDaily(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 10_000) / 10_000;
}

/** When the current calendar month is incomplete, cap recent windows at the prior month-end. */
export function effectiveRecentWindowEnd(today = new Date()): Date {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (today.getUTCDate() >= lastDayOfMonth) {
    return new Date(Date.UTC(year, month, lastDayOfMonth));
  }
  return new Date(Date.UTC(year, month, 0));
}

/** Dates belonging to consecutive zero-qty runs of at least minRunDays within [start, end]. */
export function collectStockoutExcludedDates(
  rows: Array<{ saleDate: string; qtySold: number }>,
  start: Date,
  end: Date,
  minRunDays = 7,
): Set<string> {
  const qtyByDate = new Map(
    rows.map((row) => [String(row.saleDate).slice(0, 10), Number(row.qtySold)]),
  );
  const excluded = new Set<string>();
  let runDates: string[] = [];

  const flushRun = () => {
    if (runDates.length >= minRunDays) {
      for (const date of runDates) excluded.add(date);
    }
    runDates = [];
  };

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dateKey = cursor.toISOString().slice(0, 10);
    const qty = qtyByDate.get(dateKey) ?? 0;
    if (qty <= 0) {
      runDates.push(dateKey);
    } else {
      flushRun();
    }
  }
  flushRun();

  return excluded;
}

export function filterSalesRowsExcludingDates<T extends { saleDate: string }>(
  rows: T[],
  excludedDates: Set<string>,
): T[] {
  if (excludedDates.size === 0) return rows;
  return rows.filter((row) => !excludedDates.has(String(row.saleDate).slice(0, 10)));
}

function nonNegative(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}
