/**
 * 将 encoding_meta 中的库存 A:K 回填到 SKU 列字段。
 * Usage: pnpm exec tsx scripts/backfill-inventory-sku-master.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db, skus } from '@scm/db';
import {
  buildInventoryEncodingMeta,
  inventoryMasterFromEncodingMeta,
  inventoryMasterToSkuColumns,
} from '../server/lib/inventory-sku-master.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

async function main() {
  const rows = await db
    .select()
    .from(skus)
    .where(sql`${skus.encodingMeta}->>'masterDataSource' = 'inventory'`);

  console.log(`待回填 SKU: ${rows.length}`);
  let updated = 0;

  for (const row of rows) {
    const master = inventoryMasterFromEncodingMeta(row.encodingMeta, {
      code: row.code,
      name: row.name,
      category: row.category,
      lifecycle: row.lifecycle,
      salesCountry: row.salesCountry,
      productCategory: row.productCategory,
      ownerName: row.ownerName,
      developerName: row.developerName,
      merchantCode: row.merchantCode,
      merchantName: row.merchantName,
      leadTimeDays: row.leadTimeDays,
    });
    const cols = inventoryMasterToSkuColumns(master);

    await db
      .update(skus)
      .set({
        category: cols.category ?? row.category,
        lifecycle: cols.lifecycle ?? row.lifecycle,
        salesCountry: cols.salesCountry ?? row.salesCountry,
        productCategory: cols.productCategory ?? row.productCategory,
        ownerName: cols.ownerName ?? row.ownerName,
        developerName: cols.developerName ?? row.developerName,
        merchantCode: cols.merchantCode ?? row.merchantCode,
        merchantName: cols.merchantName ?? row.merchantName,
        leadTimeDays: cols.leadTimeDays ?? row.leadTimeDays,
        name: cols.name ?? row.name,
        encodingMeta: buildInventoryEncodingMeta(master, row.code, row.encodingMeta),
        updatedAt: new Date(),
      })
      .where(eq(skus.id, row.id));
    updated++;
  }

  console.log(`已回填: ${updated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
