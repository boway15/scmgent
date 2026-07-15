/**
 * 日表 + 月表双轨查询：动销明细走日表（带日期窗口），长周期走月表。
 */
import { and, eq, gte, inArray, lte, or, sql, isNull } from 'drizzle-orm';
import { db, salesHistory, salesHistoryMonthly } from '@scm/db';
import {
  replenishmentSalesLookbackDays,
  salesHistoryLookbackCutoff,
} from './sales-history-config.js';
import { channelsForPlatformFilter } from './sales-platform.js';

export type DailySalesPoint = {
  skuId: string;
  qtySold: number;
  saleDate: string;
  warehouseCode: string | null;
};

const SKU_IN_CHUNK = 2000;

function normalizeSaleDate(value: string | Date): string {
  return String(value).slice(0, 10);
}

export function groupDailySalesBySkuId(rows: DailySalesPoint[]): Map<string, DailySalesPoint[]> {
  const map = new Map<string, DailySalesPoint[]>();
  for (const row of rows) {
    const list = map.get(row.skuId) ?? [];
    list.push(row);
    map.set(row.skuId, list);
  }
  return map;
}

/** 批量加载多个 SKU 的近 N 日日销量（补货/健康任务用，单次或分块查询）。 */
export async function loadDailySalesBySkuIds(
  skuIds: string[],
  lookbackDays = replenishmentSalesLookbackDays(),
): Promise<Map<string, DailySalesPoint[]>> {
  if (!skuIds.length) return new Map();

  const cutoff = salesHistoryLookbackCutoff(lookbackDays);
  const map = new Map<string, DailySalesPoint[]>();

  for (let offset = 0; offset < skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const rows = await db
      .select({
        skuId: salesHistory.skuId,
        qtySold: salesHistory.qtySold,
        saleDate: salesHistory.saleDate,
        warehouseCode: salesHistory.warehouseCode,
      })
      .from(salesHistory)
      .where(and(inArray(salesHistory.skuId, chunk), gte(salesHistory.saleDate, cutoff)));

    for (const row of rows) {
      const point: DailySalesPoint = {
        skuId: row.skuId,
        qtySold: row.qtySold,
        saleDate: normalizeSaleDate(row.saleDate),
        warehouseCode: row.warehouseCode,
      };
      const list = map.get(row.skuId) ?? [];
      list.push(point);
      map.set(row.skuId, list);
    }
  }

  return map;
}

async function platformChannelCondition(platform: string) {
  if (platform === 'ALL') return null;
  const aliases = await channelsForPlatformFilter(platform);
  return aliases.length === 1 ? eq(salesHistory.channel, aliases[0]) : inArray(salesHistory.channel, aliases);
}

async function platformMonthlyChannelCondition(platform: string) {
  if (platform === 'ALL') return null;
  const aliases = await channelsForPlatformFilter(platform);
  return aliases.length === 1
    ? eq(salesHistoryMonthly.channel, aliases[0])
    : inArray(salesHistoryMonthly.channel, aliases);
}

function monthStartFromYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** 批量加载多个 SKU 在日期范围内的日销量（预测生成用）。 */
export async function loadDailySalesBySkuIdsInRange(input: {
  skuIds: string[];
  fromDate: string;
  toDate: string;
  platform: string;
}): Promise<Map<string, DailySalesPoint[]>> {
  const map = new Map<string, DailySalesPoint[]>();
  if (!input.skuIds.length) return map;

  const platformCond = await platformChannelCondition(input.platform);

  for (let offset = 0; offset < input.skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = input.skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const conditions = [
      inArray(salesHistory.skuId, chunk),
      gte(salesHistory.saleDate, input.fromDate),
      lte(salesHistory.saleDate, input.toDate),
    ];
    if (platformCond) conditions.push(platformCond);

    const rows = await db
      .select({
        skuId: salesHistory.skuId,
        qtySold: salesHistory.qtySold,
        saleDate: salesHistory.saleDate,
        warehouseCode: salesHistory.warehouseCode,
      })
      .from(salesHistory)
      .where(and(...conditions));

    for (const row of rows) {
      const point: DailySalesPoint = {
        skuId: row.skuId,
        qtySold: row.qtySold,
        saleDate: normalizeSaleDate(row.saleDate),
        warehouseCode: row.warehouseCode,
      };
      const list = map.get(row.skuId) ?? [];
      list.push(point);
      map.set(row.skuId, list);
    }
  }

  return map;
}

