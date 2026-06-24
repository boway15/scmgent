import { eq, and } from 'drizzle-orm';
import {
  db,
  skus,
  merchants,
  warehouses,
  inventoryRecords,
  salesHistory,
  salesForecastMonthly,
  safetyStockConfig,
  pmcPlans,
  pmcPlanItems,
} from '@scm/db';
import { pickField, rowsToObjects, parseDelimitedText } from './parse.js';
import { nextPlanNo } from '../../routes/procurement.js';
import { upsertSkuSupplierFromImport } from '../product-master.js';
import { IN_PRODUCTION_WAREHOUSE } from '../inventory-constants.js';
import { normalizeReplenishLight, parseReplenishLight } from '../replenish-light.js';
import { parseMonthlyForecastFromRow } from '../forecast-demand.js';
import { ensureSpuFromSkuEncoding } from '../spu-from-sku.js';
import { skuEncodingToColumns } from '../sku-encoding.js';

export type ImportResult = { imported: number; errors: string[] };

async function resolveSku(code: string): Promise<{ id: string; unit: string } | null> {
  const [sku] = await db.select().from(skus).where(eq(skus.code, code)).limit(1);
  return sku ? { id: sku.id, unit: sku.unit } : null;
}

export async function importSkuRows(
  rows: Array<Record<string, string>>,
): Promise<ImportResult> {
  let imported = 0;
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
    const merchantName = pickField(row, 'merchant_name');
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
          updatedAt: new Date(),
        })
        .where(eq(skus.id, existing.id));

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
        })
        .returning({ id: skus.id });

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

  return { imported, errors };
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

export async function importWarehouseLeadRows(
  rows: Array<Record<string, string>>,
): Promise<ImportResult> {
  let imported = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const code = pickField(row, 'warehouse_code', 'warehouse');
    if (!code) {
      errors.push(`Missing warehouse_code: ${JSON.stringify(row)}`);
      continue;
    }
    const shippingLeadDays =
      parseInt(pickField(row, 'shipping_lead_days', 'sea_lead_days'), 10) || undefined;
    const inboundBufferDays =
      parseInt(pickField(row, 'inbound_buffer_days', 'buffer_days'), 10) || undefined;

    const [existing] = await db.select().from(warehouses).where(eq(warehouses.code, code)).limit(1);
    if (!existing) {
      errors.push(`Warehouse not found: ${code}`);
      continue;
    }

    await db
      .update(warehouses)
      .set({
        shippingLeadDays: shippingLeadDays ?? existing.shippingLeadDays,
        inboundBufferDays: inboundBufferDays ?? existing.inboundBufferDays,
      })
      .where(eq(warehouses.id, existing.id));
    imported++;
  }

  return { imported, errors };
}

export async function importSalesForecastRows(
  rows: Array<Record<string, string>>,
  batchId?: string,
): Promise<ImportResult> {
  let imported = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const code = pickField(row, 'sku_code', 'code', 'sku');
    const station = (pickField(row, 'station', '站点') || 'US').toUpperCase();
    const forecastYear =
      parseInt(pickField(row, 'forecast_year', 'year', '预测年份'), 10) ||
      new Date().getFullYear();
    const lifecycle = pickField(row, 'lifecycle', '生命周期') || undefined;
    const ownerName = pickField(row, 'owner_name', 'owner', '负责人') || undefined;
    const productionLeadDays =
      parseInt(pickField(row, 'production_lead_days', '采购周期'), 10) || undefined;

    if (!code) {
      errors.push(`Missing sku_code: ${JSON.stringify(row)}`);
      continue;
    }

    const sku = await resolveSku(code);
    if (!sku) {
      errors.push(`SKU not found: ${code}`);
      continue;
    }

    if (productionLeadDays) {
      await db
        .update(skus)
        .set({ leadTimeDays: productionLeadDays, updatedAt: new Date() })
        .where(eq(skus.id, sku.id));
    }

    const months = parseMonthlyForecastFromRow(row);
    if (!months.length) {
      errors.push(`No monthly forecast columns for SKU ${code}`);
      continue;
    }

    for (const { month, daily } of months) {
      const [existing] = await db
        .select()
        .from(salesForecastMonthly)
        .where(
          and(
            eq(salesForecastMonthly.skuId, sku.id),
            eq(salesForecastMonthly.station, station),
            eq(salesForecastMonthly.forecastYear, forecastYear),
            eq(salesForecastMonthly.month, month),
          ),
        )
        .limit(1);

      const values = {
        forecastDailyAvg: String(daily),
        lifecycle,
        ownerName,
        source: 'import' as const,
        importBatchId: batchId,
        updatedAt: new Date(),
      };

      if (existing) {
        await db
          .update(salesForecastMonthly)
          .set(values)
          .where(eq(salesForecastMonthly.id, existing.id));
      } else {
        await db.insert(salesForecastMonthly).values({
          skuId: sku.id,
          station,
          forecastYear,
          month,
          ...values,
        });
      }
      imported++;
    }
  }

  return { imported, errors };
}

export async function importInventoryRows(
  rows: Array<Record<string, string>>,
  userId: string,
  batchId?: string,
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

  return { imported, errors };
}

export async function importSalesRows(
  rows: Array<Record<string, string>>,
  batchId?: string,
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
      out[normalizeImportKey(k)] = String(v ?? '').trim();
    }
    return out;
  });
}

function normalizeImportKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, '_');
}

export type ImportType =
  | 'skus'
  | 'inventory'
  | 'sales'
  | 'safety_stock'
  | 'merchants'
  | 'warehouse_leads'
  | 'sales_forecast'
  | 'pmc_plans';

export async function runImport(
  type: ImportType,
  rows: Array<Record<string, string>>,
  userId: string,
  planMeta?: { name?: string; planDate?: string; deliveryDate?: string; merchantCode?: string; merchantName?: string },
  batchId?: string,
): Promise<ImportResult> {
  switch (type) {
    case 'skus':
      return importSkuRows(rows);
    case 'inventory':
      return importInventoryRows(rows, userId, batchId);
    case 'sales':
      return importSalesRows(rows, batchId);
    case 'safety_stock':
      return importSafetyStockRows(rows);
    case 'merchants':
      return importMerchantRows(rows);
    case 'warehouse_leads':
      return importWarehouseLeadRows(rows);
    case 'sales_forecast':
      return importSalesForecastRows(rows, batchId);
    case 'pmc_plans':
      return importPmcPlanRows(rows, userId, planMeta);
    default:
      return { imported: 0, errors: [`Unknown import type: ${type}`] };
  }
}
