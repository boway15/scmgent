import type { DailySalesRow, SkuMonthlySalesRow } from './sales-report-parser.js';

export type SalesReconcileMismatch = {
  skuCode: string;
  platformRaw: string;
  month: string;
  dailyQty: number;
  monthlyQty: number;
  diff: number;
  diffPct: number | null;
};

export type SalesReconcileResult = {
  matchedMonths: number;
  mismatchCount: number;
  mismatchRate: number;
  topMismatches: SalesReconcileMismatch[];
};

const MISMATCH_PCT_THRESHOLD = 0.05;
const MISMATCH_MIN_MONTHLY_QTY = 30;

function reconcileKey(skuCode: string, platformRaw: string, year: number, month: number): string {
  const channel = platformRaw.trim() || 'UNKNOWN';
  return `${skuCode.trim()}::${channel}::${year}::${month}`;
}

function monthKeyFromDate(saleDate: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(saleDate.slice(0, 10));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

export function reconcileSkuSalesHistory(input: {
  dailyRows: DailySalesRow[];
  monthlyRows: SkuMonthlySalesRow[];
}): SalesReconcileResult {
  const dailyByKey = new Map<string, number>();
  for (const row of input.dailyRows) {
    const parts = monthKeyFromDate(row.saleDate);
    if (!parts) continue;
    const key = reconcileKey(row.skuCode, row.platformRaw, parts.year, parts.month);
    dailyByKey.set(key, (dailyByKey.get(key) ?? 0) + row.qtySold);
  }

  const monthlyByKey = new Map<string, { skuCode: string; platformRaw: string; month: string; qty: number }>();
  for (const row of input.monthlyRows) {
    const key = reconcileKey(row.skuCode, row.platformRaw, row.saleYear, row.month);
    const month = `${row.saleYear}-${String(row.month).padStart(2, '0')}`;
    const existing = monthlyByKey.get(key);
    if (existing) {
      existing.qty += row.qtySold;
    } else {
      monthlyByKey.set(key, {
        skuCode: row.skuCode,
        platformRaw: row.platformRaw,
        month,
        qty: row.qtySold,
      });
    }
  }

  const mismatches: SalesReconcileMismatch[] = [];
  let matchedMonths = 0;

  for (const [key, monthly] of monthlyByKey) {
    const dailyQty = dailyByKey.get(key);
    if (dailyQty === undefined) continue;

    matchedMonths++;
    const diff = dailyQty - monthly.qty;
    const diffPct = monthly.qty > 0 ? diff / monthly.qty : null;

    const isMismatch =
      monthly.qty >= MISMATCH_MIN_MONTHLY_QTY &&
      diffPct != null &&
      Math.abs(diffPct) > MISMATCH_PCT_THRESHOLD;

    if (isMismatch) {
      mismatches.push({
        skuCode: monthly.skuCode,
        platformRaw: monthly.platformRaw,
        month: monthly.month,
        dailyQty,
        monthlyQty: monthly.qty,
        diff,
        diffPct,
      });
    }
  }

  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return {
    matchedMonths,
    mismatchCount: mismatches.length,
    mismatchRate: matchedMonths > 0 ? mismatches.length / matchedMonths : 0,
    topMismatches: mismatches.slice(0, 20),
  };
}

export type SalesMonthlyAggregateRow = {
  skuCode: string;
  platformRaw: string;
  saleYear: number;
  month: number;
  qtySold: number;
};

/** Reconcile using pre-aggregated daily/monthly rows (e.g. from sales_history tables). */
export function reconcileSkuSalesHistoryFromAggregates(input: {
  dailyAggRows: SalesMonthlyAggregateRow[];
  monthlyRows: SkuMonthlySalesRow[];
}): SalesReconcileResult {
  const dailyByKey = new Map<string, number>();
  for (const row of input.dailyAggRows) {
    const key = reconcileKey(row.skuCode, row.platformRaw, row.saleYear, row.month);
    dailyByKey.set(key, (dailyByKey.get(key) ?? 0) + row.qtySold);
  }

  const monthlyByKey = new Map<string, { skuCode: string; platformRaw: string; month: string; qty: number }>();
  for (const row of input.monthlyRows) {
    const key = reconcileKey(row.skuCode, row.platformRaw, row.saleYear, row.month);
    const month = `${row.saleYear}-${String(row.month).padStart(2, '0')}`;
    const existing = monthlyByKey.get(key);
    if (existing) {
      existing.qty += row.qtySold;
    } else {
      monthlyByKey.set(key, {
        skuCode: row.skuCode,
        platformRaw: row.platformRaw,
        month,
        qty: row.qtySold,
      });
    }
  }

  const mismatches: SalesReconcileMismatch[] = [];
  let matchedMonths = 0;

  for (const [key, monthly] of monthlyByKey) {
    const dailyQty = dailyByKey.get(key);
    if (dailyQty === undefined) continue;

    matchedMonths++;
    const diff = dailyQty - monthly.qty;
    const diffPct = monthly.qty > 0 ? diff / monthly.qty : null;

    const isMismatch =
      monthly.qty >= MISMATCH_MIN_MONTHLY_QTY &&
      diffPct != null &&
      Math.abs(diffPct) > MISMATCH_PCT_THRESHOLD;

    if (isMismatch) {
      mismatches.push({
        skuCode: monthly.skuCode,
        platformRaw: monthly.platformRaw,
        month: monthly.month,
        dailyQty,
        monthlyQty: monthly.qty,
        diff,
        diffPct,
      });
    }
  }

  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return {
    matchedMonths,
    mismatchCount: mismatches.length,
    mismatchRate: matchedMonths > 0 ? mismatches.length / matchedMonths : 0,
    topMismatches: mismatches.slice(0, 20),
  };
}
