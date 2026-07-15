import { inArray } from 'drizzle-orm';
import { db, salesHistory, skus } from '@scm/db';
import type { DailySalesRow } from './sales-report-parser.js';
import { ensureSkusFromDailySales } from './ensure-sku-from-import.js';
import { aggregateSalesHistoryMonthlyFromDaily } from './sales-history-monthly.js';
import { loadSkuCategoryMap, resolveSkuCategoryFromMaster } from './sku-category.js';
import { sanitizeDbText } from './import/parse.js';
import { normalizeSalesPlatformSync } from './sales-platform.js';

export type SalesHistoryImportPlanRow = {
  skuId: string;
  saleDate: string;
  qtySold: number;
  channel: string;
  category: string | null;
};

export type SalesHistoryImportPlan = {
  rows: SalesHistoryImportPlanRow[];
  unmatchedSkuCount: number;
  errors: string[];
};

export type SalesHistoryImportStats = SalesHistoryImportPlan & {
  importedSalesRows: number;
  insertedSalesRows: number;
  /** @deprecated 销售历史导入不再更新存量，恒为 0 */
  updatedSalesRows: number;
  skippedExistingSalesRows: number;
  createdSkuCount: number;
  enrichedSkuCount: number;
  skippedExistingCount: number;
  monthlyAggregate?: {
    upsertedRows: number;
    lookbackMonths: number;
    cutoffDate: string;
  };
};

export function buildSalesHistoryImportPlan(
  rows: DailySalesRow[],
  skuIdByCode: Map<string, string>,
  categoryBySkuId: Map<string, string | null>,
): SalesHistoryImportPlan {
  const planned = new Map<string, SalesHistoryImportPlanRow>();
  const unmatchedSkuCodes = new Set<string>();

  for (const row of rows) {
    const skuCode = row.skuCode.trim();
    if (!skuCode) {
      continue;
    }

    const skuId = skuIdByCode.get(skuCode);
    if (!skuId) {
      unmatchedSkuCodes.add(skuCode);
      continue;
    }

    const channel = sanitizeDbText(normalizeSalesPlatformSync(row.platformRaw));
    const categoryFromImport = row.category.trim() || null;
    const key = `${skuId}::${row.saleDate}::${channel}`;
    const existing = planned.get(key);
    if (existing) {
      existing.qtySold += row.qtySold;
      if (categoryFromImport && !existing.category) {
        existing.category = categoryFromImport;
      }
    } else {
      planned.set(key, {
        skuId,
        saleDate: row.saleDate,
        qtySold: row.qtySold,
        channel,
        category: categoryFromImport || resolveSkuCategoryFromMaster(categoryBySkuId, skuId),
      });
    }
  }

  return {
    rows: Array.from(planned.values()),
    unmatchedSkuCount: unmatchedSkuCodes.size,
    errors: Array.from(unmatchedSkuCodes)
      .sort((a, b) => a.localeCompare(b))
      .map((skuCode) => `SKU could not be created for daily sales row: ${skuCode}`),
  };
}

export async function persistDailySalesRowsAsHistory(
  rows: DailySalesRow[],
  importBatchId?: string,
  options?: { skipMonthlyAggregate?: boolean },
): Promise<SalesHistoryImportStats> {
  const { skuIdByCode, createdSkuCount, enrichedSkuCount, skippedExistingCount } =
    await ensureSkusFromDailySales(rows);

  const skuCodes = Array.from(new Set(rows.map((row) => row.skuCode.trim()).filter(Boolean)));
  if (skuCodes.length) {
    const skuRows = await db
      .select({ id: skus.id, code: skus.code, category: skus.category })
      .from(skus)
      .where(inArray(skus.code, skuCodes));

    for (const row of skuRows) {
      skuIdByCode.set(row.code, row.id);
    }
  }

  const categoryBySkuId = await loadSkuCategoryMap(Array.from(new Set(skuIdByCode.values())));
  const plan = buildSalesHistoryImportPlan(rows, skuIdByCode, categoryBySkuId);

  let insertedSalesRows = 0;
  let skippedExistingSalesRows = 0;

  const INSERT_CHUNK = 1000;
  for (let offset = 0; offset < plan.rows.length; offset += INSERT_CHUNK) {
    const chunk = plan.rows.slice(offset, offset + INSERT_CHUNK);
    if (!chunk.length) continue;

    const inserted = await db
      .insert(salesHistory)
      .values(
        chunk.map((row) => ({
          skuId: row.skuId,
          saleDate: row.saleDate,
          qtySold: row.qtySold,
          channel: row.channel,
          category: row.category,
          source: 'import' as const,
          importBatchId: importBatchId || undefined,
        })),
      )
      .onConflictDoNothing({
        target: [salesHistory.skuId, salesHistory.saleDate, salesHistory.channel],
      })
      .returning({ id: salesHistory.id });

    insertedSalesRows += inserted.length;
    skippedExistingSalesRows += chunk.length - inserted.length;
  }

  const monthlyAggregate = options?.skipMonthlyAggregate
    ? undefined
    : await aggregateSalesHistoryMonthlyFromDaily({
        skuIds: Array.from(new Set(plan.rows.map((row) => row.skuId))),
      });

  return {
    ...plan,
    importedSalesRows: insertedSalesRows,
    insertedSalesRows,
    updatedSalesRows: 0,
    skippedExistingSalesRows,
    createdSkuCount,
    enrichedSkuCount,
    skippedExistingCount,
    monthlyAggregate,
  };
}
