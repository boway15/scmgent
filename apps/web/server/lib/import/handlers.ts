import { eq, and } from 'drizzle-orm';
import {
  db,
  skus,
  merchants,
  warehouses,
  inventoryRecords,
  safetyStockConfig,
  pmcPlans,
  pmcPlanItems,
} from '@scm/db';
import { pickField, rowsToObjects, parseDelimitedText, decodeCsvBytes } from './parse.js';
import { nextPlanNo } from '../../routes/procurement.js';
import { upsertSkuSupplierFromImport } from '../product-master.js';
import { IN_PRODUCTION_WAREHOUSE } from '../inventory-constants.js';
import { normalizeReplenishLight, parseReplenishLight } from '../replenish-light.js';
import { ensureSpuFromSkuEncoding } from '../spu-from-sku.js';
import { skuEncodingToColumns } from '../sku-encoding.js';
import { ensureSkuFromImport } from '../ensure-sku-from-import.js';
import {
  expandFobInventoryRows,
  isFobInventoryFormat,
} from '../fob-inventory-import.js';
import { formatXlsxCellValue } from '../turnover-date-format.js';
import {
  importXiaoshouSalesHistory,
  type SalesXiaoshouWideInput,
} from './sales-xiaoshou.js';

export type { SalesXiaoshouWideInput };

export type ImportResult = {
  imported: number;
  errors: string[];
  createdSkus?: number;
  updatedSkus?: number;
};

async function resolveSku(code: string): Promise<{ id: string; unit: string; category?: string | null } | null> {
  const [sku] = await db
    .select({ id: skus.id, unit: skus.unit, category: skus.category })
    .from(skus)
    .where(eq(skus.code, code))
    .limit(1);
  return sku ? { id: sku.id, unit: sku.unit, category: sku.category } : null;
}

export async function importSkuRows(
  rows: Array<Record<string, string>>,
): Promise<ImportResult> {
  let imported = 0;
  let createdSkus = 0;
  let updatedSkus = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const rawCode = pickField(row, 'sku_code', 'code', 'internal_code');
    const externalCode = pickField(row, 'external_code', 'external_sku', 'sku_external');
    const name = pickField(row, 'name');
    const unit = pickField(row, 'unit') || 'pcs';
    if ((!rawCode && !externalCode) || !name) {
      errors.push(`Missing code/name: ${JSON.stringify(row)}`);
      continue;
    }

    const spuCodeManual = pickField(row, 'spu_code');
    const merchantCode = pickField(row, 'merchant_code');
    const merchantName = pickField(row, 'merchant_name', 'supplier_name', 'supplier');
    const unitCost = pickField(row, 'unit_cost');
    const leadTimeDays = parseInt(pickField(row, 'lead_time_days', 'lead_time'), 10) || undefined;
    const productionLeadDays =
      parseInt(pickField(row, 'production_lead_days', 'factory_lead_days'), 10) || undefined;
    const moq = parseInt(pickField(row, 'moq'), 10) || undefined;
    const spuMoq = parseInt(pickField(row, 'spu_moq'), 10) || undefined;
    const category = pickField(row, 'category') || undefined;

    const { spuId, parse } = await ensureSpuFromSkuEncoding(rawCode || externalCode, externalCode, {
      name,
      category,
      moq: spuMoq,
      spuCodeOverride: spuCodeManual || undefined,
    });

    const code = parse.normalizedCode || rawCode || externalCode;
    const encodingCols = skuEncodingToColumns(parse);

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
          category: category || existing.category,
          leadTimeDays: leadTimeDays ?? existing.leadTimeDays,
          moq: moq ?? existing.moq,
          unitCost: unitCost || existing.unitCost,
          replenishLight: parsedLight ?? existing.replenishLight,
          ...encodingCols,
          encodingMeta: { masterDataSource: 'sku_import' },
          updatedAt: new Date(),
        })
        .where(eq(skus.id, existing.id));
      updatedSkus++;

      if (merchantCode) {
        await upsertSkuSupplierFromImport(existing.id, merchantCode, merchantName, {
          unitPrice: unitCost || existing.unitCost || undefined,
          leadTimeDays: productionLeadDays ?? leadTimeDays ?? existing.leadTimeDays ?? undefined,
          moq: moq ?? existing.moq ?? undefined,
        });
        if (productionLeadDays) {
          await upsertMerchantProductionLead(merchantCode, merchantName, productionLeadDays);
        }
      }
    } else {
      const [created] = await db
        .insert(skus)
        .values({
          code,
          name,
          unit,
          spuId,
          category,
          leadTimeDays,
          moq,
          unitCost: unitCost || undefined,
          replenishLight: parsedLight ?? 'red',
          isActive: true,
          ...encodingCols,
          encodingMeta: { masterDataSource: 'sku_import' },
        })
        .returning({ id: skus.id });

      if (created) createdSkus++;

      if (created && merchantCode) {
        await upsertSkuSupplierFromImport(created.id, merchantCode, merchantName, {
          unitPrice: unitCost || undefined,
          leadTimeDays: productionLeadDays ?? leadTimeDays,
          moq,
        });
        if (productionLeadDays) {
          await upsertMerchantProductionLead(merchantCode, merchantName, productionLeadDays);
        }
      }
    }
    imported++;
  }

  return { imported, errors, createdSkus, updatedSkus };
}

