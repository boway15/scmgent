import {
  collectStockoutExcludedDates,
  daysInCalendarMonth,
  roundDaily,
  type SalesLifecycle,
} from './forecast-baseline.js';

export const UNCONSTRAIN_VOLUME_MIN_DAILY = 1;
export const UNCONSTRAIN_MIN_RUN_DAYS = 7;
export const UNCONSTRAIN_MIN_EFFECTIVE_RATIO = 0.3;
export const UNCONSTRAIN_CAP_RATIO = 1.5;

export type ReconstructSkipReason =
  | 'tail'
  | 'new'
  | 'intermittent'
  | 'no_run'
  | 'coverage_insufficient';

export type UnconstrainRecentDailyResult = {
  calendarDaily: number;
  unconstrainedDaily: number;
  reconstructed: boolean;
  stockoutDays: number;
  effectiveDays: number;
  windowDays: number;
  reconstructCapHit: boolean;
  skipReason: ReconstructSkipReason | null;
};

export type DemandReconstructAudit = {
  demandReconstructed: boolean;
  stockoutDays90: number;
  effectiveDays90: number;
  calendarDaily90: number;
  unconstrainedDaily90: number;
  reconstructCapHit: boolean;
  reconstructSkipReason: ReconstructSkipReason | null;
};

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function countInclusiveWindowDays(windowStart: Date, windowEnd: Date): number {
  const start = Date.UTC(
    windowStart.getUTCFullYear(),
    windowStart.getUTCMonth(),
    windowStart.getUTCDate(),
  );
  const end = Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth(), windowEnd.getUTCDate());
  return Math.floor((end - start) / 86400000) + 1;
}

export function sumQtyInWindow(
  sales: Array<{ saleDate: string; qtySold: number }>,
  windowStart: Date,
  windowEnd: Date,
): number {
  const startKey = toDateKey(windowStart);
  const endKey = toDateKey(windowEnd);
  let sum = 0;
  for (const row of sales) {
    const key = String(row.saleDate).slice(0, 10);
    if (key < startKey || key > endKey) continue;
    sum += Number(row.qtySold) || 0;
  }
  return sum;
}

export function unconstrainRecentDaily(input: {
  sales: Array<{ saleDate: string; qtySold: number }>;
  windowStart: Date;
  windowEnd: Date;
  lifecycle: SalesLifecycle;
  firstSaleDate?: string | null;
}): UnconstrainRecentDailyResult {
  const windowDays = countInclusiveWindowDays(input.windowStart, input.windowEnd);
  const qtySum = sumQtyInWindow(input.sales, input.windowStart, input.windowEnd);
  const calendarDaily = windowDays > 0 ? qtySum / windowDays : 0;

  const skip = (reason: ReconstructSkipReason): UnconstrainRecentDailyResult => ({
    calendarDaily: roundDaily(calendarDaily),
    unconstrainedDaily: roundDaily(calendarDaily),
    reconstructed: false,
    stockoutDays: 0,
    effectiveDays: windowDays,
    windowDays,
    reconstructCapHit: false,
    skipReason: reason,
  });

  if (input.lifecycle === 'new') return skip('new');
  if (input.lifecycle === 'intermittent') return skip('intermittent');
  if (calendarDaily < UNCONSTRAIN_VOLUME_MIN_DAILY) return skip('tail');

  const excluded = collectStockoutExcludedDates(
    input.sales,
    input.windowStart,
    input.windowEnd,
    UNCONSTRAIN_MIN_RUN_DAYS,
  );
  const firstSale = input.firstSaleDate?.slice(0, 10) ?? null;
  if (firstSale) {
    for (const key of [...excluded]) {
      if (key < firstSale) excluded.delete(key);
    }
  }
  const stockoutDays = excluded.size;
  if (stockoutDays === 0) return skip('no_run');

  const effectiveDays = windowDays - stockoutDays;
  if (effectiveDays <= 0 || effectiveDays / windowDays < UNCONSTRAIN_MIN_EFFECTIVE_RATIO) {
    return skip('coverage_insufficient');
  }

  const rawU = qtySum / effectiveDays;
  const cap = calendarDaily * UNCONSTRAIN_CAP_RATIO;
  const reconstructCapHit = rawU > cap + 1e-12;
  const unconstrainedDaily = reconstructCapHit ? cap : rawU;

  return {
    calendarDaily: roundDaily(calendarDaily),
    unconstrainedDaily: roundDaily(unconstrainedDaily),
    reconstructed: true,
    stockoutDays,
    effectiveDays,
    windowDays,
    reconstructCapHit,
    skipReason: null,
  };
}

