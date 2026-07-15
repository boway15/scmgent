import { db, salesForecastSeasonality, salesForecastSourceBatches, salesHistoryMonthly, skus } from '@scm/db';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import {
  buildMonthlyForecastHorizon,
  clipCombinedSeasonality,
} from './forecast-baseline.js';
import { computeSeasonalityFactorAtAnchor } from './forecast-collaboration.js';
import { buildMonthlyTrendRowsFromSkuMonthly } from './forecast-seasonality-rebuild.js';
import { MAX_FORECAST_MONTH_COUNT } from './forecast-limits.js';

export type SeasonalityHorizonCell = {
  forecastYear: number;
  month: number;
  monthLabel: string;
  calendarMonth: number;
  seasonalityFactor: number;
  trendFactor: number;
  combinedFactor: number;
  wasClipped: boolean;
};

export type SeasonalityHorizonRow = {
  dimensionType: 'category' | 'project_group';
  dimensionValue: string;
  months: SeasonalityHorizonCell[];
  historyMonths: SeasonalityHorizonCell[];
};

export type SeasonalityHorizonResult = {
  horizon: Array<{ forecastYear: number; month: number; monthLabel: string; calendarMonth: number }>;
  historyHorizon: Array<{ forecastYear: number; month: number; monthLabel: string; calendarMonth: number }>;
  items: SeasonalityHorizonRow[];
  total: number;
  page: number;
  pageSize: number;
  sourceBatch: {
    id: string;
    batchNo: string;
    monthlyStartMonth: string | null;
    monthlyEndMonth: string | null;
    skuCount: number | null;
    rowCount: number | null;
    createdAt: string;
  } | null;
};

function monthLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function numericOrZero(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function buildHorizonCellsForDimension(
  factorsByCalendarMonth: Map<number, { seasonalityFactor: number; trendFactor: number }>,
  monthCount = 12,
  today = new Date(),
): SeasonalityHorizonCell[] {
  const horizon = buildMonthlyForecastHorizon(today, monthCount);

  return horizon.map((h) => {
    const hit = factorsByCalendarMonth.get(h.month) ?? { seasonalityFactor: 1, trendFactor: 1 };
    const seasonalityFactor = hit.seasonalityFactor;
    const trendFactor = hit.trendFactor;
    const rawCombined = seasonalityFactor * trendFactor;
    const clipped = clipCombinedSeasonality(rawCombined);

    return {
      forecastYear: h.forecastYear,
      month: h.month,
      monthLabel: monthLabel(h.forecastYear, h.month),
      calendarMonth: h.month,
      seasonalityFactor,
      trendFactor,
      combinedFactor: clipped.factor,
      wasClipped: clipped.wasClipped,
    };
  });
}

/** 按绝对月回溯测算历史系数（不含 asOf 当月；当月归入未来地平线） */
export function buildHistoricalCellsForDimension(
  qtyByMonth: Map<string, number>,
  monthCount = 12,
  asOf = new Date(),
): SeasonalityHorizonCell[] {
  const safeCount = Math.max(1, Math.floor(monthCount));
  const cells: SeasonalityHorizonCell[] = [];
  let y = asOf.getUTCFullYear();
  let m = asOf.getUTCMonth() + 1;

  // 历史不含当月，从上月开始回溯
  m -= 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }

  for (let index = 0; index < safeCount; index++) {
    const atAnchor = computeSeasonalityFactorAtAnchor(qtyByMonth, y, m);
    cells.unshift({
      forecastYear: y,
      month: m,
      monthLabel: monthLabel(y, m),
      calendarMonth: m,
      ...atAnchor,
    });

    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }

  return cells;
}

function buildHistoryHorizonLabels(monthCount: number, asOf = new Date()) {
  const cells = buildHistoricalCellsForDimension(new Map(), monthCount, asOf);
  return cells.map((cell) => ({
    forecastYear: cell.forecastYear,
    month: cell.month,
    monthLabel: cell.monthLabel,
    calendarMonth: cell.calendarMonth,
  }));
}

async function loadQtyByMonthForDimensions(
  dimensions: Array<{ dimensionType: 'category' | 'project_group'; dimensionValue: string }>,
): Promise<Map<string, Map<string, number>>> {
  if (!dimensions.length) return new Map();

  const dimensionSet = new Set(
    dimensions.map((dim) => `${dim.dimensionType}::${dim.dimensionValue}`),
  );

  const monthlyRows = await db
    .select({
      category: salesHistoryMonthly.category,
      saleYear: salesHistoryMonthly.saleYear,
      month: salesHistoryMonthly.month,
      qtySold: salesHistoryMonthly.qtySold,
    })
    .from(salesHistoryMonthly)
    .innerJoin(skus, eq(skus.id, salesHistoryMonthly.skuId));

  const trendRows = buildMonthlyTrendRowsFromSkuMonthly(monthlyRows);
  const result = new Map<string, Map<string, number>>();

  for (const row of trendRows) {
    const key = `${row.dimensionType}::${row.dimensionValue}`;
    if (!dimensionSet.has(key)) continue;

    const byMonth = result.get(key) ?? new Map<string, number>();
    byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + row.qtySold);
    result.set(key, byMonth);
  }

  return result;
}

