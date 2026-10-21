import { inArray, sql } from 'drizzle-orm';
import { db, salesHistory, skus } from '@scm/db';
import type { DailySalesRow } from './sales-report-parser.js';
import {
  ensureSkusFromDailySales,
  normalizedDailySalesSkuCode,
} from './ensure-sku-from-import.js';
import { aggregateSalesHistoryMonthlyFromDaily } from './sales-history-monthly.js';
import { loadSkuCategoryMap, resolveSkuCategoryFromMaster } from './sku-category.js';
import { sanitizeDbText } from './import/parse.js';
import { assessUnknownChannelShare, normalizeSalesPlatformSync } from './sales-platform.js';
import { schedulePostImportSalesAnalyticsCubeRebuild } from './sales-analytics-cube.js';
import { classifyAnalyticsSiteFromReport } from './sales-analytics-dims.js';
import { yieldToEventLoop } from './yield-event-loop.js';

export type SalesHistoryImportPlanRow = {
  skuId: string;
  saleDate: string;
  qtySold: number;
  channel: string;
  /** Canonical analytics site: US / EU / UK / 其他 */
  station: string;
  category: string | null;
};

export type SalesHistoryImportPlan = {
  rows: SalesHistoryImportPlanRow[];
  unmatchedSkuCount: number;
  errors: string[];
  warnings?: string[];
  unknownChannelRows?: number;
};

export type SalesHistoryImportStats = SalesHistoryImportPlan & {
  importedSalesRows: number;
  insertedSalesRows: number;
  /** 同一 SKU + 日期 + 渠道 + 站点已存在时覆盖销量 */
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

function isInsertedReturningFlag(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

function resolveSkuIdForDailySalesRow(
  rawSkuCode: string,
  skuIdByCode: Map<string, string>,
): string | undefined {
  const sanitized = sanitizeDbText(rawSkuCode.trim());
  if (!sanitized) return undefined;
  const normalized = normalizedDailySalesSkuCode(sanitized);
  return (
    skuIdByCode.get(normalized) ??
    skuIdByCode.get(sanitized) ??
    skuIdByCode.get(rawSkuCode.trim())
  );
}

function registerDailySalesSkuCodeAliases(
  rows: DailySalesRow[],
  skuIdByCode: Map<string, string>,
): void {
  for (const row of rows) {
    const sanitized = sanitizeDbText(row.skuCode.trim());
    if (!sanitized) continue;
    const normalized = normalizedDailySalesSkuCode(sanitized);
    const skuId = resolveSkuIdForDailySalesRow(sanitized, skuIdByCode);
    if (!skuId) continue;
    skuIdByCode.set(normalized, skuId);
    skuIdByCode.set(sanitized, skuId);
  }
}

function dedupeSalesHistoryPlanRows(rows: SalesHistoryImportPlanRow[]): SalesHistoryImportPlanRow[] {
  const merged = new Map<string, SalesHistoryImportPlanRow>();
  for (const row of rows) {
    const key = `${row.skuId}::${row.saleDate}::${row.channel ?? ''}::${row.station ?? ''}`;
    const existing = merged.get(key);
    if (existing) {
      existing.qtySold += row.qtySold;
      if (row.category && !existing.category) {
        existing.category = row.category;
      }
      continue;
    }
    merged.set(key, { ...row });
  }
  return Array.from(merged.values());
}

export function buildSalesHistoryImportPlan(
  rows: DailySalesRow[],
  skuIdByCode: Map<string, string>,
  categoryBySkuId: Map<string, string | null>,
): SalesHistoryImportPlan {
  const planned = new Map<string, SalesHistoryImportPlanRow>();
  const unmatchedSkuCodes = new Set<string>();

  for (const row of rows) {
    const skuCode = sanitizeDbText(row.skuCode.trim());
    if (!skuCode) {
      continue;
    }

    const skuId = resolveSkuIdForDailySalesRow(skuCode, skuIdByCode);
    if (!skuId) {
      unmatchedSkuCodes.add(skuCode);
      continue;
    }

    const channel = sanitizeDbText(normalizeSalesPlatformSync(row.platformRaw));
    const station = classifyAnalyticsSiteFromReport(row.station);
    const categoryFromImport = row.category.trim() || null;
    const key = `${skuId}::${row.saleDate}::${channel}::${station}`;
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
        station,
        category: categoryFromImport || resolveSkuCategoryFromMaster(categoryBySkuId, skuId),
      });
    }
  }

  return {
    rows: Array.from(planned.values()),
    unmatchedSkuCount: unmatchedSkuCodes.size,
    unknownChannelRows: Array.from(planned.values()).filter((r) => r.channel === 'UNKNOWN').length,
    warnings: (() => {
      const rows = Array.from(planned.values());
      const unknownRows = rows.filter((r) => r.channel === 'UNKNOWN').length;
      const assessed = assessUnknownChannelShare({ totalRows: rows.length, unknownRows });
      return assessed.warning ? [assessed.warning] : [];
    })(),
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

  registerDailySalesSkuCodeAliases(rows, skuIdByCode);

  const skuCodes = Array.from(
    new Set(rows.map((row) => normalizedDailySalesSkuCode(row.skuCode)).filter(Boolean)),
  );
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
  const planRows = dedupeSalesHistoryPlanRows(plan.rows);

  let insertedSalesRows = 0;
  let updatedSalesRows = 0;

  const qtySold = importBatchId
    ? sql`case when ${salesHistory.importBatchId}::text = ${importBatchId} then ${salesHistory.qtySold} + excluded.qty_sold else excluded.qty_sold end`
    : sql`excluded.qty_sold`;

  const INSERT_CHUNK = 1000;
  for (let offset = 0; offset < planRows.length; offset += INSERT_CHUNK) {
    const chunk = planRows.slice(offset, offset + INSERT_CHUNK);
    if (!chunk.length) continue;

    const written = await db
      .insert(salesHistory)
      .values(
        chunk.map((row) => ({
          skuId: row.skuId,
          saleDate: row.saleDate,
          qtySold: row.qtySold,
          channel: row.channel,
          station: row.station,
          category: row.category,
          source: 'import' as const,
          importBatchId: importBatchId || undefined,
        })),
      )
      .onConflictDoUpdate({
        target: [
          salesHistory.skuId,
          salesHistory.saleDate,
          salesHistory.channel,
          salesHistory.station,
        ],
        set: {
          qtySold,
          category: sql`coalesce(excluded.category, ${salesHistory.category})`,
          importBatchId: sql`excluded.import_batch_id`,
        },
      })
      .returning({
        id: salesHistory.id,
        inserted: sql<boolean>`(xmax = 0)`,
      });

    for (const row of written) {
      if (isInsertedReturningFlag(row.inserted)) insertedSalesRows += 1;
      else updatedSalesRows += 1;
    }
    await yieldToEventLoop();
  }

  const monthlyAggregate = options?.skipMonthlyAggregate
    ? undefined
    : await aggregateSalesHistoryMonthlyFromDaily({
        skuIds: Array.from(new Set(planRows.map((row) => row.skuId))),
      });

  const writtenSalesRows = insertedSalesRows + updatedSalesRows;
  if (writtenSalesRows > 0 && !options?.skipMonthlyAggregate) {
    schedulePostImportSalesAnalyticsCubeRebuild();
  }

  return {
    ...plan,
    rows: planRows,
    importedSalesRows: writtenSalesRows,
    insertedSalesRows,
    updatedSalesRows,
    skippedExistingSalesRows: 0,
    createdSkuCount,
    enrichedSkuCount,
    skippedExistingCount,
    monthlyAggregate,
  };
}
