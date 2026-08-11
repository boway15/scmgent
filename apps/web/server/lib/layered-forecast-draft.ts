import { daysInMonth } from './layered-forecast-dims.js';
import { clipFactor } from './layered-forecast-series.js';

export function computeSkuDraftQty(input: {
  recent90Qty: number;
  period: string;
  seasonalityFactor: number;
}): number {
  const { recent90Qty, period, seasonalityFactor } = input;
  const daily = recent90Qty / 90;
  const days = daysInMonth(period);
  const factor = clipFactor(seasonalityFactor);
  return Math.max(0, daily * days * factor);
}
