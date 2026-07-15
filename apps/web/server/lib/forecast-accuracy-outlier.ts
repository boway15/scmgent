/**
 * 准确率统计外生冲击剔除：广告、调价等导致个别 SKU/月份偏差过大时，不纳入主 KPI。
 */
import { computeWeightedMape, type AccuracyRowInput } from './forecast-accuracy-tier.js';
import { mergeExogenousSkuSets } from './forecast-exogenous-flags.js';

export const DEFAULT_OUTLIER_APE_THRESHOLD = 1.35;

/** 单月绝对百分比误差超过此值视为外生冲击行（默认 150%） */
export function getOutlierApeThreshold(): number {
  const raw = process.env.FORECAST_OUTLIER_APE;
  if (raw == null || raw === '') return DEFAULT_OUTLIER_APE_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_OUTLIER_APE_THRESHOLD;
}

/** 验证月实际销量低于此值（月件数）不计入主力 KPI，仅展示 */
export const DEFAULT_KPI_MIN_ACTUAL_MONTHLY = 50;

export type OutlierDetectInput = {
  skuCode: string;
  actualDaily: number;
  forecastDaily: number;
  actualMonthly?: number;
};

export function resolveExogenousSkuSet(
  rows: OutlierDetectInput[],
  opts?: { manualSkus?: Set<string>; threshold?: number },
): Set<string> {
  const auto = detectOutlierSkus(rows, opts?.threshold ?? getOutlierApeThreshold());
  return mergeExogenousSkuSets(auto, opts?.manualSkus ?? []);
}

export function rowAbsolutePercentError(
  actual: number,
  predicted: number,
): number | null {
  if (actual <= 0) return null;
  return Math.abs(predicted - actual) / actual;
}

export function isOutlierRow(
  actualDaily: number,
  forecastDaily: number,
  threshold = getOutlierApeThreshold(),
): boolean {
  const ape = rowAbsolutePercentError(actualDaily, forecastDaily);
  return ape != null && ape > threshold;
}

/** 任一验证月 APE 超阈值的 SKU 整单剔除（广告/调价等外生冲击） */
export function detectOutlierSkus(
  rows: OutlierDetectInput[],
  threshold = getOutlierApeThreshold(),
): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    if (isOutlierRow(row.actualDaily, row.forecastDaily, threshold)) {
      out.add(row.skuCode);
    }
  }
  return out;
}

export type KpiFilterOpts = {
  outlierSkuSet?: Set<string>;
  /** 月实际件数下限（需 actualMonthly） */
  minActualMonthly?: number;
  excludeGhost?: boolean;
};

export function filterRowsForCoreKpi<
  T extends OutlierDetectInput & { ghostRow?: boolean },
>(rows: T[], opts?: KpiFilterOpts): T[] {
  let out = rows;
  if (opts?.excludeGhost) {
    out = out.filter((r) => !r.ghostRow);
  }
  if (opts?.outlierSkuSet?.size) {
    out = out.filter((r) => !opts.outlierSkuSet!.has(r.skuCode));
  }
  if (opts?.minActualMonthly != null && opts.minActualMonthly > 0) {
    out = out.filter(
      (r) => r.actualMonthly == null || r.actualMonthly >= opts.minActualMonthly!,
    );
  }
  return out.filter((r) => r.actualDaily > 0);
}

export function summarizeWmapeWithOutlierExclusion(
  rows: Array<
    OutlierDetectInput & AccuracyRowInput & { ghostRow?: boolean; actualMonthly?: number }
  >,
  opts?: {
    outlierThreshold?: number;
    manualExogenousSkus?: Set<string>;
    minActualMonthly?: number;
    excludeGhost?: boolean;
    /** 已算好的全局外生 SKU（避免子层重算导致门禁口径漂移） */
    precomputedExogenousSkus?: Set<string>;
  },
): {
  wmapeAll: number | null;
  wmapeCore: number | null;
  outlierSkuCount: number;
  manualExogenousSkuCount: number;
  outlierRowCount: number;
  excludedMicroActRows: number;
  coreComparableRows: number;
  outlierSkus: string[];
} {
  const comparable = rows.filter((r) => r.actualDaily > 0);
  const threshold = opts?.outlierThreshold ?? getOutlierApeThreshold();
  const exogenousSkus =
    opts?.precomputedExogenousSkus ??
    resolveExogenousSkuSet(comparable, {
      manualSkus: opts?.manualExogenousSkus,
      threshold,
    });
  const outlierRowCount = comparable.filter((r) =>
    isOutlierRow(r.actualDaily, r.forecastDaily, threshold),
  ).length;
  const coreRows = filterRowsForCoreKpi(rows, {
    outlierSkuSet: exogenousSkus,
    minActualMonthly: opts?.minActualMonthly ?? DEFAULT_KPI_MIN_ACTUAL_MONTHLY,
    excludeGhost: opts?.excludeGhost ?? true,
  });
  const manualCount = opts?.manualExogenousSkus?.size ?? 0;
  const microExcluded = comparable.filter(
    (r) =>
      r.actualMonthly != null &&
      r.actualMonthly < (opts?.minActualMonthly ?? DEFAULT_KPI_MIN_ACTUAL_MONTHLY) &&
      !exogenousSkus.has(r.skuCode),
  ).length;

  return {
    wmapeAll: computeWeightedMape(rows),
    wmapeCore: computeWeightedMape(coreRows),
    outlierSkuCount: exogenousSkus.size,
    manualExogenousSkuCount: manualCount,
    outlierRowCount,
    excludedMicroActRows: microExcluded,
    coreComparableRows: coreRows.length,
    outlierSkus: [...exogenousSkus].sort(),
  };
}
