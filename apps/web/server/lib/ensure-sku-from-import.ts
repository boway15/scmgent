import { eq } from 'drizzle-orm';
import { db, skus } from '@scm/db';
import { ensureSpuFromSkuEncoding } from './spu-from-sku.js';
import { skuEncodingToColumns } from './sku-encoding.js';
import type { DailySalesRow } from './sales-report-parser.js';
import { sanitizeDbText } from './import/parse.js';
import {
  buildNextInventoryEncodingMeta,
  inventoryImportMasterUnchanged,
  inventoryMasterToSkuColumns,
  type InventorySkuMasterFields,
} from './inventory-sku-master.js';
import { readTurnoverSnapshot } from './inventory-turnover-snapshot.js';

export type SkuImportSource = 'daily_sales' | 'inventory' | 'sku_import';

/** 库存周转表 A:K 列对齐 SKU 主数据 */
export type InventorySkuMasterInput = Partial<InventorySkuMasterFields> & {
  rawCode: string;
  unitCost?: string;
  unit?: string;
  turnoverSnapshot?: Record<string, string>;
};

export type EnsureSkuInput = InventorySkuMasterInput & {
  source: SkuImportSource;
};

export type EnsureSkuResult = {
  id: string;
  code: string;
  unit: string;
  created: boolean;
  updated: boolean;
};

function buildInventoryMasterInput(input: EnsureSkuInput, code: string): InventorySkuMasterFields {
  return {
    category: input.category,
    skuCode: code,
    lifecycle: input.lifecycle,
    name: input.name || code,
    salesCountry: input.salesCountry,
    productCategory: input.productCategory,
    merchantCode: input.merchantCode,
    ownerName: input.ownerName,
    developerName: input.developerName,
    merchantName: input.merchantName,
    leadTimeDays: input.leadTimeDays,
  };
}

function resolveDailySalesSkuCode(rawCode: string, parse: { normalizedCode: string }): string {
  return sanitizeDbText(parse.normalizedCode || rawCode.trim());
}

export function collectDailySalesSkuStubs(
  rows: DailySalesRow[],
): Map<string, { name: string; category?: string }> {
  const stubs = new Map<string, { name: string; category?: string }>();

  for (const row of rows) {
    const code = sanitizeDbText(row.skuCode.trim());
    if (!code) continue;

    const name = row.skuName.trim() || code;
    const category = row.category.trim() || undefined;
    const existing = stubs.get(code);

    if (!existing) {
      stubs.set(code, { name, category });
      continue;
    }

    if (row.skuName.trim()) existing.name = row.skuName.trim();
    if (category) existing.category = category;
  }

  return stubs;
}

