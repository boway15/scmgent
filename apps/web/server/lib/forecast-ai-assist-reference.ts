/**
 * AI 辅助预测：系统参考水位与近端/同比混合建议（供 Dify Prompt 约束 + 服务端硬封顶）。
 */

import {
  computeAllCatV41ForecastForMonth,
  resolveAllCatProductCategory,
} from './forecast-allcat-v41';

export type AiAssistHistoryCell = {
  monthLabel: string;
  forecastYear: number;
  month: number;
  actualDailyAvg: number;
};

export type AiAssistSystemReferenceMonth = {
  monthLabel: string;
  systemDailyAvg: number;
  anchorDaily: number;
  seasonalDaily: number | null;
  yoySameMonthDaily: number;
  recentLevelDaily: number;
  nearOverYoyRatio: number | null;
  suggestedBlendDaily: number;
  blendMode: string;
  seasonalityFactor: number;
  trendFactor: number;
  combinedFactor: number;
};

export type AiAssistSystemReference = {
  profileSegment: string;
  productCategory: string;
  recentLevelDaily: number;
  guidance: string;
  months: AiAssistSystemReferenceMonth[];
};

function roundDaily(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function monthLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * 近端水位：最近 take 个正销量月的日均中位数（避免旺季均值虚高）。
 */
export function computeRecentLevelDaily(
  history: AiAssistHistoryCell[],
  take = 6,
): number {
  const positive = history.filter((h) => h.actualDailyAvg > 0).slice(-take);
  if (positive.length === 0) return 0;
  return roundDaily(median(positive.map((h) => h.actualDailyAvg)));
}

/** 预测月对应的去年同月日均 */
export function yoySameMonthDaily(
  history: AiAssistHistoryCell[],
  forecastYear: number,
  month: number,
): number {
  const label = monthLabel(forecastYear - 1, month);
  return history.find((h) => h.monthLabel === label)?.actualDailyAvg ?? 0;
}

/**
 * 混合建议：
 * 1) 有 V4.1 系统水位时以系统为锚（不再用 recent×1.15 抬高封顶）
 * 2) 近端 ≫ 可靠同比时向同比回拉
 * 3) 系统明显低于同比（疑似过度保守）时向同比抬
 * 4) 同比相对近端过低（疑似缺货异常月）时不强制跟同比
 */
export function suggestBlendDaily(input: {
  recentLevelDaily: number;
  yoySameMonthDaily: number;
  systemDailyAvg: number;
}): { suggestedDaily: number; nearOverYoyRatio: number | null; blendMode: string } {
  const recent = input.recentLevelDaily;
  const yoy = input.yoySameMonthDaily;
  const system = input.systemDailyAvg;

  const nearOverYoyRatio =
    yoy > 0 && recent > 0 ? roundDaily(recent / yoy) : null;
  const yoyAnomalous = yoy > 0 && recent > 0 && yoy < recent * 0.35;
  const yoyReliable = yoy > 0 && !yoyAnomalous;

  let blendMode = 'recent_primary';
  let suggested = recent > 0 ? recent : 0;

  if (system > 0) {
    blendMode = 'system_primary';
    suggested = system;
  }

  if (yoyAnomalous && system > 0 && recent > 0) {
    // 同比疑似缺货异常：软回拉，但不跌破系统 75%
    const pulled = 0.25 * recent + 0.75 * yoy;
    suggested = Math.min(system, Math.max(pulled, system * 0.75));
    blendMode = 'yoy_anomaly_soft';
  } else if (yoyReliable && recent > 0 && nearOverYoyRatio != null && nearOverYoyRatio >= 1.25) {
    const pulled = 0.25 * recent + 0.75 * yoy;
    const towardYoy = system > 0 && yoy < system ? 0.45 * system + 0.55 * yoy : pulled;
    blendMode = system > 0 ? 'system_yoy_cap' : 'yoy_pull';
    const capped = Math.min(pulled, towardYoy);
    suggested = suggested > 0 ? Math.min(suggested, capped) : capped;
  } else if (system > 0 && yoyReliable && yoy < system) {
    const towardYoy = 0.45 * system + 0.55 * yoy;
    blendMode = 'system_toward_yoy';
    suggested = Math.min(suggested, towardYoy);
  } else if (!system && yoyReliable) {
    blendMode = 'balanced';
    suggested = recent > 0 ? 0.4 * recent + 0.6 * yoy : yoy;
  } else if (!system && yoy > 0) {
    blendMode = yoyAnomalous ? 'yoy_anomaly_skip' : 'yoy_only';
    suggested = yoyAnomalous && recent > 0 ? recent : yoy;
  }

  if (system > 0 && yoyReliable && system < yoy * 0.55) {
    blendMode = 'system_low_yoy_lift';
    suggested = 0.3 * system + 0.7 * yoy;
  }

  if (system > 0) {
    const hi = system * 1.15;
    if (blendMode === 'system_low_yoy_lift') {
      // 抬升后不再被系统 hi 压回
      suggested = Math.max(suggested * 0.95, suggested);
    } else if (blendMode === 'yoy_anomaly_soft' || blendMode === 'system_yoy_cap' || blendMode === 'system_toward_yoy') {
      // 已相对系统下调，勿再用 system*0.75 抬回去
      suggested = Math.min(hi, suggested);
    } else {
      suggested = Math.min(hi, Math.max(system * 0.75, suggested));
    }
  } else if (recent > 0) {
    suggested = Math.min(suggested, recent * 1.05);
  }

  if (recent > 0) {
    suggested = Math.min(suggested, recent * 1.05);
  }

  return {
    suggestedDaily: roundDaily(suggested),
    nearOverYoyRatio,
    blendMode,
  };
}

/** 服务端硬封顶：Dify 输出不得超过 suggestedBlend×capRatio */
export function applyAiAssistForecastGuard(
  difyDaily: number,
  ref: Pick<AiAssistSystemReferenceMonth, 'suggestedBlendDaily' | 'blendMode'> | null | undefined,
  capRatio = 1.05,
): number {
  if (!(difyDaily > 0)) return 0;
  const suggested = ref?.suggestedBlendDaily ?? 0;
  if (!(suggested > 0)) return roundDaily(difyDaily);
  return roundDaily(Math.min(difyDaily, suggested * capRatio));
}

/**
 * 解析 Dify 月值；若缺失/为 0 则回退到 suggestedBlendDaily。
 * 避免 LLM 只写 summary、monthly_forecast_json=[] 时页面写 0 月。
 */
export function resolveAiAssistMonthDaily(input: {
  difyDaily?: number | null;
  ref?: Pick<AiAssistSystemReferenceMonth, 'suggestedBlendDaily' | 'blendMode'> | null;
  capRatio?: number;
}): { forecastDailyAvg: number; usedFallback: boolean } {
  const difyDaily = Number(input.difyDaily ?? 0);
  const suggested = input.ref?.suggestedBlendDaily ?? 0;
  if (difyDaily > 0) {
    return {
      forecastDailyAvg: applyAiAssistForecastGuard(difyDaily, input.ref, input.capRatio),
      usedFallback: false,
    };
  }
  if (suggested > 0) {
    return { forecastDailyAvg: roundDaily(suggested), usedFallback: true };
  }
  return { forecastDailyAvg: 0, usedFallback: false };
}

export function buildAiAssistSystemReference(input: {
  profileSegment: string;
  productCategory: string | null | undefined;
  platform: string;
  monthlyRows: Array<{ saleYear: number; month: number; qtySold: number }>;
  history: AiAssistHistoryCell[];
  categoryTrend: Array<{
    monthLabel: string;
    seasonalityFactor: number;
    trendFactor: number;
    combinedFactor: number;
  }>;
  forecastHorizon: Array<{ monthLabel: string; forecastYear: number; month: number }>;
  historyCapEnd: Date;
  recent30DailyAvg?: number | null;
  recent90DailyAvg?: number | null;
}): AiAssistSystemReference {
  const productCategory = resolveAllCatProductCategory(input.productCategory);
  const recentLevelDaily = computeRecentLevelDaily(input.history);
  const trendByLabel = new Map(input.categoryTrend.map((t) => [t.monthLabel, t]));

  const months: AiAssistSystemReferenceMonth[] = input.forecastHorizon.map((h, horizonIndex) => {
    const v41 = computeAllCatV41ForecastForMonth({
      productCategory,
      platform: input.platform,
      forecastYear: h.forecastYear,
      forecastMonth: h.month,
      horizonIndex,
      monthlyRows: input.monthlyRows,
      historyCapEnd: input.historyCapEnd,
      recent30DailyAvg: input.recent30DailyAvg ?? recentLevelDaily,
      recent90DailyAvg: input.recent90DailyAvg ?? null,
    });
    const yoy = yoySameMonthDaily(input.history, h.forecastYear, h.month);
    const blend = suggestBlendDaily({
      recentLevelDaily,
      yoySameMonthDaily: yoy,
      systemDailyAvg: v41.forecastDaily,
    });
    const trend = trendByLabel.get(h.monthLabel);
    return {
      monthLabel: h.monthLabel,
      systemDailyAvg: roundDaily(v41.forecastDaily),
      anchorDaily: roundDaily(v41.horizonFactors.anchorDaily ?? v41.baseDaily),
      seasonalDaily:
        v41.horizonFactors.seasonalDaily != null
          ? roundDaily(v41.horizonFactors.seasonalDaily)
          : null,
      yoySameMonthDaily: yoy,
      recentLevelDaily,
      nearOverYoyRatio: blend.nearOverYoyRatio,
      suggestedBlendDaily: blend.suggestedDaily,
      blendMode: blend.blendMode,
      seasonalityFactor: trend?.seasonalityFactor ?? 1,
      trendFactor: trend?.trendFactor ?? 1,
      combinedFactor: trend?.combinedFactor ?? 1,
    };
  });

  const guidance =
    '优先按 suggestedBlendDaily 输出；已含系统锚+同比回拉。服务端会硬封顶，勿贴近期高点。';

  return {
    profileSegment: input.profileSegment,
    productCategory,
    recentLevelDaily,
    guidance,
    months,
  };
}
