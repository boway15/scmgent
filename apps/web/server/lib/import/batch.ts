import { eq, desc } from 'drizzle-orm';
import { db, importBatches } from '@scm/db';
import type { ImportType } from './handlers.js';
import type { ImportResult } from './handlers.js';

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
  const issues: ImportValidationIssue[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const rowNo = index + 1;
    const skuCode = (row.sku_code || row.code || '').trim();

    if (type === 'inventory' || type === 'sales' || type === 'safety_stock' || type === 'sales_forecast') {
      if (!skuCode) {
        issues.push({ row: rowNo, field: 'sku_code', message: '缺少 sku_code' });
      } else if (!skuCodes.has(skuCode)) {
        issues.push({ row: rowNo, field: 'sku_code', message: `SKU 不存在: ${skuCode}` });
      }
    }

    if (type === 'merchants') {
      const merchantCode = (row.merchant_code || row.code || '').trim();
      if (!merchantCode) {
        issues.push({ row: rowNo, field: 'merchant_code', message: '缺少 merchant_code' });
      }
    }

    if (type === 'warehouse_leads') {
      const warehouse = (row.warehouse_code || row.warehouse || '').trim();
      if (!warehouse) {
        issues.push({ row: rowNo, field: 'warehouse_code', message: '缺少 warehouse_code' });
      } else if (!warehouseCodes.has(warehouse)) {
        issues.push({ row: rowNo, field: 'warehouse_code', message: `仓库编码无效: ${warehouse}` });
      }
    }

    if (type === 'safety_stock') {
      const warehouse = (row.warehouse_code || row.warehouse || 'ALL').trim();
      if (warehouse !== 'ALL' && !warehouseCodes.has(warehouse)) {
        issues.push({ row: rowNo, field: 'warehouse_code', message: `仓库编码无效: ${warehouse}` });
      }
    }

    if (type === 'inventory') {
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

    if (type === 'sales') {
      const saleDate = (row.sale_date || '').trim();
      if (!saleDate) {
        issues.push({ row: rowNo, field: 'sale_date', message: '缺少 sale_date' });
      } else if (!isValidDate(saleDate)) {
        issues.push({ row: rowNo, field: 'sale_date', message: `日期格式无效: ${saleDate}` });
      }
      const qtySold = (row.qty_sold || '').trim();
      if (!qtySold || !/^\d+$/.test(qtySold)) {
        issues.push({ row: rowNo, field: 'qty_sold', message: 'qty_sold 必须为正整数' });
      }
      const warehouse = (row.warehouse_code || row.warehouse || '').trim();
      if (warehouse && !warehouseCodes.has(warehouse) && warehouse !== 'IN-PRODUCTION') {
        issues.push({ row: rowNo, field: 'warehouse_code', message: `仓库编码无效: ${warehouse}` });
      }
      const key = `${skuCode}::${saleDate}::${warehouse}`;
      if (seen.has(key)) {
        issues.push({ row: rowNo, message: `重复行: ${skuCode} @ ${saleDate}` });
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
}) {
  const [batch] = await db
    .insert(importBatches)
    .values({
      type: params.type,
      fileName: params.fileName,
      rowCount: params.rowCount,
      createdBy: params.userId,
      status: 'pending',
    })
    .returning();
  return batch;
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
    return db
      .select(columns)
      .from(importBatches)
      .where(eq(importBatches.type, type))
      .orderBy(desc(importBatches.createdAt))
      .limit(limit);
  }

  return db.select(columns).from(importBatches).orderBy(desc(importBatches.createdAt)).limit(limit);
}
