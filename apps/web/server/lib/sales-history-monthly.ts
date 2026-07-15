import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db, salesHistory, salesHistoryMonthly } from '@scm/db';
import type { SkuMonthlySalesRow } from './sales-report-parser.js';
import { loadSkuCategoryMap, resolveSkuCategoryFromMaster } from './sku-category.js';
import { daysInCalendarMonth, roundDaily } from './forecast-baseline.js';
import { normalizeSalesPlatformSync } from './sales-platform.js';
import { channelsForPlatformFilterSync } from './sales-platform.js';

export const DEFAULT_MONTHLY_HISTORY_LOOKBACK_MONTHS = 36;

export type MonthlySalesQtyRow = {
  saleYear: number;
  month: number;
  qtySold: number;
};

export type MonthlyAggregateStats = {
  upsertedRows: number;
  lookbackMonths: number;
  cutoffDate: string;
};

function monthStartDate(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function subtractMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
}

export function buildCompletedCalendarMonths(count: number, today = new Date()): Array<{
  year: number;
  month: number;
}> {
  const safeCount = Math.max(0, Math.floor(count));
  const months: Array<{ year: number; month: number }> = [];

  for (let index = 1; index <= safeCount; index++) {
    const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - index, 1));
    months.push({
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
    });
  }

  return months.reverse();
}

/** 使 buildMonthlyForecastHorizon(asOf, monthCount) 覆盖最近 monthCount 个已完成自然月 */
export function computeWalkForwardAsOf(monthCount: number, today = new Date()): string {
  const months = buildCompletedCalendarMonths(monthCount, today);
  if (months.length === 0) {
    return today.toISOString().slice(0, 10);
  }
  const first = months[0];
  return `${first.year}-${String(first.month).padStart(2, '0')}-01`;
}

export function monthlyQtyFromRows(
  rows: MonthlySalesQtyRow[],
  year: number,
  month: number,
): number {
  return rows.reduce((sum, row) => {
    return row.saleYear === year && row.month === month ? sum + row.qtySold : sum;
  }, 0);
}

export function monthlyDailyAvgFromRows(
  rows: MonthlySalesQtyRow[],
  year: number,
  month: number,
): number {
  const total = monthlyQtyFromRows(rows, year, month);
  if (total <= 0) return 0;
  return roundDaily(total / daysInCalendarMonth(year, month));
}

export async function aggregateSalesHistoryMonthlyFromDaily(input?: {
  lookbackMonths?: number | 'all';
  skuIds?: string[];
}): Promise<MonthlyAggregateStats> {
  const useAllHistory = input?.lookbackMonths === 'all';
  const lookbackMonths =
    useAllHistory || input?.lookbackMonths == null
      ? DEFAULT_MONTHLY_HISTORY_LOOKBACK_MONTHS
      : input.lookbackMonths;

  let cutoffDate = '';
  const conditions = [];
  if (!useAllHistory) {
    const cutoff = subtractMonths(new Date(), lookbackMonths);
    cutoffDate = monthStartDate(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1);
    conditions.push(gte(salesHistory.saleDate, cutoffDate));
  }
  if (input?.skuIds && input.skuIds.length > 0) {
    conditions.push(inArray(salesHistory.skuId, input.skuIds));
  }

  const baseQuery = db
    .select({
      skuId: salesHistory.skuId,
      channel: sql<string>`coalesce(${salesHistory.channel}, 'UNKNOWN')`,
      saleYear: sql<number>`extract(year from ${salesHistory.saleDate}::date)::int`,
      month: sql<number>`extract(month from ${salesHistory.saleDate}::date)::int`,
      qtySold: sql<number>`sum(${salesHistory.qtySold})::int`,
    })
    .from(salesHistory);

  const grouped = await (conditions.length
    ? baseQuery.where(and(...conditions))
    : baseQuery
  ).groupBy(
      salesHistory.skuId,
      sql`coalesce(${salesHistory.channel}, 'UNKNOWN')`,
      sql`extract(year from ${salesHistory.saleDate}::date)`,
      sql`extract(month from ${salesHistory.saleDate}::date)`,
    );

  let upsertedRows = 0;
  const skuIds = Array.from(new Set(grouped.map((row) => row.skuId)));
  const categoryBySkuId = await loadSkuCategoryMap(skuIds);

  for (const row of grouped) {
    await db
      .insert(salesHistoryMonthly)
      .values({
        skuId: row.skuId,
        channel: row.channel,
        saleYear: row.saleYear,
        month: row.month,
        qtySold: row.qtySold,
        category: resolveSkuCategoryFromMaster(categoryBySkuId, row.skuId),
        source: 'import',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          salesHistoryMonthly.skuId,
          salesHistoryMonthly.channel,
          salesHistoryMonthly.saleYear,
          salesHistoryMonthly.month,
        ],
        set: {
          qtySold: row.qtySold,
          category: resolveSkuCategoryFromMaster(categoryBySkuId, row.skuId),
          updatedAt: new Date(),
        },
      });
    upsertedRows++;
  }

  return {
    upsertedRows,
    lookbackMonths: useAllHistory ? -1 : lookbackMonths,
    cutoffDate: useAllHistory ? 'all' : cutoffDate,
  };
}

