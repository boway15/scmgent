/**
 * 周需求计划准确度：计划周 vs 实销日均（有实销的周才出误差列）。
 */
import { buildCsv } from './csv-export.js';
import {
  buildWeeklyActualFromDaily,
  type DemandPlanSkuWeeklyActual,
} from './demand-plan-sku-detail.js';
import {
  isoWeekKeyFromUtcDate,
  isoWeekMondayUtc,
  maxSaleDateKey,
  planningAssumedSalesCutoff,
  planningRecentWindowEnd,
} from './planning-calendar.js';
import { loadDailySalesBySkuIdsInRange } from './sales-history-query.js';

export const DEMAND_PLAN_ACCURACY_EXPORT_MAX_SKUS = 5_000;

export type DemandPlanAccuracyPlanRow = {
  skuId: string;
  skuCode: string;
  period: string;
  systemDailyAvg: string;
  manualDailyAvg: string | null;
};

export type DemandPlanAccuracyWeekRow = {
  skuId: string;
  skuCode: string;
  period: string;
  systemDailyAvg: number | null;
  manualDailyAvg: number | null;
  effectiveDailyAvg: number;
  actualDailyAvg: number | null;
  absError: number | null;
  inProgress: boolean;
  note: string;
};

export type DemandPlanAccuracySkuSummary = {
  skuId: string;
  skuCode: string;
  comparedWeeks: number;
  mae: number | null;
  wmape: number | null;
  absErrorSum: number;
  actualSum: number;
};

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function toNum(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function effectiveDaily(row: DemandPlanAccuracyPlanRow): number {
  const manual = toNum(row.manualDailyAvg);
  if (manual != null) return manual;
  return toNum(row.systemDailyAvg) ?? 0;
}

export async function buildDemandPlanAccuracyRows(input: {
  planRows: DemandPlanAccuracyPlanRow[];
  asOf?: Date;
  maxSkus?: number;
}): Promise<{
  weekRows: DemandPlanAccuracyWeekRow[];
  skuSummaries: DemandPlanAccuracySkuSummary[];
  skuCount: number;
  comparedWeekCount: number;
}> {
  const asOf = input.asOf ?? new Date();
  const maxSkus = Math.min(
    Math.max(1, input.maxSkus ?? DEMAND_PLAN_ACCURACY_EXPORT_MAX_SKUS),
    DEMAND_PLAN_ACCURACY_EXPORT_MAX_SKUS,
  );

  const bySku = new Map<string, { skuCode: string; rows: DemandPlanAccuracyPlanRow[] }>();
  for (const row of input.planRows) {
    const bucket = bySku.get(row.skuId) ?? { skuCode: row.skuCode, rows: [] };
    bucket.rows.push(row);
    bySku.set(row.skuId, bucket);
  }

  const skuIds = [...bySku.keys()].slice(0, maxSkus);
  if (!skuIds.length) {
    return { weekRows: [], skuSummaries: [], skuCount: 0, comparedWeekCount: 0 };
  }

  const periods = [
    ...new Set(skuIds.flatMap((skuId) => (bySku.get(skuId)?.rows ?? []).map((row) => row.period))),
  ].sort();
  if (!periods.length) {
    return { weekRows: [], skuSummaries: [], skuCount: skuIds.length, comparedWeekCount: 0 };
  }

  const assumedEnd = planningAssumedSalesCutoff(asOf);
  const salesFromKey = isoWeekMondayUtc(periods[0]!).toISOString().slice(0, 10);
  const assumedEndKey = assumedEnd.toISOString().slice(0, 10);
  const dailyBySku = await loadDailySalesBySkuIdsInRange({
    skuIds,
    fromDate: salesFromKey,
    toDate: assumedEndKey,
    platform: 'ALL',
  });

  const weekRows: DemandPlanAccuracyWeekRow[] = [];
  const skuSummaries: DemandPlanAccuracySkuSummary[] = [];
  let comparedWeekCount = 0;

  for (const skuId of skuIds) {
    const bucket = bySku.get(skuId);
    if (!bucket) continue;
    const dailyRows = (dailyBySku.get(skuId) ?? []).map((row) => ({
      saleDate: row.saleDate,
      qtySold: row.qtySold,
    }));
    const windowEnd = planningRecentWindowEnd(asOf, {
      maxSaleDate: maxSaleDateKey(dailyRows),
    });
    const windowEndKey = windowEnd.toISOString().slice(0, 10);
    const clipped = dailyRows.filter((row) => String(row.saleDate).slice(0, 10) <= windowEndKey);
    const weekKeys = [...new Set(bucket.rows.map((row) => row.period))].sort();
    const actualByWeek = new Map<string, DemandPlanSkuWeeklyActual>(
      buildWeeklyActualFromDaily({
        weekKeys,
        dailyRows: clipped,
        windowEnd,
      }).map((row) => [row.weekKey, row]),
    );

    let absErrorSum = 0;
    let actualSum = 0;
    let comparedWeeks = 0;

    for (const row of bucket.rows.sort((a, b) => a.period.localeCompare(b.period))) {
      const actual = actualByWeek.get(row.period);
      const effective = effectiveDaily(row);
      const system = toNum(row.systemDailyAvg);
      const manual = toNum(row.manualDailyAvg);
      const actualDaily = actual?.actualDailyAvg ?? null;
      const hasActual = actualDaily != null;
      const absErr = hasActual ? round4(Math.abs(effective - actualDaily)) : null;
      const note =
        !hasActual && actual && row.period > isoWeekKeyFromUtcDate(windowEnd)
          ? '未来周无实销'
          : !hasActual
            ? '无实销'
            : '';
      weekRows.push({
        skuId,
        skuCode: bucket.skuCode,
        period: row.period,
        systemDailyAvg: system,
        manualDailyAvg: manual,
        effectiveDailyAvg: effective,
        actualDailyAvg: actualDaily,
        absError: absErr,
        inProgress: actual?.inProgress ?? false,
        note,
      });
      if (hasActual && absErr != null) {
        comparedWeeks += 1;
        comparedWeekCount += 1;
        absErrorSum += absErr;
        actualSum += Math.abs(actualDaily);
      }
    }

    skuSummaries.push({
      skuId,
      skuCode: bucket.skuCode,
      comparedWeeks,
      mae: comparedWeeks > 0 ? round4(absErrorSum / comparedWeeks) : null,
      wmape: actualSum > 0 ? round4(absErrorSum / actualSum) : null,
      absErrorSum: round4(absErrorSum),
      actualSum: round4(actualSum),
    });
  }

  return { weekRows, skuSummaries, skuCount: skuIds.length, comparedWeekCount };
}

export async function buildDemandPlanAccuracyExportCsv(input: {
  planRows: DemandPlanAccuracyPlanRow[];
  asOf?: Date;
  maxSkus?: number;
}): Promise<{ csv: string; rowCount: number; skuCount: number }> {
  const built = await buildDemandPlanAccuracyRows(input);
  const headers = [
    'SKU',
    '绝对周',
    '系统日均',
    '人工日均',
    '生效日均',
    '实销日均',
    '绝对误差',
    '进行中',
    '备注',
  ];
  const outRows = built.weekRows.map((row) => [
    row.skuCode,
    row.period,
    row.systemDailyAvg != null ? row.systemDailyAvg.toFixed(2) : '',
    row.manualDailyAvg != null ? row.manualDailyAvg.toFixed(2) : '',
    row.effectiveDailyAvg.toFixed(2),
    row.actualDailyAvg != null ? row.actualDailyAvg.toFixed(2) : '',
    row.absError != null ? row.absError.toFixed(2) : '',
    row.inProgress ? 'Y' : '',
    row.note,
  ]);

  return {
    csv: buildCsv(headers, outRows),
    rowCount: outRows.length,
    skuCount: built.skuCount,
  };
}

export function paginateDemandPlanAccuracySkuSummaries(
  summaries: DemandPlanAccuracySkuSummary[],
  page: number,
  pageSize: number,
): { items: DemandPlanAccuracySkuSummary[]; total: number; page: number; pageSize: number } {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(100, Math.max(1, pageSize));
  const start = (safePage - 1) * safeSize;
  return {
    items: summaries.slice(start, start + safeSize),
    total: summaries.length,
    page: safePage,
    pageSize: safeSize,
  };
}
