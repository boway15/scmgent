/**
 * 从 docs/samples/kucun 周转表全量重导库存（分仓写入 + turnoverSnapshot 对齐 A:GR）。
 * Usage: pnpm exec tsx scripts/reimport-inventory-turnover.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, skus, inventoryRecords, users } from '@scm/db';
import { parseXlsxBuffer, importInventoryRows } from '../server/lib/import/handlers.js';
import { readTurnoverSnapshot } from '../server/lib/inventory-turnover-snapshot.js';
import { buildInventoryOverviewRows } from '../server/lib/inventory-overview-service.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const INVENTORY_XLSX = resolve(
  ROOT,
  'docs/samples/kucun/库存表-SKU库存周转情况查询-明细6a4227ef43084ca969e19dfe.xlsx',
);
config({ path: resolve(ROOT, '.env') });

async function main() {
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) throw new Error('数据库无用户，请先 seed');

  console.log('=== 0. 清理历史导入库存快照（保留 manual 录入）===');
  const deleted = await db
    .delete(inventoryRecords)
    .where(eq(inventoryRecords.source, 'import'))
    .returning({ id: inventoryRecords.id });
  console.log(`已删除 import 库存记录: ${deleted.length}`);

  console.log('\n=== 1. 导入周转表 ===');
  console.log(INVENTORY_XLSX);
  const invBuf = readFileSync(INVENTORY_XLSX);
  const invRows = await parseXlsxBuffer(
    invBuf.buffer.slice(invBuf.byteOffset, invBuf.byteOffset + invBuf.byteLength),
  );
  console.log(`库存行数: ${invRows.length}`);

  const batchId = randomUUID();
  const invResult = await importInventoryRows(invRows, user.id, batchId);
  console.log('导入结果:', invResult);
  if (invResult.errors.length) {
    console.log('前 5 条错误:', invResult.errors.slice(0, 5));
  }

  const [withSnapshot] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(skus)
    .where(sql`encoding_meta::jsonb ? 'turnoverSnapshot'`);
  console.log(`含 turnoverSnapshot 的 SKU: ${withSnapshot?.count ?? 0}`);

  const warehouseDist = await db.execute(sql`
    SELECT warehouse, count(*)::int AS cnt
    FROM inventory_records
    WHERE source = 'import' AND warehouse <> 'IN-PRODUCTION'
    GROUP BY warehouse
    ORDER BY cnt DESC
  `);
  console.log('\n分仓库存记录分布:');
  for (const row of Array.from(warehouseDist as unknown as Array<{ warehouse: string; cnt: number }>)) {
    console.log(`  ${row.warehouse}: ${row.cnt}`);
  }

  const [skuSample] = await db
    .select({ id: skus.id, code: skus.code, encodingMeta: skus.encodingMeta })
    .from(skus)
    .where(eq(skus.code, '100100201'))
    .limit(1);

  if (skuSample) {
    const snap = readTurnoverSnapshot(skuSample.encodingMeta);
    console.log('\nSKU 100100201 快照样例键:', Object.keys(snap).slice(0, 8).join(', '), '…');
    console.log('  海外仓库存_美东:', snap['海外仓库存_美东'] ?? '-');
    console.log('  调拨在途_合计:', snap['调拨在途_合计'] ?? '-');
  }

  const overview = await buildInventoryOverviewRows({ page: 1, pageSize: 1, offset: 0, q: '100100201' });
  const item = overview.items[0];
  if (item) {
    console.log('\n总览对齐检查 100100201:');
    console.log('  turnoverExtras 海外仓库存_美东:', item.turnoverExtras['海外仓库存_美东'] ?? '-');
    console.log('  warehouseStocks:', item.warehouseStocks);
  }

  const [invTotal] = await db.select({ count: sql<number>`count(*)::int` }).from(inventoryRecords);
  console.log('\n最终 inventory_records:', invTotal?.count ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
