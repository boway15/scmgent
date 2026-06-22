import { eq } from 'drizzle-orm';
import { db, skus, warehouses } from '../../_db/index.js';
import { validateImportPreview } from './batch.js';
export const BATCH_TRACKED_IMPORT_TYPES = new Set(['inventory', 'sales']);
export async function loadImportValidationSets() {
    const skuRows = await db.select({ code: skus.code }).from(skus);
    const whRows = await db
        .select({ code: warehouses.code })
        .from(warehouses)
        .where(eq(warehouses.isActive, true));
    return {
        skuCodes: new Set(skuRows.map((r) => r.code)),
        warehouseCodes: new Set([...whRows.map((r) => r.code), 'IN-PRODUCTION']),
    };
}
export async function buildImportPreviewResponse(type, rows) {
    const { skuCodes, warehouseCodes } = await loadImportValidationSets();
    const validationIssues = await validateImportPreview(type, rows, warehouseCodes, skuCodes);
    const headers = rows.length ? Object.keys(rows[0]) : [];
    return {
        rowCount: rows.length,
        headers,
        preview: rows.slice(0, 10),
        validationIssues,
        hasBlockingIssues: validationIssues.length > 0,
    };
}
