import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHealthStatusesParam,
  filterItemsByHealthStatuses,
  attachHealthStatusToItems,
  attachHealthStatusToWarehouses,
} from './sku-health-aggregate.js';

describe('parseHealthStatusesParam', () => {
  it('parses csv and drops invalid', () => {
    assert.deepEqual(parseHealthStatusesParam('red,yellow,nope'), ['red', 'yellow']);
    assert.deepEqual(parseHealthStatusesParam(''), []);
    assert.deepEqual(parseHealthStatusesParam(undefined), []);
  });

  it('dedupes', () => {
    assert.deepEqual(parseHealthStatusesParam('red,red,green'), ['red', 'green']);
  });
});

describe('filterItemsByHealthStatuses', () => {
  const items = [
    { id: '1', healthStatus: 'red' as const },
    { id: '2', healthStatus: 'green' as const },
    { id: '3', healthStatus: null },
  ];

  it('returns all when filter empty', () => {
    assert.equal(filterItemsByHealthStatuses(items, []).length, 3);
  });

  it('keeps matching only; null never matches', () => {
    assert.deepEqual(
      filterItemsByHealthStatuses(items, ['red']).map((i) => i.id),
      ['1'],
    );
  });
});

describe('attachHealthStatusToItems', () => {
  it('attaches map values and null for missing', () => {
    const items = [{ skuId: 'a' }, { skuId: 'b' }];
    const map = new Map([['a', 'red' as const]]);
    assert.deepEqual(attachHealthStatusToItems(items, map), [
      { skuId: 'a', healthStatus: 'red' },
      { skuId: 'b', healthStatus: null },
    ]);
  });
});

describe('attachHealthStatusToWarehouses', () => {
  it('attaches per-warehouse health and null for missing', () => {
    const warehouses = [
      { warehouseCode: 'US-WEST', effectiveQty: 80 },
      { warehouseCode: 'US-EAST', effectiveQty: 20 },
    ];
    const map = new Map([['US-WEST', 'yellow' as const]]);
    assert.deepEqual(attachHealthStatusToWarehouses(warehouses, map), [
      { warehouseCode: 'US-WEST', effectiveQty: 80, healthStatus: 'yellow' },
      { warehouseCode: 'US-EAST', effectiveQty: 20, healthStatus: null },
    ]);
  });
});
