import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterProcurementOpsItems } from './procurement-ops-service.js';

describe('procurement-ops-service', () => {
  it('filters by keyword and category', () => {
    const items = [
      { skuId: null, skuCode: 'SKU1', payload: { SKU: 'SKU1', SKU名称: 'Chair', 品类: '家具' } },
      { skuId: null, skuCode: 'SKU2', payload: { SKU: 'SKU2', SKU名称: 'Table', 品类: '户外' } },
    ];
    const filtered = filterProcurementOpsItems(items, { q: 'chair', category: '家具' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.skuCode, 'SKU1');
  });

  it('excludes short numeric accessory SKUs in goods scope', () => {
    const items = [
      { skuId: null, skuCode: '100100902', payload: { SKU: '100100902' } },
      { skuId: null, skuCode: '1001009P01', payload: { SKU: '1001009P01' } },
    ];
    const goods = filterProcurementOpsItems(items, { productScope: 'goods' });
    assert.deepEqual(
      goods.map((r) => r.skuCode),
      ['100100902'],
    );
    const accessories = filterProcurementOpsItems(items, { productScope: 'accessory' });
    assert.deepEqual(
      accessories.map((r) => r.skuCode),
      ['1001009P01'],
    );
  });
});
