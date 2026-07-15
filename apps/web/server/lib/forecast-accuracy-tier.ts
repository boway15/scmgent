import { normalizeCategoryPath } from './sku-category.js';
import { classifyVolumeTier, type VolumeTier } from './forecast-eligibility.js';
import { filterKpiComparableAccuracyRows } from './forecast-accuracy-comparable.js';

export type AccuracyRowInput = {
  skuCode: string;
  skuId?: string;
  category?: string | null;
  actualDaily: number;
  forecastDaily: number;
  mape: number | null;
  biasRate: number | null;
  forecastYear?: number;
  month?: number;
  profileSegment?: string;
  forecastDailyP10?: number | null;
  forecastDailyP90?: number | null;
  classificationEstimated?: boolean;
};

export type TierStats = {
  tier: VolumeTier | 'skipped' | 'global';
  skuCount: number;
  comparableRows: number;
  wmape: number | null;
  weightedBias: number | null;
  highMapePct: number;
};

export type CategoryTierStats = {
  category: string;
  skuCount: number;
  comparableRows: number;
  wmape: number | null;
  weightedBias: number | null;
  highMapePct: number;
};

export type AccuracyTierSummary = {
  global: TierStats;
  byTier: TierStats[];
  byCategory: CategoryTierStats[];
};

/** 单 SKU 汇总 WMAPE 统计封顶（999%），防止极低分母拉高指标 */
export const SKU_WMAPE_STAT_CAP = 9.99;

export function capSkuWmapeForStats(wmape: number | null | undefined): number | null {
  if (wmape == null || Number.isNaN(wmape)) return null;
  if (wmape < 0) return 0;
  return Math.min(wmape, SKU_WMAPE_STAT_CAP);
}

function weightedMean(values: { w: number; v: number }[]): number | null {
  const valid = values.filter((x) => x.w > 0 && Number.isFinite(x.v));
  if (valid.length === 0) return null;
  const wSum = valid.reduce((s, x) => s + x.w, 0);
  return valid.reduce((s, x) => s + x.w * x.v, 0) / wSum;
}

export function computeWeightedMape(rows: AccuracyRowInput[]): number | null {
  const comparable = filterKpiComparableAccuracyRows(rows);
  if (comparable.length === 0) return null;
  const absErrorSum = comparable.reduce(
    (sum, r) => sum + Math.abs(r.forecastDaily - r.actualDaily),
    0,
  );
  const actualSum = comparable.reduce((sum, r) => sum + r.actualDaily, 0);
  if (actualSum <= 0) return null;
  return absErrorSum / actualSum;
}

