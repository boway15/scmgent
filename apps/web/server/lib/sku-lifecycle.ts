/**
 * SKU 生命周期：按销量自动计算（与预测 classifySalesLifecycle 同口径）。
 * 写入 skus.lifecycle 为中文标签，便于总览/主数据筛选展示。
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db, salesHistory, skus } from '@scm/db';
import {
  classifySalesLifecycle,
  type SalesLifecycle,
  type SalesLifecycleInput,
} from './forecast-baseline.js';
import { computeAgeDaysFromFirstSale } from './forecast-collaboration.js';

export const SKU_LIFECYCLE_LABEL: Record<SalesLifecycle, string> = {
  mature: '成熟',
  growth: '增长',
  decline: '下滑',
  new: '新品',
  intermittent: '间歇',
  stockout_suspected: '疑似断货',
};

export function labelForSalesLifecycle(code: SalesLifecycle): string {
  return SKU_LIFECYCLE_LABEL[code];
}

/** 纯函数：销量指标 → skus.lifecycle 展示值；无有效销量信号时返回 null（默认为空） */
export function computeSkuLifecycleLabel(input: SalesLifecycleInput): string | null {
  // 无首销、无近窗销量：保持空，不默认「新品」
  if (
    input.ageDays <= 0 &&
    input.recent30DailyAvg <= 0 &&
    input.recent90DailyAvg <= 0 &&
    input.salesDayRatio90 <= 0
  ) {
    return null;
  }
  return labelForSalesLifecycle(classifySalesLifecycle(input));
}

export function computeSkuLifecycleLabelFromDailySales(
  dailyRows: Array<{ saleDate: string; qtySold: number }>,
  options?: { today?: Date; firstSaleDate?: string | null },
): string | null {
  const today = options?.today ?? new Date();
  const recentWindowEnd = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const recent30Since = addDays(recentWindowEnd, -29);
  const recent90Since = addDays(recentWindowEnd, -89);

  const firstSaleDate =
    options?.firstSaleDate ??
    (dailyRows.length
      ? dailyRows.reduce(
          (min, row) => {
            const d = String(row.saleDate).slice(0, 10);
            return !min || d < min ? d : min;
          },
          null as string | null,
        )
      : null);

  if (!firstSaleDate && dailyRows.every((row) => Number(row.qtySold) <= 0)) {
    return null;
  }

  const recent30DailyAvg = roundDaily(sumQtySince(dailyRows, recent30Since) / 30);
  const recent90DailyAvg = roundDaily(sumQtySince(dailyRows, recent90Since) / 90);
  const salesDays90 = countSalesDaysSince(dailyRows, recent90Since);
  const ageDays = computeAgeDaysFromFirstSale(firstSaleDate, today);
  const maxZeroRunDays = computeMaxZeroRunDays(dailyRows, recent90Since, recentWindowEnd);

  return computeSkuLifecycleLabel({
    ageDays,
    salesDayRatio90: salesDays90 / 90,
    recent30DailyAvg,
    recent90DailyAvg,
    maxZeroRunDays,
  });
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function roundDaily(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function sumQtySince(rows: Array<{ saleDate: string; qtySold: number }>, since: Date): number {
  const sinceKey = toDateOnly(since);
  return rows.reduce((sum, row) => {
    return String(row.saleDate).slice(0, 10) >= sinceKey ? sum + Number(row.qtySold) : sum;
  }, 0);
}

function countSalesDaysSince(rows: Array<{ saleDate: string; qtySold: number }>, since: Date): number {
  const sinceKey = toDateOnly(since);
  const days = new Set<string>();
  for (const row of rows) {
    const saleDate = String(row.saleDate).slice(0, 10);
    if (saleDate >= sinceKey && Number(row.qtySold) > 0) days.add(saleDate);
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
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const qty = qtyByDate.get(toDateOnly(cursor)) ?? 0;
    if (qty <= 0) {
      currentRun++;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  return maxRun;
}

/**
 * 按销量刷新 skus.lifecycle；仅当标签变化时写库。
 * @returns 实际更新行数
 */
export async function refreshSkuLifecycles(
  skuIds: string[],
  options?: { today?: Date },
): Promise<{ checked: number; updated: number }> {
  const uniqueIds = [...new Set(skuIds.filter(Boolean))];
  if (!uniqueIds.length) return { checked: 0, updated: 0 };

  const today = options?.today ?? new Date();
  const recentWindowEnd = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const recent90Since = addDays(recentWindowEnd, -89);
  const sinceKey = toDateOnly(recent90Since);
  const endKey = toDateOnly(recentWindowEnd);

  let updated = 0;
  const CHUNK = 200;

  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    const chunk = uniqueIds.slice(i, i + CHUNK);

    const existingRows = await db
      .select({ id: skus.id, lifecycle: skus.lifecycle })
      .from(skus)
      .where(inArray(skus.id, chunk));

    const salesRows = await db
      .select({
        skuId: salesHistory.skuId,
        saleDate: salesHistory.saleDate,
        qtySold: sql<number>`sum(${salesHistory.qtySold})::int`,
      })
      .from(salesHistory)
      .where(
        and(
          inArray(salesHistory.skuId, chunk),
          gte(salesHistory.saleDate, sinceKey),
          lte(salesHistory.saleDate, endKey),
        ),
      )
      .groupBy(salesHistory.skuId, salesHistory.saleDate);

    const firstSaleRows = await db
      .select({
        skuId: salesHistory.skuId,
        firstSaleDate: sql<string>`min(${salesHistory.saleDate})`,
      })
      .from(salesHistory)
      .where(inArray(salesHistory.skuId, chunk))
      .groupBy(salesHistory.skuId);

    const dailyBySku = new Map<string, Array<{ saleDate: string; qtySold: number }>>();
    for (const row of salesRows) {
      const list = dailyBySku.get(row.skuId) ?? [];
      list.push({ saleDate: String(row.saleDate).slice(0, 10), qtySold: Number(row.qtySold) });
      dailyBySku.set(row.skuId, list);
    }
    const firstSaleBySku = new Map(
      firstSaleRows.map((row) => [row.skuId, String(row.firstSaleDate).slice(0, 10)]),
    );

    for (const sku of existingRows) {
      const nextLabel = computeSkuLifecycleLabelFromDailySales(dailyBySku.get(sku.id) ?? [], {
        today,
        firstSaleDate: firstSaleBySku.get(sku.id) ?? null,
      });
      if ((sku.lifecycle ?? null) === nextLabel) continue;
      await db
        .update(skus)
        .set({ lifecycle: nextLabel, updatedAt: new Date() })
        .where(eq(skus.id, sku.id));
      updated++;
    }
  }

  return { checked: uniqueIds.length, updated };
}
