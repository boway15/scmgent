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
