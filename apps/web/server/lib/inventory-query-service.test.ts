import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterInventoryQueryItems } from './inventory-query-service.js';

describe('inventory-query-service', () => {
  it('filters by q / category / salesCountry / lifecycle', () => {
    const items = [
      {
        skuId: '1',
        skuCode: 'A-1',
        payload: { SKU: 'A-1', SKU名称: '椅子', 品类: '家具', 销售国家: 'US', 生命周期: '稳定期' },
      },
      {
        skuId: null,
        skuCode: 'B-2',
        payload: { SKU: 'B-2', SKU名称: '灯', 品类: '家电', 销售国家: 'DE', 生命周期: '导入期' },
      },
    ];

    assert.equal(filterInventoryQueryItems(items, { q: '椅子' }).length, 1);
    assert.equal(filterInventoryQueryItems(items, { category: '家电' })[0]?.skuCode, 'B-2');
    assert.equal(filterInventoryQueryItems(items, { salesCountry: 'us' }).length, 1);
    assert.equal(filterInventoryQueryItems(items, { lifecycle: '导入' }).length, 1);
  });
});