async function upsertMerchantProductionLead(
  merchantCode: string,
  merchantName: string | undefined,
  productionLeadDays: number,
) {
  const [existing] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.code, merchantCode))
    .limit(1);
  if (existing) {
    await db
      .update(merchants)
      .set({
        productionLeadDays,
        name: merchantName?.trim() || existing.name,
        updatedAt: new Date(),
      })
      .where(eq(merchants.id, existing.id));
    return;
  }
  await db.insert(merchants).values({
    code: merchantCode,
    name: merchantName?.trim() || merchantCode,
    productionLeadDays,
    isActive: true,
    updatedAt: new Date(),
  });
}

export async function importMerchantRows(
  rows: Array<Record<string, string>>,
): Promise<ImportResult> {
  let imported = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const code = pickField(row, 'merchant_code', 'code');
    const name = pickField(row, 'merchant_name', 'name');
    if (!code) {
      errors.push(`Missing merchant_code: ${JSON.stringify(row)}`);
      continue;
    }
    const productionLeadDays =
      parseInt(pickField(row, 'production_lead_days', 'factory_lead_days'), 10) ||
      undefined;

    const [existing] = await db.select().from(merchants).where(eq(merchants.code, code)).limit(1);
    if (existing) {
      await db
        .update(merchants)
        .set({
          name: name || existing.name,
          contactName: pickField(row, 'contact_name') || existing.contactName,
          contactPhone: pickField(row, 'contact_phone') || existing.contactPhone,
          contactEmail: pickField(row, 'contact_email') || existing.contactEmail,
          paymentTerms: pickField(row, 'payment_terms') || existing.paymentTerms,
          productionLeadDays: productionLeadDays ?? existing.productionLeadDays,
          updatedAt: new Date(),
        })
        .where(eq(merchants.id, existing.id));
    } else {
      await db.insert(merchants).values({
        code,
        name: name || code,
        contactName: pickField(row, 'contact_name') || undefined,
        contactPhone: pickField(row, 'contact_phone') || undefined,
        contactEmail: pickField(row, 'contact_email') || undefined,
        paymentTerms: pickField(row, 'payment_terms') || undefined,
        productionLeadDays: productionLeadDays ?? 50,
        isActive: true,
        updatedAt: new Date(),
      });
    }
    imported++;
  }

  return { imported, errors };
}

export async function importInventoryRows(
  rows: Array<Record<string, string>>,
  userId: string,
  batchId?: string,
): Promise<ImportResult> {
  if (isFobInventoryFormat(rows)) {
    return importFobInventoryRows(rows, userId, batchId);
  }

  let imported = 0;
  let createdSkus = 0;
  let enrichedSkus = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const code = pickField(row, 'sku_code', 'code', 'sku');
    if (!code) {
      errors.push(`Missing sku_code: ${JSON.stringify(row)}`);
      continue;
    }

    const ensured = await ensureSkuFromImport({
      rawCode: code,
      name: pickField(row, 'name', '品名') || code,
      category: pickField(row, 'category', '品类') || undefined,
      source: 'inventory',
    });
    if (!ensured) {
      errors.push(`SKU could not be created: ${code}`);
      continue;
    }
    if (ensured.created) createdSkus++;
    else if (ensured.updated) enrichedSkus++;

    const sku = { id: ensured.id, unit: ensured.unit };

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
    } else {
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

  return { imported, errors, createdSkus, updatedSkus: enrichedSkus };
}