export async function ensureSkuFromImport(input: EnsureSkuInput): Promise<EnsureSkuResult | null> {
  const rawCode = sanitizeDbText(input.rawCode.trim());
  if (!rawCode) return null;

  const { spuId, parse } = await ensureSpuFromSkuEncoding(rawCode, undefined, {
    name: input.name ? sanitizeDbText(input.name) : undefined,
    category: input.category ? sanitizeDbText(input.category) : undefined,
  });
  const code = sanitizeDbText(parse.normalizedCode || rawCode);
  const encodingCols = skuEncodingToColumns(parse);
  const inventoryCols =
    input.source === 'inventory'
      ? inventoryMasterToSkuColumns(buildInventoryMasterInput(input, code))
      : null;
  const displayName = sanitizeDbText(inventoryCols?.name || input.name?.trim() || rawCode);

  const [existing] = await db.select().from(skus).where(eq(skus.code, code)).limit(1);

  if (!existing) {
    let created: { id: string; code: string; unit: string } | undefined;
    try {
      [created] = await db
        .insert(skus)
        .values({
          code,
          name: displayName,
          unit: input.unit?.trim() || 'pcs',
          spuId,
          category: inventoryCols?.category ?? input.category,
          lifecycle: inventoryCols?.lifecycle,
          salesCountry: inventoryCols?.salesCountry,
          productCategory: inventoryCols?.productCategory,
          ownerName: inventoryCols?.ownerName,
          developerName: inventoryCols?.developerName,
          merchantCode: inventoryCols?.merchantCode ?? input.merchantCode,
          merchantName: inventoryCols?.merchantName ?? input.merchantName,
          leadTimeDays: inventoryCols?.leadTimeDays ?? input.leadTimeDays,
          unitCost: input.unitCost || undefined,
          replenishLight: 'red',
          isActive: true,
          ...encodingCols,
          encodingMeta:
            input.source === 'inventory'
              ? buildNextInventoryEncodingMeta(
                  buildInventoryMasterInput(input, code),
                  code,
                  undefined,
                  input.turnoverSnapshot ?? {},
                )
              : { masterDataSource: input.source },
          updatedAt: new Date(),
        })
        .returning({ id: skus.id, code: skus.code, unit: skus.unit });
    } catch (err) {
      const pg = err as { code?: string };
      if (pg.code === '23505') {
        const [retry] = await db.select().from(skus).where(eq(skus.code, code)).limit(1);
        if (retry) {
          return {
            id: retry.id,
            code: retry.code,
            unit: retry.unit,
            created: false,
            updated: false,
          };
        }
      }
      throw err;
    }

    return created
      ? { id: created.id, code: created.code, unit: created.unit, created: true, updated: false }
      : null;
  }

  if (input.source === 'sku_import') {
    return {
      id: existing.id,
      code: existing.code,
      unit: existing.unit,
      created: false,
      updated: false,
    };
  }

  if (input.source === 'daily_sales') {
    return {
      id: existing.id,
      code: existing.code,
      unit: existing.unit,
      created: false,
      updated: false,
    };
  }

  if (input.source === 'inventory') {
    const master = buildInventoryMasterInput(input, code);
    const cols = inventoryMasterToSkuColumns(master);
    const nextUnitCost = input.unitCost || existing.unitCost || undefined;
    const nextEncodingMeta = buildNextInventoryEncodingMeta(
      master,
      code,
      existing.encodingMeta,
      input.turnoverSnapshot ?? readTurnoverSnapshot(existing.encodingMeta),
    );
    const nextState = {
      name: cols.name || displayName,
      category: cols.category ?? existing.category,
      lifecycle: cols.lifecycle ?? existing.lifecycle,
      salesCountry: cols.salesCountry ?? existing.salesCountry,
      productCategory: cols.productCategory ?? existing.productCategory,
      ownerName: cols.ownerName ?? existing.ownerName,
      developerName: cols.developerName ?? existing.developerName,
      merchantCode: cols.merchantCode ?? existing.merchantCode,
      merchantName: cols.merchantName ?? existing.merchantName,
      leadTimeDays: cols.leadTimeDays ?? existing.leadTimeDays,
      unitCost: nextUnitCost ?? null,
      spuId: existing.spuId ?? spuId ?? null,
      encodingMeta: nextEncodingMeta,
    };

    if (
      inventoryImportMasterUnchanged(
        {
          name: existing.name,
          category: existing.category,
          lifecycle: existing.lifecycle,
          salesCountry: existing.salesCountry,
          productCategory: existing.productCategory,
          ownerName: existing.ownerName,
          developerName: existing.developerName,
          merchantCode: existing.merchantCode,
          merchantName: existing.merchantName,
          leadTimeDays: existing.leadTimeDays,
          unitCost: existing.unitCost,
          spuId: existing.spuId,
          encodingMeta: existing.encodingMeta,
        },
        nextState,
      )
    ) {
      return {
        id: existing.id,
        code: existing.code,
        unit: existing.unit,
        created: false,
        updated: false,
      };
    }

    const patch: Record<string, unknown> = {
      name: nextState.name,
      category: nextState.category,
      lifecycle: nextState.lifecycle,
      salesCountry: nextState.salesCountry,
      productCategory: nextState.productCategory,
      ownerName: nextState.ownerName,
      developerName: nextState.developerName,
      merchantCode: nextState.merchantCode,
      merchantName: nextState.merchantName,
      leadTimeDays: nextState.leadTimeDays,
      unitCost: nextUnitCost,
      encodingMeta: nextEncodingMeta,
      updatedAt: new Date(),
    };
    if (!existing.spuId && spuId) patch.spuId = spuId;

    await db.update(skus).set(patch).where(eq(skus.id, existing.id));

    return {
      id: existing.id,
      code: existing.code,
      unit: existing.unit,
      created: false,
      updated: true,
    };
  }

  const patch: Record<string, unknown> = {};
  if (input.name && (existing.name === existing.code || existing.name.trim() === '')) {
    patch.name = input.name.trim();
  }
  if (input.category && !existing.category) patch.category = input.category;
  if (input.unitCost && !existing.unitCost) patch.unitCost = input.unitCost;
  if (!existing.spuId && spuId) patch.spuId = spuId;

  if (!Object.keys(patch).length) {
    return {
      id: existing.id,
      code: existing.code,
      unit: existing.unit,
      created: false,
      updated: false,
    };
  }

  patch.updatedAt = new Date();
  await db.update(skus).set(patch).where(eq(skus.id, existing.id));

  return {
    id: existing.id,
    code: existing.code,
    unit: existing.unit,
    created: false,
    updated: true,
  };
}

export async function ensureSkusFromDailySales(rows: DailySalesRow[]): Promise<{
  skuIdByCode: Map<string, string>;
  createdSkuCount: number;
  enrichedSkuCount: number;
  skippedExistingCount: number;
}> {
  const stubs = collectDailySalesSkuStubs(rows);
  const skuIdByCode = new Map<string, string>();
  let createdSkuCount = 0;
  let enrichedSkuCount = 0;
  let skippedExistingCount = 0;

  for (const [rawCode, meta] of stubs) {
    const { parse } = await ensureSpuFromSkuEncoding(rawCode, undefined, {
      name: meta.name,
      category: meta.category,
    });
    const normalizedCode = resolveDailySalesSkuCode(rawCode, parse);
    const cachedId = skuIdByCode.get(normalizedCode) ?? skuIdByCode.get(rawCode);
    if (cachedId) {
      skuIdByCode.set(rawCode, cachedId);
      skuIdByCode.set(normalizedCode, cachedId);
      skippedExistingCount++;
      continue;
    }

    const [existing] = await db.select({ id: skus.id }).from(skus).where(eq(skus.code, normalizedCode)).limit(1);
    if (existing) {
      skuIdByCode.set(rawCode, existing.id);
      skuIdByCode.set(normalizedCode, existing.id);
      skippedExistingCount++;
      continue;
    }

    const result = await ensureSkuFromImport({
      rawCode,
      name: meta.name,
      category: meta.category,
      source: 'daily_sales',
    });
    if (!result) continue;

    skuIdByCode.set(rawCode, result.id);
    skuIdByCode.set(normalizedCode, result.id);
    skuIdByCode.set(result.code, result.id);
    if (result.created) createdSkuCount++;
    else if (result.updated) enrichedSkuCount++;
  }

  return { skuIdByCode, createdSkuCount, enrichedSkuCount, skippedExistingCount };
}

export function markSkuMasterDataManual(encodingMeta: unknown): Record<string, unknown> {
  const base =
    encodingMeta && typeof encodingMeta === 'object'
      ? { ...(encodingMeta as Record<string, unknown>) }
      : {};
  return { ...base, masterDataSource: 'manual' };
}
