import { eq, desc, and, sql } from 'drizzle-orm';
import { db, inventoryRecords, warehouses } from '@scm/db';
import { IN_PRODUCTION_WAREHOUSE } from './inventory-constants.js';
import {
  effectiveQtyWithProductionFallback,
  resolveInventoryPosition,
  type InventoryPositionBreakdown,
} from './inventory-position.js';

/** 原始 inventory_records 最新一行（不分摊、不算有效供给；有效供给请用 resolveInventoryPosition） */
export type InventorySnapshot = {
  warehouseCode: string;
  qtyAvailable: number;
  qtyInTransit: number;
  qtyInProduction: number;
  qtyReserved: number;
};

/** SKU 级在产池（未分仓，发出后才计入目的仓在途） */
export async function getLatestInProductionQty(skuId: string): Promise<number> {
  const [record] = await db
    .select({ qtyInProduction: inventoryRecords.qtyInProduction })
    .from(inventoryRecords)
    .where(
      and(eq(inventoryRecords.skuId, skuId), eq(inventoryRecords.warehouse, IN_PRODUCTION_WAREHOUSE)),
    )
    .orderBy(desc(inventoryRecords.recordedDate), desc(inventoryRecords.createdAt))
    .limit(1);

  return record?.qtyInProduction ?? 0;
}

export async function getLatestInventorySnapshot(
  skuId: string,
  warehouseCode: string,
): Promise<InventorySnapshot> {
  if (warehouseCode === IN_PRODUCTION_WAREHOUSE) {
    const qtyInProduction = await getLatestInProductionQty(skuId);
    return {
      warehouseCode,
      qtyAvailable: 0,
      qtyInTransit: 0,
      qtyInProduction,
      qtyReserved: 0,
    };
  }

  const [record] = await db
    .select({
      qtyAvailable: inventoryRecords.qtyAvailable,
      qtyInTransit: inventoryRecords.qtyInTransit,
      qtyReserved: sql<number>`COALESCE(${inventoryRecords.qtyReserved}, 0)`,
    })
    .from(inventoryRecords)
    .where(and(eq(inventoryRecords.skuId, skuId), eq(inventoryRecords.warehouse, warehouseCode)))
    .orderBy(desc(inventoryRecords.recordedDate), desc(inventoryRecords.createdAt))
    .limit(1);

  return {
    warehouseCode,
    qtyAvailable: record?.qtyAvailable ?? 0,
    qtyInTransit: record?.qtyInTransit ?? 0,
    qtyInProduction: 0,
    qtyReserved: Number(record?.qtyReserved ?? 0),
  };
}

export async function getRegionPoolSnapshot(
  skuId: string,
  regionGroup: string,
): Promise<{
  effectiveQty: number;
  warehouseCodes: string[];
  byWarehouse: Array<InventoryPositionBreakdown & { warehouseCode: string }>;
}> {
  const whRows = await db
    .select({ code: warehouses.code })
    .from(warehouses)
    .where(and(eq(warehouses.regionGroup, regionGroup), eq(warehouses.isActive, true)));

  const warehouseCodes = whRows.map((w) => w.code);
  const byWarehouse: Array<InventoryPositionBreakdown & { warehouseCode: string }> = [];

  for (const code of warehouseCodes) {
    const position = await resolveInventoryPosition({ skuId, warehouseCode: code });
    byWarehouse.push({ warehouseCode: code, ...position });
  }

  const effectiveQty = effectiveQtyWithProductionFallback(
    byWarehouse,
    await getLatestInProductionQty(skuId),
  );

  return { effectiveQty, warehouseCodes, byWarehouse };
}

export async function sumEffectiveQtyForWarehouses(skuId: string, codes: string[]): Promise<number> {
  if (!codes.length) return 0;
  const positions: InventoryPositionBreakdown[] = [];
  for (const code of codes) {
    positions.push(await resolveInventoryPosition({ skuId, warehouseCode: code }));
  }
  return effectiveQtyWithProductionFallback(positions, await getLatestInProductionQty(skuId));
}

/** 汇总 SKU 在所有启用仓的最新有效供给（含 SKU 级在产池） */
export async function getSkuTotalEffectiveQty(skuId: string): Promise<number> {
  const whRows = await db
    .select({ code: warehouses.code })
    .from(warehouses)
    .where(eq(warehouses.isActive, true));

  return sumEffectiveQtyForWarehouses(
    skuId,
    whRows.map((w) => w.code),
  );
}
