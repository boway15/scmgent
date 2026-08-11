function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthFromPeriod(period: string): number {
  const month = Number(period.split('-')[1]);
  return month >= 1 && month <= 12 ? month : 0;
}

export function fitLinear(values: number[]): { a: number; b: number; r2: number } {
  const n = values.length;
  if (n === 0) {
    return { a: 0, b: 0, r2: 0 };
  }

  const xs = Array.from({ length: n }, (_, i) => i);
  const mx = xs.reduce((sum, x) => sum + x, 0) / n;
  const my = values.reduce((sum, y) => sum + y, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (values[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }

  const b = den ? num / den : 0;
  const a = my - b * mx;

  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = a + b * xs[i]!;
    ssRes += (values[i]! - predicted) ** 2;
    ssTot += (values[i]! - my) ** 2;
  }

  const r2 = ssTot ? 1 - ssRes / ssTot : 0;
  return { a, b, r2 };
}

export function clipFactor(f: number, min = 0.7, max = 1.3): number {
  return Math.min(max, Math.max(min, f));
}

export function monthlySeasonalFactors(
  values: number[],
  periods: string[],
): { factors: Record<number, number>; peakMonth: number; strength: number } {
  const fit = fitLinear(values);
  const byMonth: Record<number, number[]> = {};

  for (let i = 0; i < values.length; i++) {
    const month = monthFromPeriod(periods[i] ?? '');
    if (!month) continue;
    const trend = fit.a + fit.b * i;
    if (trend <= 0) continue;
    (byMonth[month] ??= []).push(values[i]! / trend);
  }

  const factors: Record<number, number> = {};
  let sum = 0;
  let count = 0;
  for (let month = 1; month <= 12; month++) {
    const samples = byMonth[month];
    if (samples?.length) {
      const avg = samples.reduce((acc, value) => acc + value, 0) / samples.length;
      factors[month] = avg;
      sum += avg;
      count++;
    } else {
      factors[month] = 1;
    }
  }

  const mean = count ? sum / count : 1;
  for (let month = 1; month <= 12; month++) {
    factors[month]! /= mean;
  }

  let peakMonth = 1;
  let smax = factors[1]!;
  let smin = factors[1]!;
  for (let month = 1; month <= 12; month++) {
    const factor = factors[month]!;
    if (factor > factors[peakMonth]!) peakMonth = month;
    if (factor > smax) smax = factor;
    if (factor < smin) smin = factor;
  }

  const strength = mean ? (smax - smin) / mean : 0;
  return { factors, peakMonth, strength };
}

export function extrapolateTrendSeasonal(
  history: number[],
  historyPeriods: string[],
  futurePeriods: string[],
): { qty: number[]; seasonalityFactor: number[]; peakMonth: number } {
  const n = history.length;
  const { factors, peakMonth } = monthlySeasonalFactors(history, historyPeriods);

  const qty: number[] = [];
  const seasonalityFactor: number[] = [];

  if (n < 3) {
    const base =
      n > 0 ? history.reduce((sum, value) => sum + value, 0) / n : 0;
    for (const period of futurePeriods) {
      const month = monthFromPeriod(period);
      const clipped = clipFactor(factors[month] ?? 1);
      seasonalityFactor.push(clipped);
      qty.push(Math.max(0, base * clipped));
    }
    return { qty, seasonalityFactor, peakMonth };
  }

  const { a, b } = fitLinear(history);
  for (let i = 0; i < futurePeriods.length; i++) {
    const month = monthFromPeriod(futurePeriods[i] ?? '');
    const clipped = clipFactor(factors[month] ?? 1);
    seasonalityFactor.push(clipped);
    qty.push(Math.max(0, (a + b * (n + i)) * clipped));
  }

  return { qty, seasonalityFactor, peakMonth };
}

export function scaleChildrenToParent(parentQty: number, childDrafts: number[]): number[] {
  const count = childDrafts.length;
  if (count === 0) return [];

  const draftSum = childDrafts.reduce((sum, draft) => sum + draft, 0);
  const shares =
    draftSum === 0
      ? childDrafts.map(() => 1 / count)
      : childDrafts.map((draft) => draft / draftSum);

  const scaled = shares.map((share, index) =>
    index < count - 1 ? round2(parentQty * share) : 0,
  );
  const partial = scaled.slice(0, -1).reduce((sum, value) => sum + value, 0);
  scaled[count - 1] = round2(parentQty - partial);
  return scaled;
}
