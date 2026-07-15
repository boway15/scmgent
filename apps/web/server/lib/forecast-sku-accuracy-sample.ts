/**
 * SKU 级准确率汇总与抽样展示（全量统计旁附部分商品偏差明细）
 */
import {
  capSkuWmapeForStats,
  computeWeightedBiasVsActual,
  computeWeightedMape,
} from './forecast-accuracy-tier.js';
import { isAllCatV41KpiComparableTier } from './forecast-allcat-v41.js';

export type SkuAccuracyRowInput = {
  skuCode: string;
  yearMonth?: string;
  horizon?: number;
  predictedMonthly?: number;
  actualMonthly?: number;
  predictedDaily: number;
  actualDaily: number;
  ghostRow?: boolean;
  outlierSku?: boolean;
  exogenousSku?: boolean;
  kpiCore?: boolean;
  profileSegment?: string | null;
  salesTier?: string;
  t1SubSegment?: string | null;
  model?: string;
};

export type SkuAccuracySummary = {
  skuCode: string;
  rowCount: number;
  comparableRows: number;
  predSumMonthly: number;
  actSumMonthly: number;
  absErrMonthly: number;
  wmape: number | null;
  /** 相对实际销量的加权偏差：(预测-实际)/实际 */
  bias: number | null;
  /** 展示用加总月量偏差：(Σ预测月量-Σ实际月量)/Σ实际月量，可与 WMAPE 对照 */
  sumDeviation: number | null;
  ghostRows: number;
  outlierSku: boolean;
  exogenousSku: boolean;
  kpiCoreRows: number;
  sampleTag: 'top_error' | 'random_core' | 'within_tolerance' | 'exogenous' | null;
  hasExcludedTier?: boolean;
};

function monthlyPair(r: SkuAccuracyRowInput): { pred: number; act: number } {
  const pred =
    r.predictedMonthly ??
    (r.predictedDaily > 0 ? r.predictedDaily * 30 : 0);
  const act =
    r.actualMonthly ??
    (r.actualDaily > 0 ? r.actualDaily * 30 : 0);
  return { pred, act };
}

