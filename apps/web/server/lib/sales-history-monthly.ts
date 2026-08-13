import { and, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { db, salesHistory, salesHistoryMonthly, skus } from '@scm/db';
import type { SkuMonthlySalesRow } from './sales-report-parser.js';
import { loadSkuCategoryMap, resolveSkuCategoryFromMaster } from './sku-category.js';
import { daysInCalendarMonth, roundDaily } from './forecast-baseline.js';
import { normalizeSalesPlatformSync } from './sales-platform.js';
import { channelsForPlatformFilterSync } from './sales-platform.js';
import { yieldToEventLoop } from './yield-event-loop.js';

/** 月表批量 upsert 时 SKU IN 列表上限，避免超长 SQL */
const MONTHLY_UPSERT_SKU_CHUNK = 2000;

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

/** 日表最早日期晚于该月 1 号时，该月已被裁剪，不能用残日表覆盖月表。 */
export function shouldAggregateCalendarMonth(
  saleYear: number,
  month: number,
  dailyMinDate: string | null,
): boolean {
  if (!dailyMinDate) return false;
  return monthStartDate(saleYear, month) >= dailyMinDate;
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
  const dateConditions: SQL[] = [];
  if (!useAllHistory) {
    const cutoff = subtractMonths(new Date(), lookbackMonths);
    cutoffDate = monthStartDate(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1);
    dateConditions.push(gte(salesHistory.saleDate, cutoffDate));
  }

  const minBase = db
    .select({ minDate: sql<string | null>`min(${salesHistory.saleDate})::text` })
    .from(salesHistory);
  const [dailyMinRow] = await (dateConditions.length
    ? minBase.where(and(...dateConditions))
    : minBase);
  const dailyMinDate = dailyMinRow?.minDate ?? null;
  if (!dailyMinDate) {
    return {
      upsertedRows: 0,
      lookbackMonths: useAllHistory ? -1 : lookbackMonths,
      cutoffDate: useAllHistory ? 'all' : cutoffDate,
    };
  }

  const monthComplete = sql`make_date(extract(year from ${salesHistory.saleDate}::date)::int, extract(month from ${salesHistory.saleDate}::date)::int, 1) >= ${dailyMinDate}::date`;
  const skuIds = input?.skuIds?.length ? Array.from(new Set(input.skuIds)) : null;
  const skuChunks: Array<string[] | null> = skuIds
    ? chunkSkuIds(skuIds, MONTHLY_UPSERT_SKU_CHUNK)
    : [null];

  let upsertedRows = 0;
  for (const skuChunk of skuChunks) {
    const filters: SQL[] = [...dateConditions, monthComplete];
    if (skuChunk) {
      filters.push(inArray(salesHistory.skuId, skuChunk));
    }
    upsertedRows += await upsertMonthlySalesFromDailyWhere(and(...filters)!);
    await yieldToEventLoop();
  }

  return {
    upsertedRows,
    lookbackMonths: useAllHistory ? -1 : lookbackMonths,
    cutoffDate: useAllHistory ? 'all' : cutoffDate,
  };
}

function chunkSkuIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += size) {
    chunks.push(ids.slice(offset, offset + size));
  }
  return chunks;
}

async function upsertMonthlySalesFromDailyWhere(where: SQL): Promise<number> {
  const result = await db.execute(sql`
    WITH upserted AS (
      INSERT INTO sales_history_monthly (
        sku_id, channel, sale_year, month, qty_sold, category, source, updated_at
      )
      SELECT
        ${salesHistory.skuId},
        coalesce(${salesHistory.channel}, 'UNKNOWN'),
        extract(year from ${salesHistory.saleDate}::date)::int,
        extract(month from ${salesHistory.saleDate}::date)::int,
        sum(${salesHistory.qtySold})::int,
        ${skus.category},
        'import',
        now()
      FROM ${salesHistory}
      INNER JOIN ${skus} ON ${skus.id} = ${salesHistory.skuId}
      WHERE ${where}
      GROUP BY 1, 2, 3, 4, ${skus.category}
      ON CONFLICT (sku_id, channel, sale_year, month)
      DO UPDATE SET
        qty_sold = EXCLUDED.qty_sold,
        category = EXCLUDED.category,
        updated_at = now()
      RETURNING 1
    )
    SELECT count(*)::int AS upserted FROM upserted
  `);
  const rows = Array.from(result as unknown as Array<{ upserted: number }>);
  return Number(rows[0]?.upserted ?? 0);
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