/** 批量加载 SKU 月销量（预测同比用）。 */
export async function loadMonthlySalesBySkuIds(input: {
  skuIds: string[];
  platform: string;
  minYear: number;
  minMonth: number;
  maxYear?: number;
  maxMonth?: number;
}): Promise<Map<string, Array<{ saleYear: number; month: number; qtySold: number }>>> {
  const map = new Map<string, Array<{ saleYear: number; month: number; qtySold: number }>>();
  if (!input.skuIds.length) return map;

  const platformCond = await platformMonthlyChannelCondition(input.platform);

  for (let offset = 0; offset < input.skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = input.skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const conditions = [
      inArray(salesHistoryMonthly.skuId, chunk),
      sql`(${salesHistoryMonthly.saleYear} > ${input.minYear} OR (${salesHistoryMonthly.saleYear} = ${input.minYear} AND ${salesHistoryMonthly.month} >= ${input.minMonth}))`,
    ];
    if (platformCond) conditions.push(platformCond);
    if (input.maxYear != null && input.maxMonth != null) {
      conditions.push(
        sql`(${salesHistoryMonthly.saleYear} < ${input.maxYear} OR (${salesHistoryMonthly.saleYear} = ${input.maxYear} AND ${salesHistoryMonthly.month} <= ${input.maxMonth}))`,
      );
    }

    const rows = await db
      .select({
        skuId: salesHistoryMonthly.skuId,
        saleYear: salesHistoryMonthly.saleYear,
        month: salesHistoryMonthly.month,
        qtySold: salesHistoryMonthly.qtySold,
      })
      .from(salesHistoryMonthly)
      .where(and(...conditions));

    for (const row of rows) {
      const list = map.get(row.skuId) ?? [];
      list.push({
        saleYear: row.saleYear,
        month: row.month,
        qtySold: Number(row.qtySold),
      });
      map.set(row.skuId, list);
    }
  }

  return map;
}

/** 批量解析 SKU 首销日。 */
export async function loadFirstSaleDateBySkuIds(input: {
  skuIds: string[];
  platform: string;
  station?: string;
  warehouseCodesForStation?: string[];
}): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (!input.skuIds.length) return result;

  for (const skuId of input.skuIds) {
    result.set(skuId, null);
  }

  const platformCond = await platformChannelCondition(input.platform);

  for (let offset = 0; offset < input.skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = input.skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const dailyConditions = [inArray(salesHistory.skuId, chunk)];
    if (platformCond) dailyConditions.push(platformCond);
    if (input.station && input.warehouseCodesForStation?.length) {
      dailyConditions.push(
        or(
          isNull(salesHistory.warehouseCode),
          inArray(salesHistory.warehouseCode, input.warehouseCodesForStation),
        )!,
      );
    }

    const dailyMins = await db
      .select({
        skuId: salesHistory.skuId,
        minDate: sql<string | null>`min(${salesHistory.saleDate})::text`,
      })
      .from(salesHistory)
      .where(and(...dailyConditions))
      .groupBy(salesHistory.skuId);

    for (const row of dailyMins) {
      if (row.minDate) {
        const existing = result.get(row.skuId);
        const candidate = normalizeSaleDate(row.minDate);
        if (!existing || candidate < existing) {
          result.set(row.skuId, candidate);
        }
      }
    }
  }

  const monthlyPlatformCond = await platformMonthlyChannelCondition(input.platform);
  for (let offset = 0; offset < input.skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = input.skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const monthlyConditions = [inArray(salesHistoryMonthly.skuId, chunk)];
    if (monthlyPlatformCond) monthlyConditions.push(monthlyPlatformCond);

    const monthlyFirst = await db
      .select({
        skuId: salesHistoryMonthly.skuId,
        saleYear: salesHistoryMonthly.saleYear,
        month: salesHistoryMonthly.month,
      })
      .from(salesHistoryMonthly)
      .where(and(...monthlyConditions))
      .orderBy(salesHistoryMonthly.skuId, salesHistoryMonthly.saleYear, salesHistoryMonthly.month);

    let lastSkuId = '';
    for (const row of monthlyFirst) {
      if (row.skuId === lastSkuId) continue;
      lastSkuId = row.skuId;
      const candidate = monthStartFromYearMonth(row.saleYear, row.month);
      const existing = result.get(row.skuId);
      if (!existing || candidate < existing) {
        result.set(row.skuId, candidate);
      }
    }
  }

  return result;
}