export async function persistSkuMonthlySalesRows(
  rows: SkuMonthlySalesRow[],
  importBatchId: string,
  skuIdByCode: Map<string, string>,
): Promise<{
  upsertedRows: number;
  unmatchedSkuCount: number;
  errors: string[];
}> {
  const unmatchedSkuCodes = new Set<string>();
  const planned = new Map<string, { skuId: string; channel: string; saleYear: number; month: number; qtySold: number }>();

  for (const row of rows) {
    const skuCode = row.skuCode.trim();
    if (!skuCode) continue;

    const skuId = skuIdByCode.get(skuCode);
    if (!skuId) {
      unmatchedSkuCodes.add(skuCode);
      continue;
    }

    const channel = normalizeSalesPlatformSync(row.platformRaw);
    const key = `${skuId}::${channel}::${row.saleYear}::${row.month}`;
    const existing = planned.get(key);
    if (existing) {
      existing.qtySold += row.qtySold;
    } else {
      planned.set(key, {
        skuId,
        channel,
        saleYear: row.saleYear,
        month: row.month,
        qtySold: row.qtySold,
      });
    }
  }

  let upsertedRows = 0;
  const categoryBySkuId = await loadSkuCategoryMap(
    Array.from(new Set(Array.from(planned.values()).map((row) => row.skuId))),
  );

  for (const row of planned.values()) {
    await db
      .insert(salesHistoryMonthly)
      .values({
        skuId: row.skuId,
        channel: row.channel,
        saleYear: row.saleYear,
        month: row.month,
        qtySold: row.qtySold,
        category: resolveSkuCategoryFromMaster(categoryBySkuId, row.skuId),
        source: 'import',
        importBatchId,
      })
      .onConflictDoUpdate({
        target: [
          salesHistoryMonthly.skuId,
          salesHistoryMonthly.channel,
          salesHistoryMonthly.saleYear,
          salesHistoryMonthly.month,
        ],
        set: {
          qtySold: row.qtySold,
          category: resolveSkuCategoryFromMaster(categoryBySkuId, row.skuId),
          importBatchId,
          updatedAt: new Date(),
        },
      });
    upsertedRows++;
  }

  return {
    upsertedRows,
    unmatchedSkuCount: unmatchedSkuCodes.size,
    errors: Array.from(unmatchedSkuCodes)
      .sort((a, b) => a.localeCompare(b))
      .map((skuCode) => `SKU could not be matched for monthly sales row: ${skuCode}`),
  };
}