function groupRowsByForecastMonth(rows: AccuracyRowInput[]): Map<string, AccuracyRowInput[]> {
  const map = new Map<string, AccuracyRowInput[]>();
  for (const row of rows) {
    if (row.forecastYear == null || row.month == null) continue;
    const key = `${row.forecastYear}-${row.month}`;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function meanFinite(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * 月均 WMAPE：各月先算 Σ|预测−实际|÷Σ实际，再对月份算术平均。
 */
export function computeMonthlyAvgWmape(rows: AccuracyRowInput[]): number | null {
  const kpiRows = filterKpiComparableAccuracyRows(rows);
  const byMonth = groupRowsByForecastMonth(kpiRows);
  if (byMonth.size === 0) return computeWeightedMape(kpiRows);
  const monthlyValues = [...byMonth.values()]
    .map((monthRows) => computeWeightedMape(monthRows))
    .filter((value): value is number => value != null);
  return meanFinite(monthlyValues);
}

/**
 * 月均 MAPE（有符号）：各月先算 Σ(预测−实际)÷Σ实际，再对月份算术平均。
 */
export function computeMonthlyAvgMape(rows: AccuracyRowInput[]): number | null {
  const kpiRows = filterKpiComparableAccuracyRows(rows);
  const byMonth = groupRowsByForecastMonth(kpiRows);
  if (byMonth.size === 0) return computeSignedMapeVsActual(kpiRows);
  const monthlyValues = [...byMonth.values()]
    .map((monthRows) => computeSignedMapeVsActual(monthRows))
    .filter((value): value is number => value != null);
  return meanFinite(monthlyValues);
}

/** @deprecated 使用 computeMonthlyAvgMape */
export const computeMonthlyAvgBiasVsActual = computeMonthlyAvgMape;

/** 相对实际：Σ(预测−实际)/Σ实际 */
export function computeSignedMapeVsActual(rows: AccuracyRowInput[]): number | null {
  const comparable = filterKpiComparableAccuracyRows(rows);
  if (!comparable.length) return null;
  const actualSum = comparable.reduce((sum, r) => sum + r.actualDaily, 0);
  if (actualSum <= 0) return null;
  const errSum = comparable.reduce((sum, r) => sum + (r.forecastDaily - r.actualDaily), 0);
  return errSum / actualSum;
}

/** @deprecated 使用 computeSignedMapeVsActual */
export const computeWeightedBiasVsActual = computeSignedMapeVsActual;

function topCategory(path: string | null | undefined): string {
  if (!path) return '(无品类)';
  const norm = normalizeCategoryPath(path);
  const parts = norm.split('/').filter(Boolean);
  if (parts.length === 0) return '(无品类)';
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

function rowSignedMape(row: AccuracyRowInput): number | null {
  if (row.actualDaily <= 0) return null;
  return (row.forecastDaily - row.actualDaily) / row.actualDaily;
}

function buildTierStats(
  tier: VolumeTier | 'skipped' | 'global',
  rows: AccuracyRowInput[],
): TierStats {
  const kpiRows = filterKpiComparableAccuracyRows(rows);
  const skuSet = new Set(rows.map((r) => r.skuCode));
  const wmape = computeMonthlyAvgWmape(rows);
  const weightedBias = computeMonthlyAvgMape(rows);
  const highMapePct =
    kpiRows.length > 0
      ? (kpiRows.filter((r) => {
          const mape = rowSignedMape(r);
          return mape != null && Math.abs(mape) > 0.3;
        }).length /
          kpiRows.length) *
        100
      : 0;

  return {
    tier,
    skuCount: skuSet.size,
    comparableRows: kpiRows.length,
    wmape,
    weightedBias,
    highMapePct,
  };
}

export function summarizeAccuracyByTier(
  rows: AccuracyRowInput[],
  categoryBySku?: Map<string, string | null>,
): AccuracyTierSummary {
  const bySku = new Map<
    string,
    { months: number; sumActual: number; rows: AccuracyRowInput[]; category: string | null }
  >();

  for (const row of rows) {
    let agg = bySku.get(row.skuCode);
    if (!agg) {
      const cat =
        row.category ??
        (row.skuId && categoryBySku ? (categoryBySku.get(row.skuId) ?? null) : null);
      agg = { months: 0, sumActual: 0, rows: [], category: cat };
      bySku.set(row.skuCode, agg);
    }
    agg.months += 1;
    agg.sumActual += row.actualDaily;
    agg.rows.push(row);
  }

  const tierRows = new Map<VolumeTier, AccuracyRowInput[]>([
    ['core', []],
    ['mid', []],
    ['tail', []],
  ]);
  const skippedRows: AccuracyRowInput[] = [];

  for (const agg of bySku.values()) {
    const avgActual = agg.sumActual / agg.months;
    const hasActual = agg.rows.some((r) => r.actualDaily > 0);
    if (!hasActual) {
      skippedRows.push(...agg.rows);
      continue;
    }
    const tier = classifyVolumeTier(avgActual);
    tierRows.get(tier)!.push(...agg.rows);
  }

  const byTier: TierStats[] = (['core', 'mid', 'tail'] as VolumeTier[]).map((tier) =>
    buildTierStats(tier, tierRows.get(tier) ?? []),
  );
  if (skippedRows.length > 0) {
    byTier.push(buildTierStats('skipped', skippedRows));
  }

  const catRows = new Map<string, AccuracyRowInput[]>();
  for (const agg of bySku.values()) {
    const cat = topCategory(agg.category);
    const list = catRows.get(cat) ?? [];
    list.push(...agg.rows);
    catRows.set(cat, list);
  }

  const byCategory = [...catRows.entries()]
    .map(([category, catRowList]) => {
      const skuSet = new Set(catRowList.map((r) => r.skuCode));
      const stats = buildTierStats('global', catRowList);
      return {
        category,
        skuCount: skuSet.size,
        comparableRows: stats.comparableRows,
        wmape: stats.wmape,
        weightedBias: stats.weightedBias,
        highMapePct: stats.highMapePct,
      };
    })
    .filter((c) => c.skuCount >= 20 && c.comparableRows > 0)
    .sort((a, b) => (b.wmape ?? 0) - (a.wmape ?? 0))
    .slice(0, 15);

  return {
    global: buildTierStats('global', rows),
    byTier,
    byCategory,
  };
}

function fmtPct(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

const TIER_LABELS: Record<string, string> = {
  core: '主力(≥5/日)',
  mid: '腰部(1-5/日)',
  tail: '长尾(<1/日)',
  skipped: '零销量',
  global: '全量',
};

export function formatTierSummaryLines(summary: AccuracyTierSummary): string[] {
  const lines = ['【销量分层准确率】'];
  const g = summary.global;
  lines.push(
    `全量：KPI 可比 ${g.comparableRows} 行 · 月均 MAPE ${fmtPct(g.weightedBias)} · 月均 WMAPE ${fmtPct(g.wmape)} · 高偏差 ${g.highMapePct.toFixed(1)}%`,
  );
  for (const tier of summary.byTier) {
    lines.push(
      `- ${TIER_LABELS[tier.tier] ?? tier.tier}：${tier.skuCount} SKU · KPI 可比 ${tier.comparableRows} 行 · 月均 MAPE ${fmtPct(tier.weightedBias)} · 月均 WMAPE ${fmtPct(tier.wmape)} · 高偏差 ${tier.highMapePct.toFixed(1)}%`,
    );
  }
  return lines;
}

export function filterTierSummary(
  summary: AccuracyTierSummary,
  tierFilter: VolumeTier | 'all',
): AccuracyTierSummary {
  if (tierFilter === 'all') return summary;
  const tierStat = summary.byTier.find((t) => t.tier === tierFilter);
  return {
    global: tierStat ?? summary.global,
    byTier: tierStat ? [tierStat] : [],
    byCategory: summary.byCategory,
  };
}
