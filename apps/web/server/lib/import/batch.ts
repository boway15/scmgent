import { eq, desc, inArray, sql, and } from 'drizzle-orm';
import { db, importBatches, salesHistory } from '@scm/db';
import type { ImportType } from './handlers.js';
import type { ImportResult } from './handlers.js';
import { isFobInventoryFormat } from '../fob-inventory-import.js';
import { sanitizeDbText } from './parse.js';

export type ImportBatchProgressMeta = {
  estimatedDailyRows?: number;
  processedSkuWideRows?: number;
  phase?: 'writing' | 'aggregating' | 'pruning';
};

const PROGRESS_PREFIX = '__progress__:';

function encodeProgressSummary(meta: ImportBatchProgressMeta): string {
  return `${PROGRESS_PREFIX}${JSON.stringify(meta)}`;
}

export function parseImportBatchProgressMeta(
  errorSummary: string | null | undefined,
): ImportBatchProgressMeta | null {
  if (!errorSummary?.startsWith(PROGRESS_PREFIX)) return null;
  try {
    return JSON.parse(errorSummary.slice(PROGRESS_PREFIX.length)) as ImportBatchProgressMeta;
  } catch {
    return null;
  }
}

function stripProgressSummary(errorSummary: string | null | undefined): string | null {
  if (!errorSummary?.startsWith(PROGRESS_PREFIX)) return errorSummary ?? null;
  return null;
}

async function countDailyRowsByBatchIds(batchIds: string[]): Promise<Map<string, number>> {
  if (!batchIds.length) return new Map();

  const rows = await db
    .select({
      batchId: salesHistory.importBatchId,
      count: sql<number>`count(*)::int`,
    })
    .from(salesHistory)
    .where(inArray(salesHistory.importBatchId, batchIds))
    .groupBy(salesHistory.importBatchId);

  return new Map(
    rows
      .filter((row): row is { batchId: string; count: number } => Boolean(row.batchId))
      .map((row) => [row.batchId, row.count]),
  );
}

/** 新导入开始时，将卡住的 pending 批次标为失败，避免界面长期显示「导入中」 */
export async function abandonStalePendingBatches(type: ImportType): Promise<void> {
  await db
    .update(importBatches)
    .set({
      status: 'failed',
      errorSummary: '导入中断（服务重启、超时或已被新的导入取代）',
    })
    .where(and(eq(importBatches.type, type), eq(importBatches.status, 'pending')));
}

export async function countSalesHistoryRowsForBatch(batchId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(salesHistory)
    .where(eq(salesHistory.importBatchId, batchId));
  return row?.count ?? 0;
}

export type ImportValidationIssue = {
  row: number;
  field?: string;
  message: string;
};

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

export async function validateImportPreview(
  type: ImportType,
  rows: Array<Record<string, string>>,
  warehouseCodes: Set<string>,
  skuCodes: Set<string>,
): Promise<ImportValidationIssue[]> {
  if (type === 'sales') {
    return [];
  }

  const issues: ImportValidationIssue[] = [];
  const seen = new Set<string>();

  const fobInventory = type === 'inventory' && isFobInventoryFormat(rows);

  rows.forEach((row, index) => {
    const rowNo = index + 1;
    const skuCode = (
      row.sku_code ||
      row.code ||
      row.sku ||
      row.SKU ||
      ''
    ).trim();

    if (type === 'inventory' || type === 'safety_stock') {
      if (!skuCode) {
        issues.push({ row: rowNo, field: 'sku_code', message: '缺少 sku_code' });
      } else if (!fobInventory && !skuCodes.has(skuCode)) {
        issues.push({ row: rowNo, field: 'sku_code', message: `SKU 不存在: ${skuCode}` });
      }
    }

    if (type === 'merchants') {
      const merchantCode = (row.merchant_code || row.code || '').trim();
      if (!merchantCode) {
        issues.push({ row: rowNo, field: 'merchant_code', message: '缺少 merchant_code' });
      }
    }

    if (type === 'safety_stock') {
      const warehouse = (row.warehouse_code || row.warehouse || 'ALL').trim();
      if (warehouse !== 'ALL' && !warehouseCodes.has(warehouse)) {
        issues.push({ row: rowNo, field: 'warehouse_code', message: `仓库编码无效: ${warehouse}` });
      }
    }

    if (type === 'inventory') {
      if (fobInventory) {
        return;
      }

      const warehouse = (row.warehouse || row.warehouse_code || 'US-WEST').trim();
      if (!warehouseCodes.has(warehouse) && warehouse !== 'IN-PRODUCTION') {
        issues.push({ row: rowNo, field: 'warehouse', message: `仓库编码无效: ${warehouse}` });
      }
      const recordedDate = (row.recorded_date || '').trim();
      if (recordedDate && !isValidDate(recordedDate)) {
        issues.push({ row: rowNo, field: 'recorded_date', message: `日期格式无效: ${recordedDate}` });
      }
      for (const field of ['qty_available', 'qty_in_transit', 'qty_in_production']) {
        const raw = (row[field] || '').trim();
        if (raw && !/^-?\d+$/.test(raw)) {
          issues.push({ row: rowNo, field, message: `${field} 必须为整数` });
        }
      }
      const key = `${skuCode}::${warehouse}::${recordedDate || 'today'}`;
      if (seen.has(key)) {
        issues.push({ row: rowNo, message: `重复行: ${skuCode} @ ${warehouse}` });
      }
      seen.add(key);
    }
  });

  return issues;
}

