import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { eq, and } from 'drizzle-orm';
import { db, salesForecastMonthly, skus, forecastAccuracyMonthly, warehouses } from '@scm/db';
import {
  buildMonthlyForecastHorizon,
  classifySalesLifecycle,
  daysInCalendarMonth,
  effectiveRecentWindowEnd,
  roundDaily,
  type SalesLifecycle,
} from './forecast-baseline.js';
import { formatForecastMonth, stationForWarehouse } from './forecast-demand.js';
import { forecastPlatformCondition } from './forecast-platform-scope.js';
import {
  computeAgeDaysFromFirstSale,
  filterSalesRowsByStation,
  generateBaselineForecastVersion,
  prepareWalkForwardVersion,
} from './forecast-collaboration.js';
import { unconstrainMonthQty, sumQtyInWindow } from './forecast-demand-unconstrain.js';
import {
  loadDailySalesBySkuIdsInRange,
  loadFirstSaleDateBySkuIds,
} from './sales-history-query.js';
import {
  computeForecastAccuracyForMonth,
  summarizeForecastAccuracy,
  listForecastAccuracy,
  type ForecastAccuracySummary,
} from './forecast-accuracy.js';
import {
  summarizeAccuracyByTier,
  filterTierSummary,
  computeSignedMapeVsActual,
  computeWeightedMape,
  type AccuracyTierSummary,
} from './forecast-accuracy-tier.js';
import { resolveActualMonthlyDailyAvg } from './sales-history-monthly.js';
import { horizonBandFromIndex, horizonMonthIndex } from './forecast-horizon-band.js';
import { getKpiTarget, isKpiMet } from './forecast-kpi-targets.js';
import { segmentLabel, type ProfileSegment } from './forecast-profile-class.js';
import { isAllCatV41KpiComparableTier } from './forecast-allcat-v41.js';

const WALK_FORWARD_KPI_TIERS = ['T1', 'T2', 'T3', 'T3P', 'T4A'] as const;

export type WalkForwardMonthTierRow = {
  forecastYear: number;
  month: number;
  profileSegment?: string | null;
  forecastDaily: number;
  actualDaily: number;
};

function fmtBiasPct(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
}

export type WalkForwardMonthTierStat = {
  forecastYear: number;
  month: number;
  monthLabel: string;
  profileSegment: string;
  profileSegmentLabel: string;
  comparableRows: number;
  mape: number | null;
  wmape: number | null;
};

function toMonthTierAccuracyInputs(rows: WalkForwardMonthTierRow[]) {
  return rows.map((row) => ({
    skuCode: '',
    actualDaily: row.actualDaily,
    forecastDaily: row.forecastDaily,
    mape: null,
    biasRate: null,
    profileSegment: row.profileSegment ?? undefined,
  }));
}

/** 走步总结：按月份 × V4.1 KPI 分层汇总单月 MAPE / WMAPE */
export function buildWalkForwardMonthTierSummary(
  rows: WalkForwardMonthTierRow[],
  monthOrder: Array<{ forecastYear: number; month: number; monthLabel: string }>,
): WalkForwardMonthTierStat[] {
  const stats: WalkForwardMonthTierStat[] = [];
  for (const m of monthOrder) {
    for (const tier of WALK_FORWARD_KPI_TIERS) {
      const sub = rows.filter(
        (row) =>
          row.forecastYear === m.forecastYear &&
          row.month === m.month &&
          row.profileSegment === tier &&
          row.actualDaily > 0,
      );
      if (!sub.length) continue;
      const inputs = toMonthTierAccuracyInputs(sub);
      stats.push({
        forecastYear: m.forecastYear,
        month: m.month,
        monthLabel: m.monthLabel,
        profileSegment: tier,
        profileSegmentLabel: segmentLabel(tier),
        comparableRows: sub.length,
        mape: computeSignedMapeVsActual(inputs),
        wmape: computeWeightedMape(inputs),
      });
    }
  }
  return stats;
}