export function summarizeAccuracyBySku(rows: SkuAccuracyRowInput[]): SkuAccuracySummary[] {
  const bySku = new Map<string, SkuAccuracyRowInput[]>();
  for (const row of rows) {
    const arr = bySku.get(row.skuCode) ?? [];
    arr.push(row);
    bySku.set(row.skuCode, arr);
  }

  const out: SkuAccuracySummary[] = [];
  for (const [skuCode, skuRows] of bySku) {
    let predSum = 0;
    let actSum = 0;
    let absErr = 0;
    let ghostRows = 0;
    let kpiCoreRows = 0;
    const accuracyInputs = skuRows.map((r) => {
      const { pred, act } = monthlyPair(r);
      predSum += pred;
      actSum += act;
      absErr += Math.abs(pred - act);
      if (r.ghostRow) ghostRows += 1;
      if (r.kpiCore) kpiCoreRows += 1;
      return {
        skuCode,
        actualDaily: r.actualDaily,
        forecastDaily: r.predictedDaily,
        mape: null,
        biasRate: null,
      };
    });
    const comparable = skuRows.filter((r) => r.actualDaily > 0);
    const hasExcludedTier = skuRows.some(
      (r) => r.profileSegment != null && !isAllCatV41KpiComparableTier(r.profileSegment),
    );
    const wmape = capSkuWmapeForStats(computeWeightedMape(accuracyInputs));
    const bias = computeWeightedBiasVsActual(accuracyInputs);
    const sumDeviation = actSum > 0 ? (predSum - actSum) / actSum : null;

    out.push({
      skuCode,
      rowCount: skuRows.length,
      comparableRows: comparable.length,
      predSumMonthly: predSum,
      actSumMonthly: actSum,
      absErrMonthly: absErr,
      wmape,
      bias,
      sumDeviation,
      ghostRows,
      outlierSku: skuRows.some((r) => r.outlierSku),
      exogenousSku: skuRows.some((r) => r.exogenousSku),
      kpiCoreRows,
      sampleTag: null,
      hasExcludedTier,
    });
  }
  return out.sort((a, b) => b.absErrMonthly - a.absErrMonthly);
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom<T>(items: T[], n: number, seed: number): T[] {
  if (items.length <= n) return [...items];
  const rng = mulberry32(seed);
  const copy = [...items];
  const picked: T[] = [];
  while (picked.length < n && copy.length > 0) {
    const i = Math.floor(rng() * copy.length);
    picked.push(copy[i]!);
    copy.splice(i, 1);
  }
  return picked;
}

export type SkuAccuracySampleReport = {
  skuCount: number;
  rowCount: number;
  aggregateWmape: number | null;
  topErrors: SkuAccuracySummary[];
  randomCoreSample: SkuAccuracySummary[];
  withinToleranceSample: SkuAccuracySummary[];
  exogenousSample: SkuAccuracySummary[];
};

export function buildSkuAccuracySampleReport(
  rows: SkuAccuracyRowInput[],
  opts?: {
    topN?: number;
    randomSampleN?: number;
    goodSampleN?: number;
    seed?: number;
    tolerancePct?: number;
  },
): SkuAccuracySampleReport {
  const topN = opts?.topN ?? 15;
  const randomSampleN = opts?.randomSampleN ?? 10;
  const goodSampleN = opts?.goodSampleN ?? 10;
  const tolerance = opts?.tolerancePct ?? 0.15;
  const seed = opts?.seed ?? 42;

  const summaries = summarizeAccuracyBySku(rows);
  const accuracyInputs = rows.map((r) => ({
    skuCode: r.skuCode,
    actualDaily: r.actualDaily,
    forecastDaily: r.predictedDaily,
    mape: null,
    biasRate: null,
  }));

  const topErrors = summaries.slice(0, topN).map((s) => ({ ...s, sampleTag: 'top_error' as const }));

  const kpiEligible = summaries.filter(
    (s) => s.comparableRows > 0 && !s.hasExcludedTier,
  );
  const coreSkus = kpiEligible.filter((s) => s.kpiCoreRows > 0);
  const randomCore = pickRandom(coreSkus, randomSampleN, seed).map((s) => ({
    ...s,
    sampleTag: 'random_core' as const,
  }));

  const goodPool = coreSkus.filter((s) => {
    if (s.actSumMonthly <= 0 || s.wmape == null) return false;
    return s.wmape <= tolerance;
  });
  const withinTolerance = pickRandom(goodPool, goodSampleN, seed + 1).map((s) => ({
    ...s,
    sampleTag: 'within_tolerance' as const,
  }));

  const exogenous = summaries
    .filter((s) => s.exogenousSku)
    .slice(0, topN)
    .map((s) => ({ ...s, sampleTag: 'exogenous' as const }));

  return {
    skuCount: summaries.length,
    rowCount: rows.length,
    aggregateWmape: computeWeightedMape(accuracyInputs),
    topErrors,
    randomCoreSample: randomCore,
    withinToleranceSample: withinTolerance,
    exogenousSample: exogenous,
  };
}

export function formatSkuSampleTable(
  title: string,
  items: SkuAccuracySummary[],
): string[] {
  const lines = [title];
  if (items.length === 0) {
    lines.push('  （无）');
    return lines;
  }
  const fmtPct = (v: number | null, digits = 1): string => {
    if (v == null || Number.isNaN(v)) return '—';
    return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;
  };
  for (const s of items) {
    const wmape = s.wmape == null ? '—' : `${(s.wmape * 100).toFixed(1)}%`;
    const bias = fmtPct(s.bias);
    const sumDev = fmtPct(s.sumDeviation);
    lines.push(
      `  ${s.skuCode} | WMAPE ${wmape} | 加权偏差 ${bias} | 加总月量偏差 ${sumDev} | 预测 ${Math.round(s.predSumMonthly)} / 实际 ${Math.round(s.actSumMonthly)}（${s.comparableRows} 行） | ghost ${s.ghostRows}${s.exogenousSku ? ' | 外生' : ''}`,
    );
  }
  return lines;
}

export function skuSampleToCsvRows(items: SkuAccuracySummary[]): string[] {
  const header =
    'sku,sample_tag,row_count,comparable_rows,kpi_core_rows,ghost_rows,pred_sum_monthly,act_sum_monthly,abs_err_monthly,wmape,bias,sum_deviation,outlier_sku,exogenous_sku';
  const body = items.map((s) =>
    [
      s.skuCode,
      s.sampleTag ?? '',
      s.rowCount,
      s.comparableRows,
      s.kpiCoreRows,
      s.ghostRows,
      s.predSumMonthly.toFixed(2),
      s.actSumMonthly.toFixed(2),
      s.absErrMonthly.toFixed(2),
      s.wmape == null ? '' : (s.wmape * 100).toFixed(2),
      s.bias == null ? '' : (s.bias * 100).toFixed(2),
      s.sumDeviation == null ? '' : (s.sumDeviation * 100).toFixed(2),
      s.outlierSku ? 1 : 0,
      s.exogenousSku ? 1 : 0,
    ].join(','),
  );
  return [header, ...body];
}
