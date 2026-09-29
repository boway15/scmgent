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

  it('filters by productScope goods vs accessory', () => {
    const items = [
      {
        skuId: '1',
        skuCode: 'DJ478585_2P02',
        payload: { SKU: 'DJ478585_2P02', SKU名称: '配件', 品类: '家具' },
      },
      {
        skuId: '2',
        skuCode: 'DJ502313_34',
        payload: { SKU: 'DJ502313_34', SKU名称: '椅子', 品类: '家具' },
      },
    ];
    assert.equal(filterInventoryQueryItems(items, { productScope: 'goods' }).length, 1);
    assert.equal(filterInventoryQueryItems(items, { productScope: 'goods' })[0]?.skuCode, 'DJ502313_34');
    assert.equal(filterInventoryQueryItems(items, { productScope: 'accessory' }).length, 1);
    assert.equal(filterInventoryQueryItems(items, { productScope: 'accessory' })[0]?.skuCode, 'DJ478585_2P02');
    assert.equal(filterInventoryQueryItems(items, {}).length, 1);
  });
});