/** @deprecated 使用 buildWalkForwardMonthTierSummary + 表格展示 */
export function formatWalkForwardMonthTierSummaryLines(
  rows: WalkForwardMonthTierRow[],
  monthOrder: Array<{ forecastYear: number; month: number; monthLabel: string }>,
): string[] {
  const lines = ['分月分层统计（单月 MAPE = Σ(预测−实际)/Σ实际，T1–T4A KPI 可比）：'];
  for (const stat of buildWalkForwardMonthTierSummary(rows, monthOrder)) {
    lines.push(
      `- ${stat.monthLabel} · ${stat.profileSegmentLabel}：可比 ${stat.comparableRows} 行 · 单月 MAPE ${fmtBiasPct(stat.mape)} · WMAPE ${fmtPctAbs(stat.wmape)}`,
    );
  }
  if (lines.length === 1) {
    for (const m of monthOrder) {
      const hasRows = rows.some(
        (row) => row.forecastYear === m.forecastYear && row.month === m.month && row.actualDaily > 0,
      );
      if (!hasRows) lines.push(`- ${m.monthLabel}：（无可比 KPI 行）`);
    }
  }
  return lines;
}

function fmtPctAbs(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function countSalesDaysInWindow(
  sales: Array<{ saleDate: string; qtySold: number }>,
  windowStart: Date,
  windowEnd: Date,
): number {
  const startKey = toDateOnly(windowStart);
  const endKey = toDateOnly(windowEnd);
  const days = new Set<string>();
  for (const row of sales) {
    const key = String(row.saleDate).slice(0, 10);
    if (key < startKey || key > endKey) continue;
    if ((Number(row.qtySold) || 0) > 0) days.add(key);
  }
  return days.size;
}

function computeMaxZeroRunDays(
  rows: Array<{ saleDate: string; qtySold: number }>,
  start: Date,
  end: Date,
): number {
  const qtyByDate = new Map(
    rows.map((row) => [String(row.saleDate).slice(0, 10), Number(row.qtySold)]),
  );
  let maxRun = 0;
  let currentRun = 0;
  for (let cursor = new Date(start); cursor <= end; cursor = addUtcDays(cursor, 1)) {
    const qty = qtyByDate.get(toDateOnly(cursor)) ?? 0;
    if (qty <= 0) {
      currentRun += 1;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  return maxRun;
}

function hasAnyDailyRows(
  dailyBySku: Map<string, Array<{ saleDate: string; qtySold: number }>>,
): boolean {
  for (const rows of dailyBySku.values()) {
    if (rows.length > 0) return true;
  }
  return false;
}

export type WalkForwardSkuUnconstrainMeta = {
  calendar90AtAsOf: number;
  lifecycle: SalesLifecycle;
  firstSaleDate?: string | null;
};

export type WalkForwardUnconstrainedWmapeStatus = 'computed' | 'skipped_no_daily';

export type WalkForwardUnconstrainedWmapeResult = {
  unconstrainedWmape: number | null;
  status: WalkForwardUnconstrainedWmapeStatus;
};

/** asOf 时日历近 90 + lifecycle，不含目标月（未来）销量。 */
export function resolveWalkForwardSkuUnconstrainMeta(input: {
  dailySales: Array<{ saleDate: string; qtySold: number }>;
  asOf: Date;
  firstSaleDate?: string | null;
}): WalkForwardSkuUnconstrainMeta {
  const recentWindowEnd = effectiveRecentWindowEnd(input.asOf);
  const recent90Since = addUtcDays(recentWindowEnd, -89);
  const recent30Since = addUtcDays(recentWindowEnd, -29);
  const calendar90AtAsOf = roundDaily(sumQtyInWindow(input.dailySales, recent90Since, recentWindowEnd) / 90);
  const calendar30AtAsOf = roundDaily(sumQtyInWindow(input.dailySales, recent30Since, recentWindowEnd) / 30);
  const salesDays90 = countSalesDaysInWindow(input.dailySales, recent90Since, recentWindowEnd);
  const lifecycle = classifySalesLifecycle({
    ageDays: computeAgeDaysFromFirstSale(input.firstSaleDate, input.asOf),
    salesDayRatio90: salesDays90 / 90,
    recent30DailyAvg: calendar30AtAsOf,
    recent90DailyAvg: calendar90AtAsOf,
    maxZeroRunDays: computeMaxZeroRunDays(input.dailySales, recent90Since, recentWindowEnd),
  });
  return {
    calendar90AtAsOf,
    lifecycle,
    firstSaleDate: input.firstSaleDate ?? null,
  };
}

export function computeWalkForwardUnconstrainedWmape(input: {
  rows: Array<{
    skuKey: string;
    forecastYear: number;
    month: number;
    forecastDaily: number;
    actualDaily: number;
    profileSegment?: string | null;
  }>;
  dailyBySku: Map<string, Array<{ saleDate: string; qtySold: number }>> | null | undefined;
  skuMetaByKey: Map<string, WalkForwardSkuUnconstrainMeta>;
}): WalkForwardUnconstrainedWmapeResult {
  if (!input.dailyBySku || !hasAnyDailyRows(input.dailyBySku)) {
    return { unconstrainedWmape: null, status: 'skipped_no_daily' };
  }

  const wmapeRows: Array<{
    skuCode: string;
    actualDaily: number;
    forecastDaily: number;
    mape: null;
    biasRate: null;
    profileSegment?: string;
  }> = [];
  for (const row of input.rows) {
    const dailySales = input.dailyBySku.get(row.skuKey);
    if (!dailySales?.length) continue;

    const meta = input.skuMetaByKey.get(row.skuKey);
    const skuMayUnconstrain =
      !!meta &&
      meta.calendar90AtAsOf >= 1 &&
      meta.lifecycle !== 'new' &&
      meta.lifecycle !== 'intermittent';
    const days = daysInCalendarMonth(row.forecastYear, row.month);
    const monthU = unconstrainMonthQty({
      year: row.forecastYear,
      month: row.month,
      rawQty: row.actualDaily * days,
      dailySales,
      skuMayUnconstrain,
      firstSaleDate: meta?.firstSaleDate,
    });
    const unconstrainedActualDaily = monthU.stockoutFullMonth
      ? row.actualDaily
      : monthU.cleanedQty / days;
    if (unconstrainedActualDaily <= 0) continue;

    wmapeRows.push({
      skuCode: row.skuKey,
      actualDaily: unconstrainedActualDaily,
      forecastDaily: row.forecastDaily,
      mape: null,
      biasRate: null,
      profileSegment: row.profileSegment ?? undefined,
    });
  }

  return {
    unconstrainedWmape: computeWeightedMape(wmapeRows),
    status: 'computed',
  };
}

async function loadWarehouseStationMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({
      code: warehouses.code,
      regionGroup: warehouses.regionGroup,
      countryCode: warehouses.countryCode,
    })
    .from(warehouses)
    .where(eq(warehouses.isActive, true));
  return new Map(
    rows.map((row) => [
      row.code,
      stationForWarehouse(row.regionGroup, row.countryCode).toUpperCase(),
    ]),
  );
}

/** 销量日表，不是库存 API。空结果返回 null，由调用方记 skipped_no_daily。 */
async function tryLoadWalkForwardDailyBySku(input: {
  skuIds: string[];
  asOf: Date;
  targetMonths: Array<{ forecastYear: number; month: number }>;
  station?: string;
  platform?: string;
}): Promise<{
  dailyBySku: Map<string, Array<{ saleDate: string; qtySold: number }>>;
  firstSaleBySku: Map<string, string | null>;
} | null> {
  if (!input.skuIds.length || !input.targetMonths.length) return null;

  const platform = input.platform?.trim() || 'ALL';
  const recent90Since = addUtcDays(effectiveRecentWindowEnd(input.asOf), -89);
  const lastMonth = input.targetMonths[input.targetMonths.length - 1]!;
  const lastDay = daysInCalendarMonth(lastMonth.forecastYear, lastMonth.month);
  const fromDate = toDateOnly(recent90Since);
  const toDate = `${lastMonth.forecastYear}-${String(lastMonth.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const [rawDaily, firstSaleBySku] = await Promise.all([
    loadDailySalesBySkuIdsInRange({
      skuIds: input.skuIds,
      fromDate,
      toDate,
      platform,
    }),
    loadFirstSaleDateBySkuIds({
      skuIds: input.skuIds,
      platform,
    }),
  ]);

  const warehouseStationByCode = input.station ? await loadWarehouseStationMap() : null;
  const dailyBySku = new Map<string, Array<{ saleDate: string; qtySold: number }>>();
  for (const skuId of input.skuIds) {
    const raw = rawDaily.get(skuId) ?? [];
    const filtered =
      input.station && warehouseStationByCode
        ? filterSalesRowsByStation(raw, input.station, warehouseStationByCode)
        : raw;
    dailyBySku.set(
      skuId,
      filtered.map((row) => ({ saleDate: row.saleDate, qtySold: row.qtySold })),
    );
  }

  if (!hasAnyDailyRows(dailyBySku)) return null;
  return { dailyBySku, firstSaleBySku };
}

export type WalkForwardBacktestInput = {
  /** 模拟「截至该日」只能看到的历史销量（UTC 日期 YYYY-MM-DD 或 Date） */
  asOf: string | Date;
  monthCount?: number;
  station?: string;
  platform?: string;
  skuCode?: string;
  versionName?: string;
  /** 复用同名版本并 purge 范围；默认每次新建带时间戳的独立版本 */
  replaceVersion?: boolean;
  createReviewItems?: boolean;
  exportCsvPath?: string;
  createdBy?: string;
  /** 仅过滤分层汇总输出，不改变写库范围 */
  tierFilter?: 'core' | 'mid' | 'tail' | 'all';
  /** legacy | monthly_abcd */
  algoMode?: 'legacy' | 'monthly_abcd';
};

export type WalkForwardMonthResult = {
  year: number;
  month: number;
  monthLabel: string;
  upserted: number;
  highMapeCount: number;
  skipped?: boolean;
  avgMape: number | null;
  avgBiasRate: number | null;
  comparableRows: number;
};

export function parseWalkForwardAsOf(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error(`asOf must be YYYY-MM-DD, got: ${value}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}

export function buildWalkForwardVersionName(asOf: Date, monthCount: number): string {
  const label = asOf.toISOString().slice(0, 10);
  return `WF-${label}-${monthCount}M`;
}

export function resolveWalkForwardVersionName(input: {
  asOf: Date;
  monthCount: number;
  versionName?: string;
  replaceVersion?: boolean;
}): string {
  const base = input.versionName ?? buildWalkForwardVersionName(input.asOf, input.monthCount);
  if (input.replaceVersion) return base;
  return `${base}-${Date.now()}`;
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function countForecastRowsForVersion(
  versionId: string,
  scope?: { station?: string; platform?: string },
): Promise<number> {
  const conditions = [eq(salesForecastMonthly.versionId, versionId)];
  const station = scope?.station?.trim().toUpperCase();
  if (station) conditions.push(eq(salesForecastMonthly.station, station));
  const platformCond = forecastPlatformCondition(salesForecastMonthly.platform, scope?.platform);
  if (platformCond) conditions.push(platformCond);
  const rows = await db
    .select({ id: salesForecastMonthly.id })
    .from(salesForecastMonthly)
    .where(and(...conditions));
  return rows.length;
}

async function loadWalkForwardExportRows(
  versionId: string,
  scope?: { station?: string; platform?: string },
) {
  const station = scope?.station?.trim().toUpperCase();
  const forecastConditions = [eq(salesForecastMonthly.versionId, versionId)];
  if (station) forecastConditions.push(eq(salesForecastMonthly.station, station));
  const forecastPlatformCond = forecastPlatformCondition(
    salesForecastMonthly.platform,
    scope?.platform,
  );
  if (forecastPlatformCond) forecastConditions.push(forecastPlatformCond);

  const forecastRows = await db
    .select({
      skuId: salesForecastMonthly.skuId,
      skuCode: skus.code,
      station: salesForecastMonthly.station,
      platform: salesForecastMonthly.platform,
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      profileSegment: salesForecastMonthly.profileSegment,
      horizonBand: salesForecastMonthly.horizonBand,
      forecastDailyP10: salesForecastMonthly.forecastDailyP10,
      forecastDailyP90: salesForecastMonthly.forecastDailyP90,
      forecastModel: salesForecastMonthly.forecastModel,
      forecastProfileClass: salesForecastMonthly.forecastProfileClass,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .where(and(...forecastConditions))
    .orderBy(skus.code, salesForecastMonthly.forecastYear, salesForecastMonthly.month);

  const accuracyConditions = [eq(forecastAccuracyMonthly.versionId, versionId)];
  if (station) accuracyConditions.push(eq(forecastAccuracyMonthly.station, station));
  const accuracyPlatformCond = forecastPlatformCondition(
    forecastAccuracyMonthly.platform,
    scope?.platform,
  );
  if (accuracyPlatformCond) accuracyConditions.push(accuracyPlatformCond);

  const accuracyRows = await db
    .select({
      skuCode: skus.code,
      station: forecastAccuracyMonthly.station,
      platform: forecastAccuracyMonthly.platform,
      forecastYear: forecastAccuracyMonthly.forecastYear,
      month: forecastAccuracyMonthly.month,
      actualDailyAvg: forecastAccuracyMonthly.actualDailyAvg,
      biasRate: forecastAccuracyMonthly.biasRate,
      mape: forecastAccuracyMonthly.mape,
    })
    .from(forecastAccuracyMonthly)
    .innerJoin(skus, eq(skus.id, forecastAccuracyMonthly.skuId))
    .where(and(...accuracyConditions));

  const accuracyKey = (row: {
    skuCode: string;
    station: string;
    platform: string;
    forecastYear: number;
    month: number;
  }) => `${row.skuCode}|${row.station}|${row.platform}|${row.forecastYear}|${row.month}`;

  const accuracyByKey = new Map(
    accuracyRows.map((row) => [
      accuracyKey(row),
      {
        actualDailyAvg: Number(row.actualDailyAvg),
        biasRate: row.biasRate != null ? Number(row.biasRate) : null,
        mape: row.mape != null ? Number(row.mape) : null,
      },
    ]),
  );

  return forecastRows.map((row) => {
    const acc = accuracyByKey.get(accuracyKey(row));
    return {
      ...row,
      forecastDailyAvg: Number(row.forecastDailyAvg),
      actualDailyAvg: acc?.actualDailyAvg ?? null,
      biasRate: acc?.biasRate ?? null,
      mape: acc?.mape ?? null,
      profileSegment: (row.profileSegment as ProfileSegment | null) ?? null,
      forecastDailyP10: row.forecastDailyP10 != null ? Number(row.forecastDailyP10) : null,
      forecastDailyP90: row.forecastDailyP90 != null ? Number(row.forecastDailyP90) : null,
    };
  });
}

export async function exportWalkForwardCsv(
  versionId: string,
  filePath: string,
  meta?: { asOf: string; monthCount: number; station?: string; platform?: string },
): Promise<number> {
  const rows = await loadWalkForwardExportRows(versionId, {
    station: meta?.station,
    platform: meta?.platform,
  });
  await mkdir(dirname(filePath), { recursive: true });

  const asOfDate = meta?.asOf ? parseWalkForwardAsOf(meta.asOf) : new Date();

  const header = [
    'sku_code',
    'station',
    'platform',
    'month_label',
    'forecast_daily_avg',
    'actual_daily_avg',
    'bias_rate',
    'mape',
    'profile_segment',
    'segment_label',
    'horizon_band',
    'forecast_daily_p10',
    'forecast_daily_p90',
    'forecast_model',
    'kpi_target',
    'kpi_status',
    'ghost_row',
    'classification_source',
  ];
  const lines = [header.join(',')];
  if (meta) {
    lines.unshift(`# walkforward asOf=${meta.asOf} monthCount=${meta.monthCount}`);
  }

  for (const row of rows) {
    const segment = row.profileSegment ?? 'A:mid';
    const band =
      (row.horizonBand as ReturnType<typeof horizonBandFromIndex> | null) ??
      horizonBandFromIndex(horizonMonthIndex(row.forecastYear, row.month, asOfDate));
    const actual = row.actualDailyAvg;
    const wmape =
      actual != null && actual > 0
        ? Math.abs(row.forecastDailyAvg - actual) / actual
        : null;
    const kpiTarget = getKpiTarget(segment, band);
    const kpiStatus = isKpiMet(segment, band, wmape);
    const ghostRow = actual != null && actual === 0 && row.forecastDailyAvg > 0 ? 1 : 0;
    lines.push(
      [
        csvEscape(row.skuCode),
        csvEscape(row.station),
        csvEscape(row.platform),
        csvEscape(formatForecastMonth(row.forecastYear, row.month)),
        csvEscape(row.forecastDailyAvg),
        csvEscape(actual),
        csvEscape(row.biasRate),
        csvEscape(row.mape),
        csvEscape(segment),
        csvEscape(segmentLabel(segment)),
        csvEscape(band),
        csvEscape(row.forecastDailyP10),
        csvEscape(row.forecastDailyP90),
        csvEscape(row.forecastModel),
        csvEscape(kpiTarget != null ? `${(kpiTarget * 100).toFixed(0)}%` : ''),
        csvEscape(kpiStatus),
        csvEscape(ghostRow),
        csvEscape('persisted'),
      ].join(','),
    );
  }

  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return rows.length;
}

async function summarizeMonthAccuracy(
  versionId: string,
  year: number,
  month: number,
  scope?: { station?: string; platform?: string },
): Promise<{ avgMape: number | null; avgBiasRate: number | null; comparableRows: number }> {
  const conditions = [
    eq(forecastAccuracyMonthly.versionId, versionId),
    eq(forecastAccuracyMonthly.forecastYear, year),
    eq(forecastAccuracyMonthly.month, month),
  ];
  const station = scope?.station?.trim().toUpperCase();
  if (station) conditions.push(eq(forecastAccuracyMonthly.station, station));
  const platformCond = forecastPlatformCondition(forecastAccuracyMonthly.platform, scope?.platform);
  if (platformCond) conditions.push(platformCond);

  const rows = await db
    .select({
      mape: forecastAccuracyMonthly.mape,
      biasRate: forecastAccuracyMonthly.biasRate,
      actualDailyAvg: forecastAccuracyMonthly.actualDailyAvg,
      forecastDailyAvg: forecastAccuracyMonthly.forecastDailyAvg,
    })
    .from(forecastAccuracyMonthly)
    .where(and(...conditions));

  const comparable = rows.filter((row) => Number(row.actualDailyAvg) > 0);
  if (!comparable.length) {
    return { avgMape: null, avgBiasRate: null, comparableRows: 0 };
  }

  const mapeSum = comparable.reduce((sum, row) => sum + Number(row.mape ?? 0), 0);
  const biasVsActual = computeSignedMapeVsActual(
    comparable.map((row) => ({
      skuCode: '',
      actualDaily: Number(row.actualDailyAvg),
      forecastDaily: Number(row.forecastDailyAvg),
      mape: row.mape != null ? Number(row.mape) : null,
      biasRate: row.biasRate != null ? Number(row.biasRate) : null,
    })),
  );
  return {
    avgMape: roundDaily(mapeSum / comparable.length),
    avgBiasRate: biasVsActual != null ? roundDaily(biasVsActual) : null,
    comparableRows: comparable.length,
  };
}

function assertWalkForwardRowCounts(input: {
  forecastRows: number;
  csvRows: number;
  accuracyComparable: number;
  skippedComparable: number;
}) {
  if (input.forecastRows !== input.csvRows) {
    throw new Error(
      `走步回测行数不一致：forecastRows=${input.forecastRows} csvRows=${input.csvRows}`,
    );
  }
  const expectedAccuracy = input.forecastRows - input.skippedComparable;
  if (input.accuracyComparable !== expectedAccuracy) {
    throw new Error(
      `走步准确率行数不一致：accuracy=${input.accuracyComparable} expected=${expectedAccuracy} (forecast=${input.forecastRows} skipped=${input.skippedComparable})`,
    );
  }
}

/**
 * 走步回测：在 asOf 截止的历史销量下重跑 v2 生成，再与目标月实际日均对比写入准确率表。
 */
export async function runWalkForwardAccuracyBacktest(input: WalkForwardBacktestInput) {
  const asOf = parseWalkForwardAsOf(input.asOf);
  const monthCount = Math.min(24, Math.max(1, Math.floor(input.monthCount ?? 6)));
  const station = input.station?.trim().toUpperCase();
  const platform = input.platform?.trim() || undefined;
  const replaceVersion = input.replaceVersion ?? false;
  const baseVersionName = input.versionName ?? buildWalkForwardVersionName(asOf, monthCount);
  const versionName = replaceVersion
    ? baseVersionName
    : resolveWalkForwardVersionName({
        asOf,
        monthCount,
        versionName: input.versionName,
        replaceVersion: false,
      });
  const targetMonths = buildMonthlyForecastHorizon(asOf, monthCount);

  const existingVersionId = await prepareWalkForwardVersion({
    versionName: baseVersionName,
    station,
    platform,
    createdBy: input.createdBy,
    replaceVersion,
  });

  const generated = await generateBaselineForecastVersion({
    station: input.station,
    platform: input.platform,
    skuCode: input.skuCode,
    versionName,
    monthCount,
    today: asOf,
    createdBy: input.createdBy,
    forceNewVersion: !replaceVersion,
    existingVersionId,
    algoMode: input.algoMode,
  });

  const versionId = generated.version.id;

  const monthResults: WalkForwardMonthResult[] = [];
  let totalUpserted = 0;
  let totalHighMapeCount = 0;
  const scope = { station, platform };

  for (const { forecastYear, month } of targetMonths) {
    const result = await computeForecastAccuracyForMonth(forecastYear, month, {
      versionId,
      createReviewItems: input.createReviewItems ?? false,
      station,
      platform,
    });
    const stats = await summarizeMonthAccuracy(versionId, forecastYear, month, scope);
    monthResults.push({
      year: forecastYear,
      month,
      monthLabel: formatForecastMonth(forecastYear, month),
      upserted: result.upserted,
      highMapeCount: result.highMapeCount,
      skipped: result.skipped,
      ...stats,
    });
    totalUpserted += result.upserted;
    totalHighMapeCount += result.highMapeCount;
  }

  const asOfLabel = asOf.toISOString().slice(0, 10);
  const csvPath =
    input.exportCsvPath ??
    `walkforward-${asOfLabel}-${monthCount}m.csv`;
  const csvRows = await exportWalkForwardCsv(versionId, csvPath, {
    asOf: asOfLabel,
    monthCount,
    station,
    platform,
  });

  const exportRows = await loadWalkForwardExportRows(versionId, scope);
  const skippedStats = exportRows.filter((row) => {
    if (Number(row.forecastDailyAvg) <= 0) return true;
    return row.actualDailyAvg == null;
  }).length;

  const accuracyConditions = [eq(forecastAccuracyMonthly.versionId, versionId)];
  if (station) accuracyConditions.push(eq(forecastAccuracyMonthly.station, station));
  const accuracyPlatformCond = forecastPlatformCondition(
    forecastAccuracyMonthly.platform,
    platform,
  );
  if (accuracyPlatformCond) accuracyConditions.push(accuracyPlatformCond);
  const accuracyDbRows = await db
    .select({ id: forecastAccuracyMonthly.id })
    .from(forecastAccuracyMonthly)
    .where(and(...accuracyConditions));
  const accuracyComparable = accuracyDbRows.length;

  const forecastRowCount = await countForecastRowsForVersion(versionId, scope);
  assertWalkForwardRowCounts({
    forecastRows: forecastRowCount,
    csvRows,
    accuracyComparable,
    skippedComparable: skippedStats,
  });

  const accuracyRows = exportRows
    .filter((row) => row.actualDailyAvg != null)
    .map((row) => ({
      skuCode: row.skuCode,
      skuId: row.skuId,
      actualDaily: row.actualDailyAvg ?? 0,
      forecastDaily: row.forecastDailyAvg,
      mape: row.mape,
      biasRate: row.biasRate,
      forecastYear: row.forecastYear,
      month: row.month,
      profileSegment: row.profileSegment ?? undefined,
      forecastDailyP10: row.forecastDailyP10,
      forecastDailyP90: row.forecastDailyP90,
    }));

  let tierSummary: AccuracyTierSummary = summarizeAccuracyByTier(accuracyRows);
  const segmentSummary: ForecastAccuracySummary = await summarizeForecastAccuracy({
    versionId,
    asOf,
    station,
    platform,
  });
  if (input.tierFilter && input.tierFilter !== 'all') {
    tierSummary = filterTierSummary(tierSummary, input.tierFilter);
  }

  const monthTierRows: WalkForwardMonthTierRow[] = accuracyRows
    .filter((row) => row.actualDaily > 0 && isAllCatV41KpiComparableTier(row.profileSegment))
    .map((row) => ({
      forecastYear: row.forecastYear!,
      month: row.month!,
      profileSegment: row.profileSegment,
      forecastDaily: row.forecastDaily,
      actualDaily: row.actualDaily,
    }));

  const dRiskForecastRows = exportRows.filter(
    (row) => row.profileSegment === 'T4B' && row.forecastDailyAvg > 0,
  ).length;
  const t99ForecastRows = exportRows.filter(
    (row) => row.profileSegment === 'T99' && row.forecastDailyAvg > 0,
  ).length;

  const monthTierSummary = buildWalkForwardMonthTierSummary(
    monthTierRows,
    targetMonths.map((m) => ({
      forecastYear: m.forecastYear,
      month: m.month,
      monthLabel: formatForecastMonth(m.forecastYear, m.month),
    })),
  );

  const accuracyList = await listForecastAccuracy({
    versionId,
    station,
    platform,
    page: 1,
    pageSize: 20,
  });

  const skuIds = [...new Set(exportRows.map((row) => row.skuId).filter(Boolean))];
  const dailyLoaded = await tryLoadWalkForwardDailyBySku({
    skuIds,
    asOf,
    targetMonths,
    station,
    platform,
  });
  let unconstrainedWmape: number | null = null;
  let unconstrainedWmapeStatus: WalkForwardUnconstrainedWmapeStatus = 'skipped_no_daily';
  if (dailyLoaded) {
    const skuMetaByKey = new Map<string, WalkForwardSkuUnconstrainMeta>();
    for (const skuId of skuIds) {
      skuMetaByKey.set(
        skuId,
        resolveWalkForwardSkuUnconstrainMeta({
          dailySales: dailyLoaded.dailyBySku.get(skuId) ?? [],
          asOf,
          firstSaleDate: dailyLoaded.firstSaleBySku.get(skuId) ?? null,
        }),
      );
    }
    const unconstrained = computeWalkForwardUnconstrainedWmape({
      rows: accuracyRows
        .filter((row) => row.actualDaily > 0 && isAllCatV41KpiComparableTier(row.profileSegment))
        .map((row) => ({
          skuKey: row.skuId,
          forecastYear: row.forecastYear!,
          month: row.month!,
          forecastDaily: row.forecastDaily,
          actualDaily: row.actualDaily,
          profileSegment: row.profileSegment,
        })),
      dailyBySku: dailyLoaded.dailyBySku,
      skuMetaByKey,
    });
    unconstrainedWmape = unconstrained.unconstrainedWmape;
    unconstrainedWmapeStatus = unconstrained.status;
  }
  const unconstrainedWmapeLine =
    unconstrainedWmapeStatus === 'skipped_no_daily'
      ? 'unconstrainedWmape: skipped_no_daily'
      : `unconstrainedWmape: ${fmtPctAbs(unconstrainedWmape)}`;

  const summary = [
    '【走步回测】',
    `截止日 asOf：${asOfLabel}`,
    `预测月数：${monthCount}（${targetMonths.map((m) => formatForecastMonth(m.forecastYear, m.month)).join('、')}）`,
    `影子版本：${generated.version.versionName}（${versionId}）`,
    `预测行：${forecastRowCount} · 准确率统计：${accuracyComparable} · CSV：${csvRows}`,
    '统计口径：全部预测>0 行（含 T4B / ghost）；分月分层摘要仍仅展示 T1–T4A 主 KPI',
    generated.eligibilityStats
      ? `准入：${generated.eligibilityStats.eligible} SKU · 跳过：${generated.eligibilityStats.skipped}`
      : '',
    dRiskForecastRows > 0 || t99ForecastRows > 0
      ? `非 KPI 层：T4B 保底 ${dRiskForecastRows} 行 · T99 不预测 ${t99ForecastRows} 行（不计入准确率）`
      : '',
    unconstrainedWmapeLine,
    '',
    `CSV 导出：${csvRows} 行 → ${csvPath}`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  return {
    asOf: asOfLabel,
    monthCount,
    version: generated.version,
    forecastRows: forecastRowCount,
    reviewRows: generated.reviewRows,
    eligibilityStats: generated.eligibilityStats,
    targetMonthLabels: targetMonths.map((m) => formatForecastMonth(m.forecastYear, m.month)),
    monthResults,
    totalUpserted,
    totalHighMapeCount,
    csvPath,
    csvRows,
    tierSummary,
    segmentSummary,
    classificationSource: segmentSummary.classificationSource,
    dGhostCount: 0,
    accuracyList,
    monthTierSummary,
    unconstrainedWmape,
    wmapeVsUnconstrainedDemand: unconstrainedWmape,
    unconstrainedWmapeStatus,
    summary,
  };
}

/** 快速抽样：对比单 SKU 在目标月的预测 vs 实际（不写库） */
export async function previewWalkForwardSkuMonth(input: {
  versionId: string;
  skuCode: string;
  station: string;
  platform: string;
  year: number;
  month: number;
}) {
  const [forecastRow] = await db
    .select({
      skuId: salesForecastMonthly.skuId,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .where(
      and(
        eq(salesForecastMonthly.versionId, input.versionId),
        eq(skus.code, input.skuCode),
        eq(salesForecastMonthly.station, input.station),
        eq(salesForecastMonthly.platform, input.platform),
        eq(salesForecastMonthly.forecastYear, input.year),
        eq(salesForecastMonthly.month, input.month),
      ),
    )
    .limit(1);

  if (!forecastRow) {
    return null;
  }

  const forecastDaily = Number(forecastRow.forecastDailyAvg);
  const { actualDaily, source } = await resolveActualMonthlyDailyAvg({
    skuId: forecastRow.skuId,
    channel: input.platform,
    year: input.year,
    month: input.month,
  });
  const mape =
    actualDaily > 0 ? roundDaily(Math.abs(actualDaily - forecastDaily) / actualDaily) : null;
  const biasRate = forecastDaily > 0 ? roundDaily((actualDaily - forecastDaily) / forecastDaily) : 0;

  return {
    monthLabel: formatForecastMonth(input.year, input.month),
    forecastDaily,
    actualDaily,
    actualSource: source,
    mape,
    biasRate,
  };
}
