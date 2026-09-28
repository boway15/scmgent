import {
  computeSignedMapeVsActual,
  computeWeightedMape,
  type AccuracyRowInput,
} from './forecast-accuracy-tier.js';
import {
  formatAllCatV41TierLabel,
  type AllCatV41Tier,
} from './forecast-allcat-v41.js';
import { horizonBandFromIndex, type HorizonBand } from './forecast-horizon-band.js';

/** 规划口径：含 T4B/T99，actual>0 且 forecast>0 */
export type FlexBiasAttributionRow = {
  profileSegment: string;
  horizonIndex: number;
  forecastDaily: number;
  actualDaily: number;
  horizonFactors?: unknown;
};

export type TierHorizonAttributionCell = {
  tier: string;
  tierLabel: string;
  horizonIndex: number;
  horizonBand: HorizonBand;
  comparableRows: number;
  actualDailySum: number;
  forecastDailySum: number;
  weightedBias: number | null;
  wmape: number | null;
  /** 对 3–6 月整体偏差的贡献 = cellBias × (cellActual / flexActual) */
  flexContribution: number | null;
  discountProductMedian: number | null;
  discountProductP25: number | null;
  discountProductP75: number | null;
};

export type TierHorizonAttributionSummary = {
  flexWindow: { fromK: number; toK: number };
  flexTotalActual: number;
  flexWeightedBias: number | null;
  precisionWeightedBias: number | null;
  cells: TierHorizonAttributionCell[];
  recommendations: string[];
};

export const V41_ATTRIBUTION_TIERS = [
  'T1',
  'T2',
  'T3',
  'T3P',
  'T4A',
  'T4B',
  'T99',
  'unclassified',
] as const;

const FLEX_K_FROM = 3;
const FLEX_K_TO = 5;
const PRECISION_K_TO = 2;
const MIN_CELL_ROWS = 5;

function isPlanningComparable(row: FlexBiasAttributionRow): boolean {
  return row.actualDaily > 0 && row.forecastDaily > 0;
}

function normalizeTier(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed || trimmed.startsWith('A:') || trimmed.startsWith('B:') || trimmed.startsWith('C:') || trimmed.startsWith('D:')) {
    return 'unclassified';
  }
  return trimmed;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo] ?? null;
  const weight = idx - lo;
  return (sorted[lo] ?? 0) * (1 - weight) + (sorted[hi] ?? 0) * weight;
}

