import { eq, and } from 'drizzle-orm';
import { db, skus, spus, inventoryRecords, salesHistory, safetyStockConfig, pmcPlans, pmcPlanItems, } from '../../_db/index.js';
import { pickField, rowsToObjects, parseDelimitedText } from './parse.js';
import { nextPlanNo } from '../../routes/procurement.js';
import { upsertSkuSupplierFromImport } from '../product-master.js';
import { IN_PRODUCTION_WAREHOUSE } from '../inventory-constants.js';
import { parseReplenishLight } from '../replenish-light.js';
async function resolveSpuId(spuCode, skuCode, name, category, spuMoq) {
    const code = spuCode?.trim() || skuCode;
    const [existing] = await db.select().from(spus).where(eq(spus.code, code)).limit(1);
    if (existing) {
        if (spuMoq != null && spuMoq > 0 && existing.moq !== spuMoq) {
            await db.update(spus).set({ moq: spuMoq, updatedAt: new Date() }).where(eq(spus.id, existing.id));
        }
        return existing.id;
    }
    const [created] = await db
        .insert(spus)
        .values({ code, name, category, moq: spuMoq, isActive: true, updatedAt: new Date() })
        .returning({ id: spus.id });
    return created?.id;
}
async function resolveSku(code) {
    const [sku] = await db.select().from(skus).where(eq(skus.code, code)).limit(1);
    return sku ? { id: sku.id, unit: sku.unit } : null;
}
export async function importSkuRows(rows) {
    let imported = 0;
    const errors = [];
    for (const row of rows) {
        const code = pickField(row, 'sku_code', 'code');
        const name = pickField(row, 'name');
        const unit = pickField(row, 'unit') || 'pcs';
        if (!code || !name) {
            errors.push(`Missing code/name: ${JSON.stringify(row)}`);
            continue;
        }
        const spuCode = pickField(row, 'spu_code');
        const merchantCode = pickField(row, 'merchant_code');
        const merchantName = pickField(row, 'merchant_name');
        const unitCost = pickField(row, 'unit_cost');
        const leadTimeDays = parseInt(pickField(row, 'lead_time_days', 'lead_time'), 10) || undefined;
        const moq = parseInt(pickField(row, 'moq'), 10) || undefined;
        const spuMoq = parseInt(pickField(row, 'spu_moq'), 10) || undefined;
        const spuId = await resolveSpuId(spuCode, code, name, pickField(row, 'category') || undefined, spuMoq);
        const replenishLightRaw = pickField(row, 'replenish_light', 'replenish_light_code', 'light');
        const parsedLight = parseReplenishLight(replenishLightRaw);
        const [existing] = await db.select().from(skus).where(eq(skus.code, code)).limit(1);
        if (existing) {
            await db
                .update(skus)
                .set({
                name,
                unit,
                spuId: spuId ?? existing.spuId,
                category: pickField(row, 'category') || existing.category,
                leadTimeDays: leadTimeDays ?? existing.leadTimeDays,
                moq: moq ?? existing.moq,
                unitCost: unitCost || existing.unitCost,
                replenishLight: parsedLight ?? existing.replenishLight,
                updatedAt: new Date(),
            })
                .where(eq(skus.id, existing.id));
            if (merchantCode) {
                await upsertSkuSupplierFromImport(existing.id, merchantCode, merchantName, {
                    unitPrice: unitCost || existing.unitCost || undefined,
                    leadTimeDays: leadTimeDays ?? existing.leadTimeDays ?? undefined,
                    moq: moq ?? existing.moq ?? undefined,
                });
            }
        }
        else {
            const [created] = await db
                .insert(skus)
                .values({
                code,
                name,
                unit,
                spuId,
                category: pickField(row, 'category') || undefined,
                leadTimeDays,
                moq,
                unitCost: unitCost || undefined,
                replenishLight: parsedLight ?? 'red',
                isActive: true,
            })
                .returning({ id: skus.id });
            if (created && merchantCode) {
                await upsertSkuSupplierFromImport(created.id, merchantCode, merchantName, {
                    unitPrice: unitCost || undefined,
                    leadTimeDays,
                    moq,
                });
            }
        }
        imported++;
    }
    return { imported, errors };
}
export async function importInventoryRows(rows, userId, batchId) {
    let imported = 0;
    const errors = [];
    for (const row of rows) {
        const code = pickField(row, 'sku_code', 'code');
        const sku = await resolveSku(code);
        if (!sku) {
            errors.push(`SKU not found: ${code}`);
            continue;
        }
        const warehouse = pickField(row, 'warehouse', 'warehouse_code') || 'US-WEST';
        const qtyInProduction = parseInt(pickField(row, 'qty_in_production'), 10) || 0;
        const recordedDate = pickField(row, 'recorded_date') || new Date().toISOString().slice(0, 10);
        if (warehouse === IN_PRODUCTION_WAREHOUSE) {
            await db.insert(inventoryRecords).values({
                skuId: sku.id,
                warehouse: IN_PRODUCTION_WAREHOUSE,
                qtyAvailable: 0,
                qtyInTransit: 0,
                qtyInProduction,
                recordedDate,
                source: 'import',
                importBatchId: batchId,
                createdBy: userId,
            });
        }
        else {
            await db.insert(inventoryRecords).values({
                skuId: sku.id,
                warehouse,
                qtyAvailable: parseInt(pickField(row, 'qty_available'), 10) || 0,
                qtyInTransit: parseInt(pickField(row, 'qty_in_transit'), 10) || 0,
                qtyInProduction: 0,
                recordedDate,
                source: 'import',
                importBatchId: batchId,
                createdBy: userId,
            });
            if (qtyInProduction > 0) {
                await db.insert(inventoryRecords).values({
                    skuId: sku.id,
                    warehouse: IN_PRODUCTION_WAREHOUSE,
                    qtyAvailable: 0,
                    qtyInTransit: 0,
                    qtyInProduction,
                    recordedDate,
                    source: 'import',
                    createdBy: userId,
                });
            }
        }
        imported++;
    }
    return { imported, errors };
}
export async function importSalesRows(rows, batchId) {
    let imported = 0;
    const errors = [];
    for (const row of rows) {
        const code = pickField(row, 'sku_code', 'code');
        const sku = await resolveSku(code);
        if (!sku) {
            errors.push(`SKU not found: ${code}`);
            continue;
        }
        await db.insert(salesHistory).values({
            skuId: sku.id,
            saleDate: pickField(row, 'sale_date'),
            qtySold: parseInt(pickField(row, 'qty_sold'), 10) || 0,
            channel: pickField(row, 'channel') || undefined,
            warehouseCode: pickField(row, 'warehouse_code', 'warehouse') || undefined,
            source: 'import',
            importBatchId: batchId,
        });
        imported++;
    }
    return { imported, errors };
}
export async function importSafetyStockRows(rows) {
    let imported = 0;
    const errors = [];
    for (const row of rows) {
        const code = pickField(row, 'sku_code', 'code');
        const sku = await resolveSku(code);
        if (!sku) {
            errors.push(`SKU not found: ${code}`);
            continue;
        }
        const warehouseCode = pickField(row, 'warehouse_code', 'warehouse') || 'ALL';
        const values = {
            safetyStockQty: parseInt(pickField(row, 'safety_stock_qty', 'safety_stock'), 10) || 0,
            reorderPoint: parseInt(pickField(row, 'reorder_point', 'rop'), 10) || 0,
            reorderQty: parseInt(pickField(row, 'reorder_qty', 'eoq'), 10) || 0,
            calcMethod: 'manual',
            updatedAt: new Date(),
        };
        const [existing] = await db
            .select()
            .from(safetyStockConfig)
            .where(and(eq(safetyStockConfig.skuId, sku.id), eq(safetyStockConfig.warehouseCode, warehouseCode)))
            .limit(1);
        if (existing) {
            await db.update(safetyStockConfig).set(values).where(eq(safetyStockConfig.id, existing.id));
        }
        else {
            await db.insert(safetyStockConfig).values({ skuId: sku.id, warehouseCode, ...values });
        }
        imported++;
    }
    return { imported, errors };
}
export async function importPmcPlanRows(rows, userId, planMeta) {
    let imported = 0;
    const errors = [];
    if (!rows.length)
        return { imported, errors };
    const first = rows[0];
    const planName = planMeta?.name || pickField(first, 'plan_name', 'name') || `下单计划-${new Date().toISOString().slice(0, 10)}`;
    const merchantCode = planMeta?.merchantCode || pickField(first, 'merchant_code') || pickField(first, 'merchant');
    if (!merchantCode) {
        return { imported: 0, errors: ['merchant_code required for plan import'] };
    }
    const merchantName = planMeta?.merchantName || pickField(first, 'merchant_name') || undefined;
    const planDate = planMeta?.planDate || pickField(first, 'plan_date') || new Date().toISOString().slice(0, 10);
    const deliveryDate = planMeta?.deliveryDate ||
        pickField(first, 'delivery_date') ||
        new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const planNo = await nextPlanNo();
    const [plan] = await db
        .insert(pmcPlans)
        .values({
        planNo,
        name: planName,
        merchantCode,
        merchantName,
        planDate: new Date(planDate),
        deliveryDate: new Date(deliveryDate),
        status: 'draft',
        createdBy: userId,
    })
        .returning();
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const code = pickField(row, 'sku_code', 'code');
        const qty = parseInt(pickField(row, 'planned_qty', 'qty'), 10);
        if (!code || !qty) {
            errors.push(`Row ${i + 1}: missing sku_code or planned_qty`);
            continue;
        }
        const sku = await resolveSku(code);
        if (!sku) {
            errors.push(`SKU not found: ${code}`);
            continue;
        }
        await db.insert(pmcPlanItems).values({
            planId: plan.id,
            skuId: sku.id,
            plannedQty: qty,
            unit: pickField(row, 'unit') || sku.unit,
            sortOrder: i,
        });
        imported++;
    }
    return { imported, errors };
}
export function parseImportContent(content) {
    return rowsToObjects(parseDelimitedText(content));
}
export async function parseXlsxBuffer(buffer) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName)
        return [];
    const sheet = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return json.map((row) => {
        const out = {};
        for (const [k, v] of Object.entries(row)) {
            out[normalizeImportKey(k)] = String(v ?? '').trim();
        }
        return out;
    });
}
function normalizeImportKey(key) {
    return key.toLowerCase().replace(/\s+/g, '_');
}
export async function runImport(type, rows, userId, planMeta, batchId) {
    switch (type) {
        case 'skus':
            return importSkuRows(rows);
        case 'inventory':
            return importInventoryRows(rows, userId, batchId);
        case 'sales':
            return importSalesRows(rows, batchId);
        case 'safety_stock':
            return importSafetyStockRows(rows);
        case 'pmc_plans':
            return importPmcPlanRows(rows, userId, planMeta);
        default:
            return { imported: 0, errors: [`Unknown import type: ${type}`] };
    }
}
