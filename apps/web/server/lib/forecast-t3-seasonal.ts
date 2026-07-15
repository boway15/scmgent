/**
 * T3·季节波动：季节 naive + 近端锚混合，替代纯 damped trend。
 */
import { roundDaily } from './forecast-baseline.js';
import {
  deriveRecentDailyFromMonthly,
  median6MonthlyQty,
  monthlyQtyToDailyAvg,
  seasonalNaiveMonthlyQty,
  type MonthlyAbcdForecastResult,
} from './forecast-monthly-abcd.js';

export type T3SeasonalForecastInput = {
  monthlyQty: number[];
  horizonIndex: number;
  forecastYear: number;
  forecastMonth: number;
  recent90DailyAvg?: number;
  seasonalityFactor?: number;
  cv12m?: number;
};

export function forecastT3SeasonalDaily(input: T3SeasonalForecastInput): MonthlyAbcdForecastResult {
  const derived = deriveRecentDailyFromMonthly(
    input.monthlyQty,
    input.forecastYear,
    input.forecastMonth,
  );
  const recent90 = input.recent90DailyAvg ?? derived.recent90DailyAvg;
  const k = input.horizonIndex;
  const ts = input.monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  const last6 = ts.slice(-6);
  const activeLast6 = last6.filter((q) => q > 0).length;
  const last3Sum = ts.slice(-3).reduce((a, b) => a + b, 0);
  const prior3Sum = ts.slice(-6, -3).reduce((a, b) => a + b, 0);
  const lastMonth = ts[ts.length - 1] ?? 0;
  const zeroMonthsLast12 = ts.slice(-12).filter((q) => q === 0).length;
  if (recent90 <= 0 && last3Sum === 0) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'zero_sales' };
  }
  if (lastMonth === 0 && k <= 2) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'zero_sales' };
  }
  if (prior3Sum > 0 && last3Sum === 0 && k <= 3) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'a_risk_zero' };
  }
  if (activeLast6 <= 3 && k <= 2) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'zero_sales' };
  }
  if (zeroMonthsLast12 >= 4 && k <= 2) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'zero_sales' };
  }
  if (zeroMonthsLast12 >= 3 && k >= 2) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'zero_sales' };
  }
  if (prior3Sum > 0 && last3Sum / prior3Sum < 0.4 && k <= 2) {
    return { forecastDailyAvg: 0, baselineDailyAvg: 0, model: 'a_risk_zero' };
  }

  const lyQty = ts.length >= 12 ? seasonalNaiveMonthlyQty(ts, k) : 0;
  const lyDaily =
    lyQty > 0 ? monthlyQtyToDailyAvg(lyQty, input.forecastYear - 1, input.forecastMonth) : 0;
  const med6Daily = monthlyQtyToDailyAvg(
    median6MonthlyQty(ts),
    input.forecastYear,
    input.forecastMonth,
  );
  const season = input.seasonalityFactor ?? 1;
  const anchor = roundDaily(recent90 > 0 ? recent90 : med6Daily);
  let forecastDailyAvg: number;
  if (lyDaily > 0 && anchor > 0) {
    const lyBounded =
      lyDaily >= anchor * 0.55 && lyDaily <= anchor * 1.5 ? lyDaily : anchor;
    forecastDailyAvg = roundDaily(0.42 * anchor + 0.58 * lyBounded * season);
  } else {
    forecastDailyAvg = roundDaily(anchor * season);
  }
  const cv = input.cv12m ?? 1;
  const horizonDisc = k <= 0 ? 1 : k <= 2 ? 0.95 : 0.9;
  const zeroDisc = zeroMonthsLast12 >= 2 ? 0.82 : 1;
  forecastDailyAvg = roundDaily(forecastDailyAvg * horizonDisc * (cv > 1.2 ? 0.94 : 0.98) * zeroDisc);
  if (med6Daily > 0) {
    forecastDailyAvg = roundDaily(Math.min(forecastDailyAvg, med6Daily * 1.08));
  }
  return {
    forecastDailyAvg,
    baselineDailyAvg: anchor,
    model: 't3_seasonal',
  };
}
