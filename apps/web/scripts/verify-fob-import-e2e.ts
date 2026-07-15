/**
 * End-to-end import verification using docs/samples/import-fob/ fixtures.
 * Usage: pnpm exec tsx scripts/verify-fob-import-e2e.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { sql, eq, inArray } from 'drizzle-orm';
import { db, skus, salesHistory, inventoryRecords, users } from '@scm/db';
import {
  parseImportContent,
  parseImportBuffer,
  parseXlsxBuffer,
  importInventoryRows,
} from '../server/lib/import/handlers.js';
import { parseDailySalesRows, parseMonthlySalesWorkbookRows } from '../server/lib/sales-report-parser.js';
import { persistDailySalesRowsAsHistory } from '../server/lib/sales-history-import.js';
import { isFobInventoryFormat, expandFobInventoryRows } from '../server/lib/fob-inventory-import.js';
import { computeSeasonalityFactors } from '../server/lib/forecast-collaboration.js';
import { randomUUID } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const SAMPLES = resolve(ROOT, 'docs/samples/import-fob');
const DAILY_CSV = resolve(SAMPLES, '产品销售报表-每日6a3e471b146127326e0e06f6.csv');
const INVENTORY_CSV = resolve(SAMPLES, 'SKU-库存6a41e4949f5476cc5bd10dda.csv');
const MONTHLY_XLSX = resolve(SAMPLES, '产品销售报表-每月2023.1-2026.5.xlsx');

type Counts = {
  skus: number;
  salesHistory: number;
  inventoryRecords: number;
};

async function loadCounts(): Promise<Counts> {
  const [skuRow] = await db.select({ count: sql<number>`count(*)::int` }).from(skus);
  const [salesRow] = await db.select({ count: sql<number>`count(*)::int` }).from(salesHistory);
  const [invRow] = await db.select({ count: sql<number>`count(*)::int` }).from(inventoryRecords);
  return {
    skus: skuRow?.count ?? 0,
    salesHistory: salesRow?.count ?? 0,
    inventoryRecords: invRow?.count ?? 0,
  };
}

function printSection(title: string) {
  console.log(`\n${'='.repeat(60)}\n${title}\n${'='.repeat(60)}`);
}

const DAILY_ROW_LIMIT = Number(process.env.E2E_DAILY_ROW_LIMIT ?? 100);

async function main() {
  printSection('0. 数据库连接');
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) throw new Error('数据库无用户，请先 seed');
  const before = await loadCounts();
  console.log('导入前计数:', before);

  printSection('1. 日销量宽表解析 + 导入');
  const dailyText = readFileSync(DAILY_CSV, 'utf8');
  const dailyObjectsAll = parseImportContent(dailyText);
  const dailyObjects = dailyObjectsAll.slice(0, DAILY_ROW_LIMIT);
  console.log(`日销量文件总行数: ${dailyObjectsAll.length}，本次导入前 ${dailyObjects.length} 行（可用 E2E_DAILY_ROW_LIMIT 调整）`);
  const daily = parseDailySalesRows(dailyObjects);
  console.log('原始行数:', daily.diagnostics.rowCount);
  console.log('SKU 数:', daily.diagnostics.skuCount);
  console.log('展开销量行数:', daily.diagnostics.expandedRowCount);
  console.log('日期范围:', daily.diagnostics.startDate, '→', daily.diagnostics.endDate);
  console.log('解析错误数:', daily.diagnostics.errors.length);
  if (daily.diagnostics.errors.length) {
    console.log('解析错误样例:', daily.diagnostics.errors.slice(0, 3));
  }

  const dailyImport = await persistDailySalesRowsAsHistory(daily.rows, randomUUID());
  console.log('销量写入:', {
    importedSalesRows: dailyImport.importedSalesRows,
    insertedSalesRows: dailyImport.insertedSalesRows,
    updatedSalesRows: dailyImport.updatedSalesRows,
    createdSkuCount: dailyImport.createdSkuCount,
    enrichedSkuCount: dailyImport.enrichedSkuCount,
    unmatchedSkuCount: dailyImport.unmatchedSkuCount,
    importErrors: dailyImport.errors.length,
  });
  if (dailyImport.errors.length) {
    console.log('销量导入错误样例:', dailyImport.errors.slice(0, 5));
  }

  printSection('2. FOB 库存表解析 + 导入');
  const inventoryBuffer = readFileSync(INVENTORY_CSV);
  const inventoryObjects = parseImportBuffer(inventoryBuffer.buffer.slice(
    inventoryBuffer.byteOffset,
    inventoryBuffer.byteOffset + inventoryBuffer.byteLength,
  ));
  console.log('原始行数:', inventoryObjects.length);
  console.log('FOB 格式识别:', isFobInventoryFormat(inventoryObjects));
  const expanded = expandFobInventoryRows(inventoryObjects);
  console.log('展开库存快照数:', expanded.length);
  const sampleExpanded = expanded.find((row) => row.qtyAvailable > 0 || row.qtyInTransit > 0 || row.qtyInProduction > 0);
  console.log('非零库存样例行:', sampleExpanded ?? expanded[0]);

  const inventoryImport = await importInventoryRows(inventoryObjects, user.id, randomUUID());
  console.log('库存导入结果:', inventoryImport);
  if (inventoryImport.errors.length) {
    console.log('库存导入错误样例:', inventoryImport.errors.slice(0, 5));
  }

  printSection('3. 月度销量表解析（趋势系数，不建 SKU）');
  const monthlyBuffer = readFileSync(MONTHLY_XLSX);
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(monthlyBuffer, { type: 'buffer' });
  const monthlyWorkbook: Record<string, unknown[][]> = {};
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    monthlyWorkbook[sheetName] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
    }) as unknown[][];
  }
  console.log('工作表:', workbook.SheetNames.join(', '));
  const monthly = parseMonthlySalesWorkbookRows(monthlyWorkbook);
  const months = monthly.rows.map((row) => row.month).sort();
  const factors = computeSeasonalityFactors(monthly.rows);
  console.log('月度趋势行数:', monthly.rows.length);
  console.log('月份范围:', months[0] ?? '-', '→', months[months.length - 1] ?? '-');
  console.log('季节系数数:', factors.length);
  console.log('维度样例:', monthly.rows.slice(0, 3));

  printSection('4. 导入后抽样校验');
  const after = await loadCounts();
  console.log('导入后计数:', after);
  console.log('增量:', {
    skus: after.skus - before.skus,
    salesHistory: after.salesHistory - before.salesHistory,
    inventoryRecords: after.inventoryRecords - before.inventoryRecords,
  });

  const probeCodes = ['DJ502952_1', 'DJ502530_2'];
  const probeSkus = await db
    .select({
      code: skus.code,
      name: skus.name,
      category: skus.category,
      encodingMeta: skus.encodingMeta,
    })
    .from(skus)
    .where(inArray(skus.code, probeCodes));

  console.log('抽样 SKU 主数据:', probeSkus);

  for (const probe of probeSkus) {
    const [skuRow] = await db.select({ id: skus.id }).from(skus).where(eq(skus.code, probe.code)).limit(1);
    if (!skuRow) continue;
    const [salesSample] = await db
      .select({
        saleDate: salesHistory.saleDate,
        qtySold: salesHistory.qtySold,
        channel: salesHistory.channel,
      })
      .from(salesHistory)
      .where(eq(salesHistory.skuId, skuRow.id))
      .limit(3);
    const invSample = await db
      .select({
        warehouse: inventoryRecords.warehouse,
        qtyAvailable: inventoryRecords.qtyAvailable,
        qtyInTransit: inventoryRecords.qtyInTransit,
        qtyInProduction: inventoryRecords.qtyInProduction,
      })
      .from(inventoryRecords)
      .where(eq(inventoryRecords.skuId, skuRow.id))
      .limit(3);
    console.log(`\nSKU ${probe.code}:`);
    console.log('  销量样例:', salesSample);
    console.log('  库存样例:', invSample);
  }

  const failed =
    dailyImport.unmatchedSkuCount > 0 ||
    daily.diagnostics.errors.length > 0 ||
    inventoryImport.imported === 0 ||
    monthly.rows.length === 0 ||
    inventoryImport.errors.length > inventoryImport.imported * 0.01;

  printSection(failed ? '验证未完全通过' : '验证通过');
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
