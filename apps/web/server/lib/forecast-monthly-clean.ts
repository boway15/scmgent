/**
 * 月级训练序列清洗：缺货填均、大促压顶（仅用于建模，不改原始销量）。
 */
export type MonthlyCleanAnomaly = 'none' | 'stockout' | 'promo';

export type CleanedMonthlyCell = {
  qty: number;
  rawQty: number;
  anomaly: MonthlyCleanAnomaly;
};

export type CleanMonthlyQtyResult = {
  cleaned: number[];
  cells: CleanedMonthlyCell[];
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx] ?? 0;
}

export function detectMonthlyAnomalies(qty: number[]): MonthlyCleanAnomaly[] {
  const ts = qty.map((q) => Math.max(0, Number(q) || 0));
  const mean = ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : 0;
  const std = ts.length
    ? Math.sqrt(ts.reduce((s, x) => s + (x - mean) ** 2, 0) / ts.length)
    : 0;

  return ts.map((q, i) => {
    const hadPriorSales = ts.slice(0, i).some((x) => x > 0);
    if (q === 0 && hadPriorSales) return 'stockout';
    if (mean > 0 && q > mean + 2 * std) return 'promo';
    return 'none';
  });
}

export function cleanMonthlyQtyForTraining(
  monthlyQty: number[],
  opts?: {
    categoryMeanQty?: number;
    promoFlags?: boolean[];
  },
): CleanMonthlyQtyResult {
  const raw = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  const anomalies = detectMonthlyAnomalies(raw);
  const positive = raw.filter((q) => q > 0);
  const skuMean = positive.length ? positive.reduce((a, b) => a + b, 0) / positive.length : 0;
  const fillMean = opts?.categoryMeanQty ?? skuMean;
  const p90 = percentile([...positive].sort((a, b) => a - b), 0.9);

  const cells: CleanedMonthlyCell[] = [];
  const cleaned = raw.map((q, i) => {
    const flagged = opts?.promoFlags?.[i] === true ? 'promo' : anomalies[i]!;
    let out = q;
    if (flagged === 'stockout') {
      out = fillMean > 0 ? fillMean : q;
    } else if (flagged === 'promo') {
      const cap = p90 > 0 ? p90 : fillMean > 0 ? fillMean * 1.5 : q;
      out = Math.min(q, cap > 0 ? cap : q);
    }
    cells.push({ qty: out, rawQty: q, anomaly: flagged });
    return out;
  });

  return { cleaned, cells };
}
