import { db, salesHistoryMonthly, skus } from '@scm/db';
import { eq } from 'drizzle-orm';
import {
  buildSeasonalityDimensionCandidates,
  computeSeasonalityFactors,
  createForecastSourceBatch,
  upsertSeasonalityFactors,
} from './forecast-collaboration.js';
import { cleanMonthlyQtyForTraining } from './forecast-monthly-clean.js';
import type { MonthlyTrendRow } from './sales-report-parser.js';
import { getMonthlySalesCoverageStats } from './sales-history-monthly.js';

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function accumulateQty(
  target: Map<string, Map<string, number>>,
  dimensionValue: string,
  month: string,
  qty: number,
) {
  if (!dimensionValue || qty <= 0) return;
  const byMonth = target.get(dimensionValue) ?? new Map<string, number>();
  byMonth.set(month, (byMonth.get(month) ?? 0) + qty);
  target.set(dimensionValue, byMonth);
}

export function buildMonthlyTrendRowsFromSkuMonthly(
  rows: Array<{
    skuId?: string;
    category: string | null;
    saleYear: number;
    month: number;
    qtySold: number;
  }>,
): MonthlyTrendRow[] {
  const categoryQty = new Map<string, Map<string, number>>();
  const projectQty = new Map<string, Map<string, number>>();

  const bySku = new Map<string, Array<{ category: string | null; saleYear: number; month: number; qtySold: number }>>();
  for (const row of rows) {
    if (row.skuId) {
      const list = bySku.get(row.skuId) ?? [];
      list.push(row);
      bySku.set(row.skuId, list);
    }
  }

  const cleanedRows: typeof rows = [];
  if (bySku.size > 0) {
    for (const skuRows of bySku.values()) {
      const sorted = [...skuRows].sort((a, b) =>
        a.saleYear !== b.saleYear ? a.saleYear - b.saleYear : a.month - b.month,
      );
      const monthlyQty = sorted.map((r) => r.qtySold);
      const cleaned = cleanMonthlyQtyForTraining(monthlyQty).cleaned;
      sorted.forEach((row, idx) => {
        cleanedRows.push({ ...row, qtySold: cleaned[idx] ?? row.qtySold });
      });
    }
  } else {
    cleanedRows.push(...rows);
  }

  for (const row of cleanedRows) {
    const category = row.category?.trim();
    if (!category || row.qtySold <= 0) continue;

    const key = monthKey(row.saleYear, row.month);
    accumulateQty(categoryQty, category, key, row.qtySold);

    const { projectGroup } = buildSeasonalityDimensionCandidates(category);
    for (const pg of projectGroup) {
      accumulateQty(projectQty, pg, key, row.qtySold);
    }
  }

  const trendRows: MonthlyTrendRow[] = [];
  for (const [dimensionValue, byMonth] of categoryQty) {
    for (const [month, qtySold] of byMonth) {
      trendRows.push({ dimensionType: 'category', dimensionValue, month, qtySold });
    }
  }
  for (const [dimensionValue, byMonth] of projectQty) {
    for (const [month, qtySold] of byMonth) {
      trendRows.push({ dimensionType: 'project_group', dimensionValue, month, qtySold });
    }
  }

  return trendRows;
}

export async function rebuildSeasonalityFromSalesHistoryMonthly(input?: {
  createdBy?: string;
  asOf?: Date;
}): Promise<{ factorCount: number; sourceMonthCount: number }> {
  const monthlyRows = await db
    .select({
      skuId: salesHistoryMonthly.skuId,
      category: salesHistoryMonthly.category,
      saleYear: salesHistoryMonthly.saleYear,
      month: salesHistoryMonthly.month,
      qtySold: salesHistoryMonthly.qtySold,
    })
    .from(salesHistoryMonthly)
    .innerJoin(skus, eq(skus.id, salesHistoryMonthly.skuId));

  const trendRows = buildMonthlyTrendRowsFromSkuMonthly(monthlyRows);
  const coverage = await getMonthlySalesCoverageStats();
  const batch = await createForecastSourceBatch({
    dailyFileName: 'sales_history',
    monthlyFileName: 'sales_history_monthly',
    monthlyStartMonth: coverage.startMonth ?? undefined,
    monthlyEndMonth: coverage.endMonth ?? undefined,
    skuCount: coverage.skuCount,
    rowCount: coverage.rowCount,
    createdBy: input?.createdBy,
  });

  const factors = computeSeasonalityFactors(trendRows, input?.asOf ?? new Date());
  const { upserted } = await upsertSeasonalityFactors(batch.id, factors);

  return {
    factorCount: upserted,
    sourceMonthCount: trendRows.length,
  };
}
