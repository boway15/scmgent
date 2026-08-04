/**
 * 本地 DB 集成验证：重复 SKU 写法 + 重复导入不应触发 23505。
 * 用法：pnpm --filter @scm/web exec tsx server/lib/sales-history-import.integration.test.ts
 */
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { db, salesHistory, skus } from '@scm/db';
import { persistDailySalesRowsAsHistory } from './sales-history-import.js';
import type { DailySalesRow } from './sales-report-parser.js';

const TEST_CODES = ['DJ999888_01', 'dj999888_01'] as const;
const TEST_NORMALIZED = 'DJ999888_01';

function dailyRow(skuCode: string, qtySold: number): DailySalesRow {
  return {
    skuCode,
    skuName: 'Import Verify SKU',
    station: 'US',
    platformRaw: 'Amazon',
    firstOrderAt: '',
    category: 'Test',
    saleDate: '2026-01-15',
    qtySold,
  };
}

async function cleanup(): Promise<void> {
  const existing = await db
    .select({ id: skus.id })
    .from(skus)
    .where(eq(skus.code, TEST_NORMALIZED));
  const skuIds = existing.map((row) => row.id);
  if (skuIds.length) {
    await db.delete(salesHistory).where(inArray(salesHistory.skuId, skuIds));
    await db.delete(skus).where(inArray(skus.id, skuIds));
  }
}

async function main(): Promise<void> {
  await cleanup();

  const rows = [dailyRow('dj999888_01', 2), dailyRow('DJ999888_01', 3)];
  const first = await persistDailySalesRowsAsHistory(rows, undefined, {
    skipMonthlyAggregate: true,
  });

  assert.equal(first.createdSkuCount, 1, 'should create exactly one SKU for case variants');
  assert.equal(first.insertedSalesRows, 1, 'should merge duplicate SKU/date/channel into one row');
  assert.equal(first.unmatchedSkuCount, 0);

  const second = await persistDailySalesRowsAsHistory(rows, undefined, {
    skipMonthlyAggregate: true,
  });

  assert.equal(second.createdSkuCount, 0, 're-import must not create duplicate SKU');
  assert.equal(second.insertedSalesRows, 0, 're-import should skip existing daily rows');
  assert.equal(second.skippedExistingSalesRows, 1);

  const skuRows = await db
    .select({ code: skus.code })
    .from(skus)
    .where(eq(skus.code, TEST_NORMALIZED));
  assert.equal(skuRows.length, 1, 'database should contain single normalized SKU');

  await cleanup();
  console.log('sales-history-import integration: PASS');
}

main().catch(async (err) => {
  console.error('sales-history-import integration: FAIL', err);
  try {
    await cleanup();
  } catch {
    // ignore cleanup errors after failure
  }
  process.exit(1);
});