export async function listSeasonalityHorizon(input: {
  dimensionType?: 'category' | 'project_group';
  search?: string;
  page?: number;
  pageSize?: number;
  monthCount?: number;
  historyMonthCount?: number;
  asOf?: Date;
}): Promise<SeasonalityHorizonResult> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const monthCount = Math.min(MAX_FORECAST_MONTH_COUNT, Math.max(1, input.monthCount ?? 12));
  const historyMonthCount = Math.min(36, Math.max(0, input.historyMonthCount ?? 12));
  const asOf = input.asOf ?? new Date();
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (input.dimensionType) {
    conditions.push(eq(salesForecastSeasonality.dimensionType, input.dimensionType));
  }
  if (input.search?.trim()) {
    conditions.push(ilike(salesForecastSeasonality.dimensionValue, `%${input.search.trim()}%`));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [dimensionRows, countRow, factorRows, latestBatch] = await Promise.all([
    db
      .select({
        dimensionType: salesForecastSeasonality.dimensionType,
        dimensionValue: salesForecastSeasonality.dimensionValue,
      })
      .from(salesForecastSeasonality)
      .where(where)
      .groupBy(salesForecastSeasonality.dimensionType, salesForecastSeasonality.dimensionValue)
      .orderBy(salesForecastSeasonality.dimensionType, salesForecastSeasonality.dimensionValue)
      .limit(pageSize)
      .offset(offset),
    db
      .select({
        count: sql<number>`count(distinct (${salesForecastSeasonality.dimensionType}, ${salesForecastSeasonality.dimensionValue}))::int`,
      })
      .from(salesForecastSeasonality)
      .where(where),
    db
      .select({
        dimensionType: salesForecastSeasonality.dimensionType,
        dimensionValue: salesForecastSeasonality.dimensionValue,
        month: salesForecastSeasonality.month,
        seasonalityFactor: salesForecastSeasonality.seasonalityFactor,
        trendFactor: salesForecastSeasonality.trendFactor,
      })
      .from(salesForecastSeasonality)
      .where(where),
    db
      .select({
        id: salesForecastSourceBatches.id,
        batchNo: salesForecastSourceBatches.batchNo,
        monthlyStartMonth: salesForecastSourceBatches.monthlyStartMonth,
        monthlyEndMonth: salesForecastSourceBatches.monthlyEndMonth,
        skuCount: salesForecastSourceBatches.skuCount,
        rowCount: salesForecastSourceBatches.rowCount,
        createdAt: salesForecastSourceBatches.createdAt,
      })
      .from(salesForecastSourceBatches)
      .orderBy(desc(salesForecastSourceBatches.createdAt))
      .limit(1),
  ]);

  const factorsByDimension = new Map<
    string,
    Map<number, { seasonalityFactor: number; trendFactor: number }>
  >();

  for (const row of factorRows) {
    const key = `${row.dimensionType}::${row.dimensionValue}`;
    const byMonth = factorsByDimension.get(key) ?? new Map();
    byMonth.set(row.month, {
      seasonalityFactor: numericOrZero(row.seasonalityFactor),
      trendFactor: numericOrZero(row.trendFactor) || 1,
    });
    factorsByDimension.set(key, byMonth);
  }

  const qtyByDimension =
    historyMonthCount > 0 ? await loadQtyByMonthForDimensions(dimensionRows) : new Map();

  const horizon = buildMonthlyForecastHorizon(asOf, monthCount).map((h) => ({
    forecastYear: h.forecastYear,
    month: h.month,
    monthLabel: monthLabel(h.forecastYear, h.month),
    calendarMonth: h.month,
  }));

  const historyHorizon =
    historyMonthCount > 0 ? buildHistoryHorizonLabels(historyMonthCount, asOf) : [];

  const items: SeasonalityHorizonRow[] = dimensionRows.map((dim) => {
    const key = `${dim.dimensionType}::${dim.dimensionValue}`;
    const byMonth = factorsByDimension.get(key) ?? new Map();
    const qtyByMonth = qtyByDimension.get(key) ?? new Map();

    return {
      dimensionType: dim.dimensionType,
      dimensionValue: dim.dimensionValue,
      months: buildHorizonCellsForDimension(byMonth, monthCount, asOf),
      historyMonths:
        historyMonthCount > 0
          ? buildHistoricalCellsForDimension(qtyByMonth, historyMonthCount, asOf)
          : [],
    };
  });

  const batch = latestBatch[0];
  return {
    horizon,
    historyHorizon,
    items,
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
    sourceBatch: batch
      ? {
          id: batch.id,
          batchNo: batch.batchNo,
          monthlyStartMonth: batch.monthlyStartMonth,
          monthlyEndMonth: batch.monthlyEndMonth,
          skuCount: batch.skuCount,
          rowCount: batch.rowCount,
          createdAt: batch.createdAt.toISOString(),
        }
      : null,
  };
}