function readFactor(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 从 horizon_factors 提取已落地叠乘：conservative × month × trend */
export function parseHorizonDiscountProduct(horizonFactors: unknown): number | null {
  if (!horizonFactors || typeof horizonFactors !== 'object') return null;
  const record = horizonFactors as Record<string, unknown>;
  const conservative = readFactor(record.conservativeFactor) ?? 1;
  const month = readFactor(record.monthFactor) ?? 1;
  const trend = readFactor(record.effectiveTrendDecay) ?? 1;
  const product = conservative * month * trend;
  return Number.isFinite(product) && product > 0 ? product : null;
}

function toAccuracyInputs(rows: FlexBiasAttributionRow[]): AccuracyRowInput[] {
  return rows.map((row) => ({
    skuCode: '',
    actualDaily: row.actualDaily,
    forecastDaily: row.forecastDaily,
    profileSegment: row.profileSegment,
  }));
}

function summarizeCell(
  tier: string,
  horizonIndex: number,
  rows: FlexBiasAttributionRow[],
  flexTotalActual: number,
): TierHorizonAttributionCell {
  const inputs = toAccuracyInputs(rows);
  const actualDailySum = rows.reduce((sum, row) => sum + row.actualDaily, 0);
  const forecastDailySum = rows.reduce((sum, row) => sum + row.forecastDaily, 0);
  const weightedBias = computeSignedMapeVsActual(inputs);
  const discounts = rows
    .map((row) => parseHorizonDiscountProduct(row.horizonFactors))
    .filter((value): value is number => value != null);

  const inFlex = horizonIndex >= FLEX_K_FROM && horizonIndex <= FLEX_K_TO;
  const flexContribution =
    inFlex && flexTotalActual > 0 && weightedBias != null
      ? weightedBias * (actualDailySum / flexTotalActual)
      : null;

  return {
    tier,
    tierLabel: formatAllCatV41TierLabel(tier as AllCatV41Tier) || tier,
    horizonIndex,
    horizonBand: horizonBandFromIndex(horizonIndex),
    comparableRows: rows.length,
    actualDailySum,
    forecastDailySum,
    weightedBias,
    wmape: computeWeightedMape(inputs),
    flexContribution,
    discountProductMedian: percentile(discounts, 0.5),
    discountProductP25: percentile(discounts, 0.25),
    discountProductP75: percentile(discounts, 0.75),
  };
}

export function buildTierHorizonAttribution(
  rows: FlexBiasAttributionRow[],
): TierHorizonAttributionSummary {
  const comparable = rows.filter(isPlanningComparable);
  const flexRows = comparable.filter(
    (row) => row.horizonIndex >= FLEX_K_FROM && row.horizonIndex <= FLEX_K_TO,
  );
  const precisionRows = comparable.filter((row) => row.horizonIndex <= PRECISION_K_TO);
  const flexTotalActual = flexRows.reduce((sum, row) => sum + row.actualDaily, 0);

  const cellMap = new Map<string, FlexBiasAttributionRow[]>();
  for (const row of comparable) {
    const tier = normalizeTier(row.profileSegment);
    const key = `${tier}|${row.horizonIndex}`;
    const list = cellMap.get(key) ?? [];
    list.push(row);
    cellMap.set(key, list);
  }

  const cells: TierHorizonAttributionCell[] = [];
  for (const tier of V41_ATTRIBUTION_TIERS) {
    for (let k = 0; k <= FLEX_K_TO; k += 1) {
      const bucket = cellMap.get(`${tier}|${k}`) ?? [];
      if (!bucket.length) continue;
      cells.push(summarizeCell(tier, k, bucket, flexTotalActual));
    }
  }

  cells.sort((a, b) => {
    if (a.horizonIndex !== b.horizonIndex) return a.horizonIndex - b.horizonIndex;
    const tierOrder = V41_ATTRIBUTION_TIERS.indexOf(a.tier as (typeof V41_ATTRIBUTION_TIERS)[number]);
    const tierOrderB = V41_ATTRIBUTION_TIERS.indexOf(b.tier as (typeof V41_ATTRIBUTION_TIERS)[number]);
    return (tierOrder >= 0 ? tierOrder : 99) - (tierOrderB >= 0 ? tierOrderB : 99);
  });

  return {
    flexWindow: { fromK: FLEX_K_FROM, toK: FLEX_K_TO },
    flexTotalActual,
    flexWeightedBias: computeSignedMapeVsActual(toAccuracyInputs(flexRows)),
    precisionWeightedBias: computeSignedMapeVsActual(toAccuracyInputs(precisionRows)),
    cells,
    recommendations: inferFlexBiasRecommendations(cells, flexTotalActual),
  };
}

export function inferFlexBiasRecommendations(
  cells: TierHorizonAttributionCell[],
  flexTotalActual: number,
): string[] {
  const recs: string[] = [];
  const flexCells = cells.filter(
    (cell) =>
      cell.horizonIndex >= FLEX_K_FROM &&
      cell.horizonIndex <= FLEX_K_TO &&
      cell.comparableRows >= MIN_CELL_ROWS,
  );
  if (!flexCells.length || flexTotalActual <= 0) {
    recs.push('柔性窗样本不足，请先跑走步回测或扩大诊断版本范围。');
    return recs;
  }

  const tailTiers = new Set(['T4A', 'T4B', 'T99']);
  const tailFlex = flexCells.filter((cell) => tailTiers.has(cell.tier));
  const tailContribution = tailFlex.reduce(
    (sum, cell) => sum + Math.abs(cell.flexContribution ?? 0),
    0,
  );
  const totalAbsContribution = flexCells.reduce(
    (sum, cell) => sum + Math.abs(cell.flexContribution ?? 0),
    0,
  );
  const tailShare = totalAbsContribution > 0 ? tailContribution / totalAbsContribution : 0;

  const tailDiscounts = tailFlex
    .map((cell) => cell.discountProductMedian)
    .filter((value): value is number => value != null);
  const tailDiscountMedian = percentile(tailDiscounts, 0.5);

  if (tailShare >= 0.55 && tailDiscountMedian != null && tailDiscountMedian <= 0.78) {
    recs.push(
      `T4A/T4B/T99 在 k=3–5 贡献了约 ${(tailShare * 100).toFixed(0)}% 的柔性窗偏差，叠乘中位数 ${tailDiscountMedian.toFixed(2)}；下一步优先做远端影子偏差校正（≈0.90–1.25），近端 T1–T3 不动。`,
    );
  }

  const coreFlex = flexCells.filter((cell) => ['T1', 'T2', 'T3', 'T3P'].includes(cell.tier));
  const coreNegative = coreFlex.filter((cell) => (cell.weightedBias ?? 0) < -0.08);
  if (coreNegative.length >= 3) {
    recs.push(
      'T1–T3 在 k=3–5 也普遍低估：优先检查全局 monthFactor，暂不上 SKU 级权重表。',
    );
  }

  const highSeasonalSpread =
    flexCells.some((cell) => (cell.weightedBias ?? 0) > 0.08) &&
    flexCells.some((cell) => (cell.weightedBias ?? 0) < -0.08);
  if (highSeasonalSpread && tailShare < 0.45) {
    recs.push(
      '同一柔性窗内不同格子偏差方向相反：下一步做「季节强度 × 稳定性 × k」权重配方，而非统一抬远端折扣。',
    );
  }

  if (!recs.length) {
    recs.push('柔性窗偏差分散，建议先按 T×k 表锁定贡献最大的 2–3 个格子再改公式。');
  }
  return recs;
}

export function formatSignedPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export function formatTierHorizonAttributionTable(summary: TierHorizonAttributionSummary): string[] {
  const lines: string[] = [];
  lines.push(
    `柔性窗 k=${summary.flexWindow.fromK}–${summary.flexWindow.toK} · 规划口径(actual>0) · 整体偏差 ${formatSignedPct(summary.flexWeightedBias)} · 近端 k≤2 ${formatSignedPct(summary.precisionWeightedBias)}`,
  );
  lines.push(
    ['T层', 'k', '可比行', '销量加权偏差', '柔性贡献', 'WMAPE', '叠乘P50', '叠乘P25–P75'].join('\t'),
  );
  for (const cell of summary.cells) {
    const discountRange =
      cell.discountProductP25 != null && cell.discountProductP75 != null
        ? `${cell.discountProductP25.toFixed(2)}–${cell.discountProductP75.toFixed(2)}`
        : '—';
    lines.push(
      [
        cell.tierLabel,
        cell.horizonIndex,
        cell.comparableRows,
        formatSignedPct(cell.weightedBias),
        cell.flexContribution != null ? formatSignedPct(cell.flexContribution) : '—',
        cell.wmape != null ? `${(cell.wmape * 100).toFixed(1)}%` : '—',
        cell.discountProductMedian != null ? cell.discountProductMedian.toFixed(2) : '—',
        discountRange,
      ].join('\t'),
    );
  }
  lines.push('');
  lines.push('建议：');
  for (const rec of summary.recommendations) {
    lines.push(`- ${rec}`);
  }
  return lines;
}
