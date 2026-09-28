import { isoWeekMondayUtc, monthKeyFromUtcDate } from './planning-calendar.js';

export const DEMAND_SHAPE_CLIP_MIN = 0.5;
export const DEMAND_SHAPE_CLIP_MAX = 2.0;

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

export function systemDailyAvgForWeek(input: {
  unconstrainedRecentDaily: number;
  share: number;
  weekForecastDaily: number;
  championRefDaily: number;
}): number {
  return systemDailyAvgForMonth({
    unconstrainedRecentDaily: input.unconstrainedRecentDaily,
    share: input.share,
    monthForecastDaily: input.weekForecastDaily,
    championRefDaily: input.championRefDaily,
  });
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
