import { eq, desc, and } from 'drizzle-orm';
import { db, inventoryRecords, warehouses } from '../_db';
import { IN_PRODUCTION_WAREHOUSE } from './inventory-constants';

export type InventorySnapshot = {
  warehouseCode: string;
  qtyAvailable: number;
  qtyInTransit: number;
  qtyInProduction: number;
  /** 本仓可售 + 在途（不含在产） */
  localEffectiveQty: number;
  /** 兼容旧字段：物理仓 = localEffectiveQty；在产仓 = qtyInProduction */
  effectiveQty: number;
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
      localEffectiveQty: 0,
      effectiveQty: qtyInProduction,
    };
  }

  const [record] = await db
    .select({
      qtyAvailable: inventoryRecords.qtyAvailable,
      qtyInTransit: inventoryRecords.qtyInTransit,
    })
    .from(inventoryRecords)
    .where(and(eq(inventoryRecords.skuId, skuId), eq(inventoryRecords.warehouse, warehouseCode)))
    .orderBy(desc(inventoryRecords.recordedDate), desc(inventoryRecords.createdAt))
    .limit(1);

  const qtyAvailable = record?.qtyAvailable ?? 0;
  const qtyInTransit = record?.qtyInTransit ?? 0;
  const localEffectiveQty = qtyAvailable + qtyInTransit;

  return {
    warehouseCode,
    qtyAvailable,
    qtyInTransit,
    qtyInProduction: 0,
    localEffectiveQty,
    effectiveQty: localEffectiveQty,
  };
}

export async function getRegionPoolSnapshot(
  skuId: string,
  regionGroup: string,
): Promise<{ effectiveQty: number; warehouseCodes: string[]; byWarehouse: InventorySnapshot[] }> {
  const whRows = await db
    .select({ code: warehouses.code })
    .from(warehouses)
    .where(and(eq(warehouses.regionGroup, regionGroup), eq(warehouses.isActive, true)));

  const warehouseCodes = whRows.map((w) => w.code);
  const byWarehouse: InventorySnapshot[] = [];
  let effectiveQty = 0;

  for (const code of warehouseCodes) {
    const snap = await getLatestInventorySnapshot(skuId, code);
    byWarehouse.push(snap);
    effectiveQty += snap.localEffectiveQty;
  }

  effectiveQty += await getLatestInProductionQty(skuId);

  return { effectiveQty, warehouseCodes, byWarehouse };
}

export async function sumEffectiveQtyForWarehouses(skuId: string, codes: string[]): Promise<number> {
  if (!codes.length) return 0;
  let total = 0;
  for (const code of codes) {
    const snap = await getLatestInventorySnapshot(skuId, code);
    total += snap.localEffectiveQty;
  }
  total += await getLatestInProductionQty(skuId);
  return total;
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