export function toDemandReconstructAudit(
  result90: UnconstrainRecentDailyResult,
): DemandReconstructAudit {
  return {
    demandReconstructed: result90.reconstructed,
    stockoutDays90: result90.stockoutDays,
    effectiveDays90: result90.effectiveDays,
    calendarDaily90: result90.calendarDaily,
    unconstrainedDaily90: result90.unconstrainedDaily,
    reconstructCapHit: result90.reconstructCapHit,
    reconstructSkipReason: result90.skipReason,
  };
}

export function applySkuVolumeGate(
  result: UnconstrainRecentDailyResult,
  calendarDaily90: number,
): UnconstrainRecentDailyResult {
  if (calendarDaily90 >= UNCONSTRAIN_VOLUME_MIN_DAILY) return result;
  if (result.skipReason === 'tail') return result;
  return {
    ...result,
    reconstructed: false,
    unconstrainedDaily: result.calendarDaily,
    reconstructCapHit: false,
    skipReason: 'tail',
    stockoutDays: 0,
    effectiveDays: result.windowDays,
  };
}

export type UnconstrainMonthQtyResult = {
  cleanedQty: number;
  rawQty: number;
  reconstructed: boolean;
  stockoutFullMonth: boolean;
};

function monthBounds(year: number, month: number): { start: Date; end: Date; days: number } {
  const days = daysInCalendarMonth(year, month);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month - 1, days)),
    days,
  };
}

export function unconstrainMonthQty(input: {
  year: number;
  month: number;
  rawQty: number;
  dailySales: Array<{ saleDate: string; qtySold: number }>;
  skuMayUnconstrain: boolean;
  firstSaleDate?: string | null;
}): UnconstrainMonthQtyResult {
  const rawQty = Math.max(0, Number(input.rawQty) || 0);
  if (!input.skuMayUnconstrain) {
    return { cleanedQty: rawQty, rawQty, reconstructed: false, stockoutFullMonth: false };
  }
  const { start, end, days } = monthBounds(input.year, input.month);
  const excluded = collectStockoutExcludedDates(
    input.dailySales,
    start,
    end,
    UNCONSTRAIN_MIN_RUN_DAYS,
  );
  const firstSale = input.firstSaleDate?.slice(0, 10) ?? null;
  if (firstSale) {
    for (const key of [...excluded]) {
      if (key < firstSale) excluded.delete(key);
    }
  }
  if (excluded.size === 0) {
    return { cleanedQty: rawQty, rawQty, reconstructed: false, stockoutFullMonth: false };
  }
  const sellingDays = days - excluded.size;
  if (sellingDays <= 0) {
    return { cleanedQty: 0, rawQty, reconstructed: false, stockoutFullMonth: true };
  }
  const monthU = (rawQty / sellingDays) * days;
  const cleanedQty = roundDaily(Math.min(monthU, rawQty * UNCONSTRAIN_CAP_RATIO));
  return { cleanedQty, rawQty, reconstructed: cleanedQty !== rawQty, stockoutFullMonth: false };
}

export function unconstrainLast12MonthlyQty(input: {
  monthlyQty: number[];
  asOf: Date;
  dailySales: Array<{ saleDate: string; qtySold: number }>;
  skuMayUnconstrain: boolean;
  firstSaleDate?: string | null;
}): number[] {
  const qty = input.monthlyQty.slice();
  let y = input.asOf.getUTCFullYear();
  let m = input.asOf.getUTCMonth() + 1;
  for (let i = qty.length - 1; i >= 0; i -= 1) {
    const cell = unconstrainMonthQty({
      year: y,
      month: m,
      rawQty: qty[i] ?? 0,
      dailySales: input.dailySales,
      skuMayUnconstrain: input.skuMayUnconstrain,
      firstSaleDate: input.firstSaleDate,
    });
    qty[i] = cell.cleanedQty;
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return qty;
}