/** 单 SKU 近 N 日日销量。 */
export async function loadDailySalesForSku(
  skuId: string,
  lookbackDays = replenishmentSalesLookbackDays(),
): Promise<DailySalesPoint[]> {
  const map = await loadDailySalesBySkuIds([skuId], lookbackDays);
  return map.get(skuId) ?? [];
}

/** 从月表取首销月（长周期）；日表取近端精确值，二者取更早日期。 */
export async function resolveSkuFirstSaleDate(input: {
  skuId: string;
  platform: string;
  station?: string;
  warehouseCodesForStation?: string[];
}): Promise<string | null> {
  const dailyConditions = [eq(salesHistory.skuId, input.skuId)];
  const platformCond = await platformChannelCondition(input.platform);
  if (platformCond) dailyConditions.push(platformCond);
  if (input.station && input.warehouseCodesForStation?.length) {
    const codes = input.warehouseCodesForStation;
    dailyConditions.push(
      or(
        isNull(salesHistory.warehouseCode),
        inArray(salesHistory.warehouseCode, codes),
      )!,
    );
  }

  const [dailyMin] = await db
    .select({ minDate: sql<string | null>`min(${salesHistory.saleDate})::text` })
    .from(salesHistory)
    .where(and(...dailyConditions));

  const monthlyConditions = [eq(salesHistoryMonthly.skuId, input.skuId)];
  const monthlyPlatformCond = await platformMonthlyChannelCondition(input.platform);
  if (monthlyPlatformCond) monthlyConditions.push(monthlyPlatformCond);

  const [monthlyFirst] = await db
    .select({
      saleYear: salesHistoryMonthly.saleYear,
      month: salesHistoryMonthly.month,
    })
    .from(salesHistoryMonthly)
    .where(and(...monthlyConditions))
    .orderBy(salesHistoryMonthly.saleYear, salesHistoryMonthly.month)
    .limit(1);

  const candidates: string[] = [];
  if (dailyMin?.minDate) candidates.push(normalizeSaleDate(dailyMin.minDate));
  if (monthlyFirst) {
    candidates.push(monthStartFromYearMonth(monthlyFirst.saleYear, monthlyFirst.month));
  }

  if (!candidates.length) return null;
  return candidates.sort((a, b) => a.localeCompare(b))[0];
}

/** 月表：某 SKU 在日期范围内的月销量行（预测协作、同比）。 */
export async function loadMonthlySalesInRange(input: {
  skuId: string;
  platform: string;
  minYear: number;
  minMonth: number;
  maxYear?: number;
  maxMonth?: number;
}): Promise<Array<{ saleYear: number; month: number; qtySold: number }>> {
  const conditions = [
    eq(salesHistoryMonthly.skuId, input.skuId),
    sql`(${salesHistoryMonthly.saleYear} > ${input.minYear} OR (${salesHistoryMonthly.saleYear} = ${input.minYear} AND ${salesHistoryMonthly.month} >= ${input.minMonth}))`,
  ];
  const monthlyPlatformCond = await platformMonthlyChannelCondition(input.platform);
  if (monthlyPlatformCond) conditions.push(monthlyPlatformCond);
  if (input.maxYear != null && input.maxMonth != null) {
    conditions.push(
      sql`(${salesHistoryMonthly.saleYear} < ${input.maxYear} OR (${salesHistoryMonthly.saleYear} = ${input.maxYear} AND ${salesHistoryMonthly.month} <= ${input.maxMonth}))`,
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

/** 日表：某 SKU 在日期范围内的日销量（协作近端窗口）。 */
export async function loadDailySalesInRange(input: {
  skuId: string;
  platform: string;
  fromDate: string;
  toDate: string;
}): Promise<Array<{ saleDate: string; qtySold: number; warehouseCode: string | null }>> {
  const conditions = [
    eq(salesHistory.skuId, input.skuId),
    gte(salesHistory.saleDate, input.fromDate),
    lte(salesHistory.saleDate, input.toDate),
  ];
  const platformCond = await platformChannelCondition(input.platform);
  if (platformCond) conditions.push(platformCond);

  const rows = await db
    .select({
      saleDate: salesHistory.saleDate,
      qtySold: salesHistory.qtySold,
      warehouseCode: salesHistory.warehouseCode,
    })
    .from(salesHistory)
    .where(and(...conditions));

  return rows.map((row) => ({
    saleDate: normalizeSaleDate(row.saleDate),
    qtySold: row.qtySold,
    warehouseCode: row.warehouseCode,
  }));
}