async function importFobInventoryRows(
  rows: Array<Record<string, string>>,
  userId: string,
  batchId?: string,
): Promise<ImportResult> {
  const expanded = expandFobInventoryRows(rows);
  let imported = 0;
  let createdSkus = 0;
  let enrichedSkus = 0;
  const errors: string[] = [];
  const merchantLeadDone = new Set<string>();
  type InvRow = {
    skuId: string;
    warehouse: string;
    qtyAvailable: number;
    qtyInTransit: number;
    qtyInProduction: number;
    qtyReserved: number;
    recordedDate: string;
  };
  const pendingInventory: InvRow[] = [];
  const FLUSH_SIZE = 250;

  async function flushInventory() {
    if (!pendingInventory.length) return;
    const chunk = pendingInventory.splice(0, pendingInventory.length);
    await db.insert(inventoryRecords).values(
      chunk.map((row) => ({
        skuId: row.skuId,
        warehouse: row.warehouse,
        qtyAvailable: row.qtyAvailable,
        qtyInTransit: row.qtyInTransit,
        qtyInProduction: row.qtyInProduction,
        qtyReserved: row.qtyReserved,
        recordedDate: row.recordedDate,
        source: 'import' as const,
        importBatchId: batchId,
        createdBy: userId,
      })),
    );
  }

  for (const row of expanded) {
    try {
      const ensured = await ensureSkuFromImport({
        rawCode: row.skuCode,
        name: row.name,
        category: row.category,
        lifecycle: row.lifecycle,
        salesCountry: row.salesCountry,
        productCategory: row.productCategory,
        merchantCode: row.merchantCode,
        ownerName: row.ownerName,
        developerName: row.developerName,
        merchantName: row.merchantName,
        leadTimeDays: row.leadTimeDays,
        unitCost: row.unitCost,
        turnoverSnapshot: row.turnoverSnapshot,
        source: 'inventory',
      });
      if (!ensured) {
        errors.push(`SKU could not be created: ${row.skuCode}`);
        continue;
      }
      if (ensured.created) createdSkus++;
      else if (ensured.updated) enrichedSkus++;

      if (row.merchantCode) {
        await upsertSkuSupplierFromImport(ensured.id, row.merchantCode, row.merchantName, {
          unitPrice: row.unitCost,
          leadTimeDays: row.leadTimeDays,
        });
        if (row.leadTimeDays && !merchantLeadDone.has(row.merchantCode)) {
          await upsertMerchantProductionLead(row.merchantCode, row.merchantName, row.leadTimeDays);
          merchantLeadDone.add(row.merchantCode);
        }
      }

      const qtyPreOrder = row.qtyPreOrder ?? 0;

      if (row.qtyInProduction > 0 || qtyPreOrder > 0) {
        pendingInventory.push({
          skuId: ensured.id,
          warehouse: IN_PRODUCTION_WAREHOUSE,
          qtyAvailable: 0,
          qtyInTransit: 0,
          qtyInProduction: row.qtyInProduction,
          qtyReserved: qtyPreOrder,
          recordedDate: row.recordedDate,
        });
        imported++;
      }

      const warehouseBuckets =
        row.warehouseBuckets && row.warehouseBuckets.length > 0
          ? row.warehouseBuckets
          : [
              {
                warehouse: row.warehouse,
                qtyAvailable: row.qtyAvailable,
                qtyInTransit: row.qtyInTransit,
              },
            ];

      for (const bucket of warehouseBuckets) {
        if (bucket.qtyAvailable > 0 || bucket.qtyInTransit > 0) {
          pendingInventory.push({
            skuId: ensured.id,
            warehouse: bucket.warehouse,
            qtyAvailable: bucket.qtyAvailable,
            qtyInTransit: bucket.qtyInTransit,
            qtyInProduction: 0,
            qtyReserved: 0,
            recordedDate: row.recordedDate,
          });
          imported++;
        }
      }

      if (
        !row.warehouseBuckets?.length &&
        row.qtyAvailable === 0 &&
        row.qtyInTransit === 0 &&
        row.qtyInProduction === 0 &&
        qtyPreOrder === 0
      ) {
        pendingInventory.push({
          skuId: ensured.id,
          warehouse: row.warehouse,
          qtyAvailable: 0,
          qtyInTransit: 0,
          qtyInProduction: 0,
          qtyReserved: 0,
          recordedDate: row.recordedDate,
        });
        imported++;
      }

      if (pendingInventory.length >= FLUSH_SIZE) {
        await flushInventory();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${row.skuCode}: ${message}`);
    }
  }

  await flushInventory();

  return { imported, errors, createdSkus, updatedSkus: enrichedSkus };
}

export async function importSalesRows(
  _rows: Array<Record<string, string>>,
  batchId?: string,
  xiaoshou?: SalesXiaoshouWideInput,
): Promise<ImportResult> {
  if (xiaoshou?.dailyWideRows?.length || xiaoshou?.tempFilePath) {
    return importXiaoshouSalesHistory({ ...xiaoshou, batchId });
  }

  return {
    imported: 0,
    errors: [
      '销量历史仅支持 xiaoshou 日销量宽表（产品销售报表-每日 CSV）。请上传日表，勿使用 sku_code,sale_date,qty_sold 长表或 SKU 月宽表。',
    ],
  };
}

export async function importSafetyStockRows(
  rows: Array<Record<string, string>>,
): Promise<ImportResult> {
  let imported = 0;
  const errors: string[] = [];

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
      safetyStockDays:
        parseInt(pickField(row, 'safety_stock_days'), 10) ||
        undefined,
      targetCoverageDays:
        parseInt(pickField(row, 'target_coverage_days'), 10) ||
        undefined,
      overstockThresholdDays:
        parseInt(pickField(row, 'overstock_threshold_days'), 10) ||
        undefined,
      calcMethod: 'manual' as const,
      updatedAt: new Date(),
    };

    const [existing] = await db
      .select()
      .from(safetyStockConfig)
      .where(
        and(eq(safetyStockConfig.skuId, sku.id), eq(safetyStockConfig.warehouseCode, warehouseCode)),
      )
      .limit(1);

    if (existing) {
      await db.update(safetyStockConfig).set(values).where(eq(safetyStockConfig.id, existing.id));
    } else {
      await db.insert(safetyStockConfig).values({ skuId: sku.id, warehouseCode, ...values });
    }
    imported++;
  }

  return { imported, errors };
}

export async function importPmcPlanRows(
  rows: Array<Record<string, string>>,
  userId: string,
  planMeta?: { name?: string; planDate?: string; deliveryDate?: string; merchantCode?: string; merchantName?: string },
): Promise<ImportResult> {
  let imported = 0;
  const errors: string[] = [];

  if (!rows.length) return { imported, errors };

  const first = rows[0];
  const planName = planMeta?.name || pickField(first, 'plan_name', 'name') || `下单计划-${new Date().toISOString().slice(0, 10)}`;
  const merchantCode =
    planMeta?.merchantCode || pickField(first, 'merchant_code') || pickField(first, 'merchant');
  if (!merchantCode) {
    return { imported: 0, errors: ['merchant_code required for plan import'] };
  }
  const merchantName = planMeta?.merchantName || pickField(first, 'merchant_name') || undefined;
  const planDate = planMeta?.planDate || pickField(first, 'plan_date') || new Date().toISOString().slice(0, 10);
  const deliveryDate =
    planMeta?.deliveryDate ||
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

export function parseImportContent(content: string): Array<Record<string, string>> {
  return rowsToObjects(parseDelimitedText(content));
}

export function parseImportBuffer(buffer: ArrayBuffer): Array<Record<string, string>> {
  return parseImportContent(decodeCsvBytes(buffer));
}

export async function parseXlsxBuffer(buffer: ArrayBuffer): Promise<Array<Record<string, string>>> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return json.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      out[normalizeImportKey(k)] = formatXlsxCellValue(k, v);
    }
    return out;
  });
}

function normalizeImportKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_');
}

export type ImportType =
  | 'skus'
  | 'inventory'
  | 'sales'
  | 'safety_stock'
  | 'merchants'
  | 'pmc_plans';

export async function runImport(
  type: ImportType,
  rows: Array<Record<string, string>>,
  userId: string,
  planMeta?: { name?: string; planDate?: string; deliveryDate?: string; merchantCode?: string; merchantName?: string },
  batchId?: string,
  salesXiaoshou?: SalesXiaoshouWideInput,
): Promise<ImportResult> {
  switch (type) {
    case 'skus':
      return importSkuRows(rows);
    case 'inventory':
      return importInventoryRows(rows, userId, batchId);
    case 'sales':
      return importSalesRows(rows, batchId, salesXiaoshou);
    case 'safety_stock':
      return importSafetyStockRows(rows);
    case 'merchants':
      return importMerchantRows(rows);
    case 'pmc_plans':
      return importPmcPlanRows(rows, userId, planMeta);
    default:
      return { imported: 0, errors: [`Unknown import type: ${type}`] };
  }
}
