import assert from 'node:assert/strict';
import { validateImportPreview } from './batch.js';

async function testInventoryValidation() {
  const issues = await validateImportPreview(
    'inventory',
    [
      { sku_code: 'MISSING-SKU', warehouse: 'US-WEST', qty_available: '10', recorded_date: '2026-06-01' },
      { sku_code: 'SKU-001', warehouse: 'BAD-WH', qty_available: '10', recorded_date: '2026-06-01' },
      { sku_code: 'SKU-001', warehouse: 'US-WEST', qty_available: 'abc', recorded_date: '2026-06-01' },
    ],
    new Set(['US-WEST', 'IN-PRODUCTION']),
    new Set(['SKU-001']),
  );

  assert.ok(issues.some((i) => i.message.includes('SKU 不存在')));
  assert.ok(issues.some((i) => i.message.includes('仓库编码无效')));
  assert.ok(issues.some((i) => i.message.includes('必须为整数')));
}

async function testSalesValidationSkipped() {
  const issues = await validateImportPreview(
    'sales',
    [{ sku_code: 'SKU-001', sale_date: 'bad-date', qty_sold: 'abc' }],
    new Set(['US-WEST']),
    new Set(['SKU-001']),
  );

  assert.equal(issues.length, 0);
}

await testInventoryValidation();
await testSalesValidationSkipped();
console.log('import-batch.test.ts: all passed');
