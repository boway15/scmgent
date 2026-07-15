/**
 * 按正确顺序重导：库存（SKU 主数据 A:K）→ 销量（仅补缺 SKU）。
 * Usage: pnpm exec tsx scripts/reimport-inventory-then-sales.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, skus, salesHistory, inventoryRecords, users } from '@scm/db';
import { parseImportBuffer, parseXlsxBuffer, importInventoryRows } from '../server/lib/import/handlers.js';
import { parseDailySalesRows } from '../server/lib/sales-report-parser.js';
import { persistDailySalesRowsAsHistory } from '../server/lib/sales-history-import.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const SAMPLES = resolve(ROOT, 'docs/samples/kucun');
config({ path: resolve(ROOT, '.env') });

const INVENTORY_XLSX = resolve(SAMPLES, '库存表-SKU库存周转情况查询-明细6a4227ef43084ca969e19dfe.xlsx');
const DAILY_CSV = resolve(SAMPLES, '产品销售报表-每日6a3e471b146127326e0e06f6.csv');
const DAILY_ROW_LIMIT = Number(process.env.E2E_DAILY_ROW_LIMIT ?? 0);

async function main() {
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) throw new Error('数据库无用户，请先 seed');

  console.log('=== 1. 导入库存（SKU 主数据以 A:K 为准）===');
  const invBuf = readFileSync(INVENTORY_XLSX);
  const invRows = await parseXlsxBuffer(
    invBuf.buffer.slice(invBuf.byteOffset, invBuf.byteOffset + invBuf.byteLength),
  );
  console.log(`库存行数: ${invRows.length}`);
  const invResult = await importInventoryRows(invRows, user.id, randomUUID());
  console.log('库存导入:', invResult);

  const [skuSample] = await db
    .select({
      code: skus.code,
      name: skus.name,
      category: skus.category,
      merchantCode: skus.merchantCode,
      merchantName: skus.merchantName,
      leadTimeDays: skus.leadTimeDays,
      encodingMeta: skus.encodingMeta,
    })
    .from(skus)
    .where(eq(skus.code, '100100201'))
    .limit(1);
  console.log('SKU 样例 100100201:', skuSample);

  console.log('\n=== 2. 导入销量（仅创建库存中不存在的 SKU）===');
  try {
    const dailyText = readFileSync(DAILY_CSV, 'utf8');
    const dailyObjectsAll = parseImportBuffer(Buffer.from(dailyText, 'utf8'));
    const dailyObjects =
      DAILY_ROW_LIMIT > 0 ? dailyObjectsAll.slice(0, DAILY_ROW_LIMIT) : dailyObjectsAll;
    console.log(`日销量行数: ${dailyObjects.length}${DAILY_ROW_LIMIT > 0 ? ` (限制 ${DAILY_ROW_LIMIT})` : ''}`);
    const daily = parseDailySalesRows(dailyObjects);
    const salesResult = await persistDailySalesRowsAsHistory(daily.rows, randomUUID());
    console.log('销量导入:', {
      importedSalesRows: salesResult.importedSalesRows,
      createdSkuCount: salesResult.createdSkuCount,
      enrichedSkuCount: salesResult.enrichedSkuCount,
      skippedExistingCount: salesResult.skippedExistingCount,
      unmatchedSkuCount: salesResult.unmatchedSkuCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ENOENT')) {
      console.log(`跳过销量导入：未找到 ${DAILY_CSV}`);
    } else {
      throw err;
    }
  }

  const counts = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(skus),
    db.select({ count: sql<number>`count(*)::int` }).from(salesHistory),
    db.select({ count: sql<number>`count(*)::int` }).from(inventoryRecords),
  ]);
  console.log('\n最终计数:', {
    skus: counts[0][0]?.count ?? 0,
    salesHistory: counts[1][0]?.count ?? 0,
    inventoryRecords: counts[2][0]?.count ?? 0,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
