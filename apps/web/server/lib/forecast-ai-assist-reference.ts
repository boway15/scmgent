/**
 * AI 辅助预测：系统参考水位与近端/同比混合建议（供 Dify Prompt 约束）。
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

/** 近端水位：历史中最近 take 个正销量月的日均均值 */
export function computeRecentLevelDaily(
  history: AiAssistHistoryCell[],
  take = 3,
): number {
  const positive = history.filter((h) => h.actualDailyAvg > 0).slice(-take);
  if (positive.length === 0) return 0;
  const sum = positive.reduce((acc, h) => acc + h.actualDailyAvg, 0);
  return roundDaily(sum / positive.length);
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
 * 近端 ≫ 同比时向同比回拉，避免把短期冲高当稳态。
 * - near/yoy ≥ 1.35 → 35% 近端 + 65% 同比
 * - 否则有同比 → 55% 近端 + 45% 同比
 * - 再相对系统水位做软夹紧
 */
export function suggestBlendDaily(input: {
  recentLevelDaily: number;
  yoySameMonthDaily: number;
  systemDailyAvg: number;
}): { suggestedDaily: number; nearOverYoyRatio: number | null; blendMode: string } {
  const recent = input.recentLevelDaily;
  const yoy = input.yoySameMonthDaily;
  const system = input.systemDailyAvg;

  let blendMode = 'recent_primary';
  let suggested = recent;
  let nearOverYoyRatio: number | null = null;

  if (yoy > 0 && recent > 0) {
    nearOverYoyRatio = roundDaily(recent / yoy);
    if (nearOverYoyRatio >= 1.35) {
      blendMode = 'yoy_pull';
      suggested = 0.35 * recent + 0.65 * yoy;
    } else {
      blendMode = 'balanced';
      suggested = 0.55 * recent + 0.45 * yoy;
    }
  } else if (yoy > 0) {
    blendMode = 'yoy_only';
    suggested = yoy;
  } else if (system > 0) {
    blendMode = 'system_fallback';
    suggested = system;
  }

  if (system > 0) {
    const lo = system * 0.7;
    const hi = Math.max(system * 1.2, recent > 0 ? recent * 1.15 : system * 1.2);
    suggested = Math.min(hi, Math.max(lo, suggested));
  } else if (recent > 0) {
    suggested = Math.min(suggested, recent * 1.15);
  }

  return {
    suggestedDaily: roundDaily(suggested),
    nearOverYoyRatio,
    blendMode,
  };
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

  const anyYoyPull = months.some((m) => m.blendMode === 'yoy_pull');
  const guidance = anyYoyPull
    ? '近端明显高于去年同月：优先按 suggestedBlendDaily / 同比水位锚定，勿贴近近端高点'
    : '按 suggestedBlendDaily 与 systemDailyAvg 综合；允许小幅偏离系统但需说明理由';

  return {
    profileSegment: input.profileSegment,
    productCategory,
    recentLevelDaily,
    guidance,
    months,
  };
}
