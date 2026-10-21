/**
 * 需求门禁：WMAPE fail 或还原封顶的建议需人工确认，不进默认可采纳队列。
 */

import { isKpiMet, type HorizonBand } from './forecast-kpi-targets.js';
import type { ProfileSegment } from './forecast-profile-class.js';
import { UNCONSTRAIN_CAP_RATIO } from './forecast-demand-unconstrain.js';

export type SkuAccuracySampleRow = {
  station: string;
  platform: string;
  forecastYear: number;
  month: number;
  forecastDailyAvg: number | string;
  actualDailyAvg: number | string;
  computedAt?: Date | string | null;
};

/**
 * SKU 最近已结算月 WMAPE：同站点×平台仅取最新计算的一行（重发布会产生多版本），
 * 再按实际日均加权 Σ|预测−实际|÷Σ实际；实际或预测 ≤0 的行不参与（与主 KPI 可比口径一致）。
 */
export function computeRecentSkuWmape(rows: SkuAccuracySampleRow[]): number | null {
  if (rows.length === 0) return null;
  const monthKey = (r: SkuAccuracySampleRow) => r.forecastYear * 100 + r.month;
  const latestMonth = Math.max(...rows.map(monthKey));

  const latestByScope = new Map<string, SkuAccuracySampleRow>();
  for (const row of rows) {
    if (monthKey(row) !== latestMonth) continue;
    const scope = `${row.station}|${row.platform}`;
    const prev = latestByScope.get(scope);
    const ts = row.computedAt ? new Date(row.computedAt).getTime() : 0;
    const prevTs = prev?.computedAt ? new Date(prev.computedAt).getTime() : 0;
    if (!prev || ts > prevTs) latestByScope.set(scope, row);
  }

  let absErrorSum = 0;
  let actualSum = 0;
  for (const row of latestByScope.values()) {
    const forecast = Number(row.forecastDailyAvg);
    const actual = Number(row.actualDailyAvg);
    if (!Number.isFinite(forecast) || !Number.isFinite(actual)) continue;
    if (actual <= 0 || forecast <= 0) continue;
    absErrorSum += Math.abs(forecast - actual);
    actualSum += actual;
  }
  return actualSum > 0 ? absErrorSum / actualSum : null;
}

const PRECISION_WINDOW_MONTHS = 3;

function monthKeyOf(row: SkuAccuracySampleRow): number {
  return row.forecastYear * 100 + row.month;
}

/** 最近 3 个已结算月的加权 WMAPE，以及这些月的预测误差标准差。 */
export function summarizePrecisionWindow(rows: SkuAccuracySampleRow[]): {
  wmape: number | null;
  errorStdDev: number | null;
} {
  if (rows.length === 0) return { wmape: null, errorStdDev: null };
  const months = [...new Set(rows.map(monthKeyOf))].sort((a, b) => b - a).slice(0, PRECISION_WINDOW_MONTHS);
  const monthSet = new Set(months);
  const latestByScope = new Map<string, SkuAccuracySampleRow>();
  for (const row of rows) {
    if (!monthSet.has(monthKeyOf(row))) continue;
    const scope = `${row.station}|${row.platform}|${monthKeyOf(row)}`;
    const prev = latestByScope.get(scope);
    const ts = row.computedAt ? new Date(row.computedAt).getTime() : 0;
    const prevTs = prev?.computedAt ? new Date(prev.computedAt).getTime() : 0;
    if (!prev || ts > prevTs) latestByScope.set(scope, row);
  }

  let absErrorSum = 0;
  let actualSum = 0;
  const errors: number[] = [];
  for (const row of latestByScope.values()) {
    const forecast = Number(row.forecastDailyAvg);
    const actual = Number(row.actualDailyAvg);
    if (!Number.isFinite(forecast) || !Number.isFinite(actual)) continue;
    if (actual <= 0 || forecast <= 0) continue;
    absErrorSum += Math.abs(forecast - actual);
    actualSum += actual;
    errors.push(forecast - actual);
  }
  let errorStdDev: number | null = null;
  if (errors.length >= 2) {
    const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    const variance =
      errors.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (errors.length - 1);
    errorStdDev = Math.sqrt(variance);
  }
  return {
    wmape: actualSum > 0 ? absErrorSum / actualSum : null,
    errorStdDev,
  };
}

/** 还原日均触及封顶（UNCONSTRAIN_CAP_RATIO × 当前日均，留 1% 容差）视为需人工确认 */
export function isDemandReconstructCapHit(input: {
  source?: string | null;
  unconstrainedDaily?: number | null;
  avgDaily: number;
}): boolean {
  if (input.source !== 'reconstructed_shape') return false;
  if (input.unconstrainedDaily == null || !Number.isFinite(input.unconstrainedDaily)) return false;
  return input.unconstrainedDaily > input.avgDaily * (UNCONSTRAIN_CAP_RATIO - 0.01);
}

/** 90 天还原窗口内的缺货天数 */
export function stockoutDaysFromInStockRatio(ratio: number | string | null | undefined): number | null {
  if (ratio == null || ratio === '') return null;
  const value = Number(ratio);
  if (!Number.isFinite(value)) return null;
  return Math.round((1 - value) * 90);
}

export type DemandGateInput = {
  reconstructCapHit?: boolean;
  unconstrainedDaily?: number | null;
  stockoutDays?: number | null;
  /** 最近已结算月 WMAPE（0–1） */
  recentWmape?: number | null;
  segment?: ProfileSegment | null;
  band?: HorizonBand;
};

export type DemandGateResult = {
  needsManualConfirm: boolean;
  flags: string[];
  demandUnconstrainedDaily: number | null;
  demandStockoutDays: number | null;
  demandCapped: boolean;
};

export function evaluateDemandGate(input: DemandGateInput): DemandGateResult {
  const flags: string[] = [];
  const demandCapped = input.reconstructCapHit === true;
  if (demandCapped) flags.push('reconstruct_capped');

  const band = input.band ?? 'precision';
  if (input.segment == null) {
    flags.push('segment_missing');
  } else if (input.recentWmape == null) {
    flags.push('accuracy_missing');
  } else {
    const status = isKpiMet(input.segment, band, input.recentWmape);
    if (status === 'fail') flags.push('wmape_fail');
    else if (status === 'warn') flags.push('wmape_warn');
  }

  const needsManualConfirm =
    flags.includes('reconstruct_capped') ||
    flags.includes('wmape_fail') ||
    flags.includes('segment_missing') ||
    flags.includes('accuracy_missing');

  return {
    needsManualConfirm,
    flags,
    demandUnconstrainedDaily:
      input.unconstrainedDaily == null ? null : Number(input.unconstrainedDaily),
    demandStockoutDays: input.stockoutDays == null ? null : Number(input.stockoutDays),
    demandCapped,
  };
}

/** 默认可采纳：未打人工确认标记 */
export function isAutoAdoptableSuggestion(metrics: Record<string, unknown> | null | undefined): boolean {
  if (!metrics) return true;
  return metrics.needsManualConfirm !== true;
}