export async function loadSkuMonthlySalesRows(
  skuId: string,
  platform: string,
  lookbackMonths = DEFAULT_MONTHLY_HISTORY_LOOKBACK_MONTHS,
): Promise<MonthlySalesQtyRow[]> {
  const cutoff = subtractMonths(new Date(), lookbackMonths);
  const minYear = cutoff.getUTCFullYear();
  const minMonth = cutoff.getUTCMonth() + 1;

  const conditions = [
    eq(salesHistoryMonthly.skuId, skuId),
    sql`(${salesHistoryMonthly.saleYear} > ${minYear} OR (${salesHistoryMonthly.saleYear} = ${minYear} AND ${salesHistoryMonthly.month} >= ${minMonth}))`,
  ];
  if (platform !== 'ALL') {
    const aliases = channelsForPlatformFilterSync(platform);
    conditions.push(
      aliases.length === 1
        ? eq(salesHistoryMonthly.channel, aliases[0]!)
        : inArray(salesHistoryMonthly.channel, aliases),
    );
  }

  const rows = await db
    .select({
      saleYear: salesHistoryMonthly.saleYear,
      month: salesHistoryMonthly.month,
      qtySold: salesHistoryMonthly.qtySold,
    })
    .from(salesHistoryMonthly)
    .where(and(...conditions));

  return rows.map((row) => ({
    saleYear: row.saleYear,
    month: row.month,
    qtySold: Number(row.qtySold),
  }));
}

export async function resolveActualMonthlyDailyAvg(input: {
  skuId: string;
  channel?: string;
  year: number;
  month: number;
}): Promise<{ actualDaily: number; source: 'daily' | 'monthly' | 'none' }> {
  const monthStart = monthStartDate(input.year, input.month);
  const monthEnd = new Date(input.year, input.month, 0).toISOString().slice(0, 10);
  const dim = daysInCalendarMonth(input.year, input.month);

  const dailyConditions = [
    eq(salesHistory.skuId, input.skuId),
    gte(salesHistory.saleDate, monthStart),
    lte(salesHistory.saleDate, monthEnd),
  ];
  if (input.channel && input.channel !== 'ALL') {
    dailyConditions.push(eq(salesHistory.channel, input.channel));
  }

  const [dailyAgg] = await db
    .select({ totalQty: sql<number>`coalesce(sum(${salesHistory.qtySold}), 0)::int` })
    .from(salesHistory)
    .where(and(...dailyConditions));

  const dailyTotal = dailyAgg?.totalQty ?? 0;
  if (dailyTotal > 0) {
    return { actualDaily: dailyTotal / dim, source: 'daily' };
  }

  const monthlyConditions = [
    eq(salesHistoryMonthly.skuId, input.skuId),
    eq(salesHistoryMonthly.saleYear, input.year),
    eq(salesHistoryMonthly.month, input.month),
  ];
  if (input.channel && input.channel !== 'ALL') {
    monthlyConditions.push(eq(salesHistoryMonthly.channel, input.channel));
  }

  const [monthlyRow] = await db
    .select({ qtySold: salesHistoryMonthly.qtySold })
    .from(salesHistoryMonthly)
    .where(and(...monthlyConditions))
    .limit(1);

  const monthlyTotal = monthlyRow?.qtySold ?? 0;
  if (monthlyTotal > 0) {
    return { actualDaily: monthlyTotal / dim, source: 'monthly' };
  }

  return { actualDaily: 0, source: 'none' };
}

export async function getMonthlySalesCoverageStats(): Promise<{
  rowCount: number;
  skuCount: number;
  startMonth: string | null;
  endMonth: string | null;
}> {
  const [summary] = await db
    .select({
      rowCount: sql<number>`count(*)::int`,
      skuCount: sql<number>`count(distinct ${salesHistoryMonthly.skuId})::int`,
      minYear: sql<number | null>`min(${salesHistoryMonthly.saleYear})`,
      minMonth: sql<number | null>`min(${salesHistoryMonthly.month})`,
      maxYear: sql<number | null>`max(${salesHistoryMonthly.saleYear})`,
      maxMonth: sql<number | null>`max(${salesHistoryMonthly.month})`,
    })
    .from(salesHistoryMonthly);

  const formatMonth = (year: number | null, month: number | null) => {
    if (year == null || month == null) return null;
    return `${year}-${String(month).padStart(2, '0')}`;
  };

  return {
    rowCount: summary?.rowCount ?? 0,
    skuCount: summary?.skuCount ?? 0,
    startMonth: formatMonth(summary?.minYear ?? null, summary?.minMonth ?? null),
    endMonth: formatMonth(summary?.maxYear ?? null, summary?.maxMonth ?? null),
  };
}