export async function createImportBatch(params: {
  type: ImportType;
  fileName?: string;
  rowCount: number;
  userId: string;
  progressMeta?: ImportBatchProgressMeta;
}) {
  await abandonStalePendingBatches(params.type);

  const [batch] = await db
    .insert(importBatches)
    .values({
      type: params.type,
      fileName: params.fileName ? sanitizeDbText(params.fileName) : undefined,
      rowCount: params.rowCount,
      createdBy: params.userId,
      status: 'pending',
      errorSummary: params.progressMeta ? encodeProgressSummary(params.progressMeta) : null,
    })
    .returning();
  return batch;
}

export async function updateImportBatchProgress(
  batchId: string,
  update: {
    insertedDailyRows: number;
    processedSkuWideRows: number;
    phase?: ImportBatchProgressMeta['phase'];
    estimatedDailyRows?: number;
  },
): Promise<void> {
  const [existing] = await db
    .select({ errorSummary: importBatches.errorSummary })
    .from(importBatches)
    .where(eq(importBatches.id, batchId))
    .limit(1);

  const prev = parseImportBatchProgressMeta(existing?.errorSummary) ?? {};
  const meta: ImportBatchProgressMeta = {
    estimatedDailyRows: update.estimatedDailyRows ?? prev.estimatedDailyRows,
    processedSkuWideRows: update.processedSkuWideRows,
    phase: update.phase ?? prev.phase ?? 'writing',
  };

  await db
    .update(importBatches)
    .set({
      successCount: update.insertedDailyRows,
      errorSummary: encodeProgressSummary(meta),
    })
    .where(and(eq(importBatches.id, batchId), eq(importBatches.status, 'pending')));
}

export async function finalizeImportBatch(
  batchId: string,
  result: ImportResult,
): Promise<{ status: 'success' | 'partial' | 'failed'; batchId: string }> {
  const successCount = result.imported;
  const errorCount = result.errors.length;
  let status: 'success' | 'partial' | 'failed' = 'success';
  if (successCount === 0 && errorCount > 0) status = 'failed';
  else if (errorCount > 0) status = 'partial';

  await db
    .update(importBatches)
    .set({
      successCount,
      errorCount,
      status,
      errorSummary: result.errors.slice(0, 20).join('\n') || null,
    })
    .where(eq(importBatches.id, batchId));

  return { status, batchId };
}

export type ImportBatchListRow = {
  id: string;
  type: string;
  fileName: string | null;
  rowCount: number;
  successCount: number;
  errorCount: number;
  status: string;
  errorSummary: string | null;
  createdAt: Date;
  dailyRowsWritten?: number;
  progressMeta?: ImportBatchProgressMeta | null;
};

async function enrichImportBatchRows(rows: ImportBatchListRow[]): Promise<ImportBatchListRow[]> {
  const salesBatchIds = rows.filter((row) => row.type === 'sales').map((row) => row.id);
  const dailyCounts = await countDailyRowsByBatchIds(salesBatchIds);

  return rows.map((row) => {
    const dailyRowsWritten =
      row.type === 'sales' ? (dailyCounts.get(row.id) ?? row.successCount) : undefined;
    const progressMeta =
      row.status === 'pending' ? parseImportBatchProgressMeta(row.errorSummary) : null;
    const errorSummary =
      row.status === 'pending' ? row.errorSummary : stripProgressSummary(row.errorSummary);

    return {
      ...row,
      errorSummary,
      dailyRowsWritten,
      progressMeta,
    };
  });
}

export async function listImportBatches(type?: string, limit = 20) {
  const columns = {
    id: importBatches.id,
    type: importBatches.type,
    fileName: importBatches.fileName,
    rowCount: importBatches.rowCount,
    successCount: importBatches.successCount,
    errorCount: importBatches.errorCount,
    status: importBatches.status,
    errorSummary: importBatches.errorSummary,
    createdAt: importBatches.createdAt,
  };

  if (type) {
    const rows = await db
      .select(columns)
      .from(importBatches)
      .where(eq(importBatches.type, type))
      .orderBy(desc(importBatches.createdAt))
      .limit(limit);
    return enrichImportBatchRows(rows);
  }

  const rows = await db.select(columns).from(importBatches).orderBy(desc(importBatches.createdAt)).limit(limit);
  return enrichImportBatchRows(rows);
}
