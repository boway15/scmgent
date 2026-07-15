/**
 * 清空导入产生的销量、库存快照与 SKU 主数据（保留 manual / sku_import）。
 * Usage: pnpm exec tsx scripts/reset-import-sku-sales.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { sql, eq, inArray, or, notInArray } from 'drizzle-orm';
import {
  db,
  skus,
  salesHistory,
  salesHistoryMonthly,
  inventoryRecords,
  importBatches,
  safetyStockConfig,
  bom,
  skuSuppliers,
  reorderSuggestions,
  stockAlerts,
  inventoryHealthSnapshots,
  inventoryExceptions,
  purchaseDrafts,
  pmcPlanItems,
  materialRequirements,
  pmcReceipts,
  salesForecastMonthly,
  forecastAccuracyMonthly,
  salesForecastReviewItems,
} from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

async function loadProtectedSkuIds(): Promise<string[]> {
  const rows = await db
    .select({ id: skus.id })
    .from(skus)
    .where(
      or(
        sql`${skus.encodingMeta}->>'masterDataSource' = 'manual'`,
        sql`${skus.encodingMeta}->>'masterDataSource' = 'sku_import'`,
      ),
    );
  return rows.map((r) => r.id);
}

async function loadDeletableSkuIds(protectedIds: string[]): Promise<string[]> {
  if (!protectedIds.length) {
    const rows = await db.select({ id: skus.id }).from(skus);
    return rows.map((r) => r.id);
  }
  const rows = await db
    .select({ id: skus.id })
    .from(skus)
    .where(notInArray(skus.id, protectedIds));
  return rows.map((r) => r.id);
}

async function main() {
  console.log('=== 清空导入销量与 SKU 主数据 ===\n');

  const before = {
    skus: await db.select({ count: sql<number>`count(*)::int` }).from(skus),
    sales: await db.select({ count: sql<number>`count(*)::int` }).from(salesHistory),
    salesMonthly: await db.select({ count: sql<number>`count(*)::int` }).from(salesHistoryMonthly),
    inventory: await db.select({ count: sql<number>`count(*)::int` }).from(inventoryRecords),
  };
  console.log('清空前:', {
    skus: before.skus[0]?.count ?? 0,
    salesHistory: before.sales[0]?.count ?? 0,
    salesHistoryMonthly: before.salesMonthly[0]?.count ?? 0,
    inventoryRecords: before.inventory[0]?.count ?? 0,
  });

  const protectedIds = await loadProtectedSkuIds();
  const deletableSkuIds = await loadDeletableSkuIds(protectedIds);
  console.log(`保留 SKU（manual/sku_import）: ${protectedIds.length}`);
  console.log(`待清理 SKU: ${deletableSkuIds.length}`);

  const deletedSales = await db
    .delete(salesHistory)
    .where(eq(salesHistory.source, 'import'))
    .returning({ id: salesHistory.id });
  console.log(`已删 sales_history (import): ${deletedSales.length}`);

  const deletedInventoryAll = await db
    .delete(inventoryRecords)
    .where(eq(inventoryRecords.source, 'import'))
    .returning({ id: inventoryRecords.id });
  console.log(`已删 inventory_records (import): ${deletedInventoryAll.length}`);

  if (deletableSkuIds.length) {
    const deletedMonthly = await db
      .delete(salesHistoryMonthly)
      .where(inArray(salesHistoryMonthly.skuId, deletableSkuIds))
      .returning({ id: salesHistoryMonthly.id });
    console.log(`已删 sales_history_monthly: ${deletedMonthly.length}`);

    await db.delete(reorderSuggestions).where(inArray(reorderSuggestions.skuId, deletableSkuIds));
    await db.delete(stockAlerts).where(inArray(stockAlerts.skuId, deletableSkuIds));
    await db
      .delete(inventoryHealthSnapshots)
      .where(inArray(inventoryHealthSnapshots.skuId, deletableSkuIds));
    await db
      .delete(inventoryExceptions)
      .where(inArray(inventoryExceptions.skuId, deletableSkuIds));
    await db.delete(purchaseDrafts).where(inArray(purchaseDrafts.skuId, deletableSkuIds));
    await db.delete(pmcPlanItems).where(inArray(pmcPlanItems.skuId, deletableSkuIds));
    await db
      .delete(materialRequirements)
      .where(inArray(materialRequirements.materialSkuId, deletableSkuIds));
    await db.delete(pmcReceipts).where(inArray(pmcReceipts.skuId, deletableSkuIds));
    await db
      .delete(salesForecastMonthly)
      .where(inArray(salesForecastMonthly.skuId, deletableSkuIds));
    await db
      .delete(forecastAccuracyMonthly)
      .where(inArray(forecastAccuracyMonthly.skuId, deletableSkuIds));
    await db
      .delete(salesForecastReviewItems)
      .where(inArray(salesForecastReviewItems.skuId, deletableSkuIds));
    await db
      .delete(inventoryRecords)
      .where(inArray(inventoryRecords.skuId, deletableSkuIds));
    await db.delete(safetyStockConfig).where(inArray(safetyStockConfig.skuId, deletableSkuIds));
    await db
      .delete(bom)
      .where(
        or(
          inArray(bom.finishedSkuId, deletableSkuIds),
          inArray(bom.materialSkuId, deletableSkuIds),
        ),
      );
    await db.delete(skuSuppliers).where(inArray(skuSuppliers.skuId, deletableSkuIds));

    const deletedSkus = await db
      .delete(skus)
      .where(inArray(skus.id, deletableSkuIds))
      .returning({ id: skus.id });
    console.log(`已删 skus: ${deletedSkus.length}`);
  }

  const deletedBatches = await db
    .delete(importBatches)
    .where(or(eq(importBatches.type, 'sales'), eq(importBatches.type, 'inventory')))
    .returning({ id: importBatches.id });
  console.log(`已删 import_batches (sales/inventory): ${deletedBatches.length}`);

  const after = {
    skus: await db.select({ count: sql<number>`count(*)::int` }).from(skus),
    sales: await db.select({ count: sql<number>`count(*)::int` }).from(salesHistory),
    inventory: await db.select({ count: sql<number>`count(*)::int` }).from(inventoryRecords),
  };
  console.log('\n清空后:', {
    skus: after.skus[0]?.count ?? 0,
    salesHistory: after.sales[0]?.count ?? 0,
    inventoryRecords: after.inventory[0]?.count ?? 0,
  });
  console.log('\n完成。请运行 reimport-inventory-then-sales.ts 或先导入库存再导入销量。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
