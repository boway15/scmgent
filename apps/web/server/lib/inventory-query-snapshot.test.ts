import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getShanghaiBusinessDate } from './inventory-daily-snapshot.js';
import {
  assertQuerySnapshotPublishable,
  dedupeQuerySnapshotItemsBySkuCode,
} from './inventory-query-snapshot.js';

describe('inventory-query-snapshot', () => {
  it('reuses Asia/Shanghai business date helper', () => {
    assert.equal(getShanghaiBusinessDate(new Date('2026-07-23T15:59:59.000Z')), '2026-07-23');
    assert.equal(getShanghaiBusinessDate(new Date('2026-07-23T16:00:00.000Z')), '2026-07-24');
  });

  it('keeps the last item when a sku_code appears more than once', () => {
    const result = dedupeQuerySnapshotItemsBySkuCode([
      { skuCode: 'A', skuId: null, payload: { SKU: 'A', 海外仓库存_合计: '1' } },
      { skuCode: 'B', skuId: 'id-b', payload: { SKU: 'B', 海外仓库存_合计: '2' } },
      { skuCode: 'A', skuId: 'id-a', payload: { SKU: 'A', 海外仓库存_合计: '9' } },
    ]);

    assert.equal(result.length, 2);
    assert.equal(result.find((item) => item.skuCode === 'A')?.payload.海外仓库存_合计, '9');
    assert.equal(result.find((item) => item.skuCode === 'A')?.skuId, 'id-a');
  });

  it('rejects empty publishes but allows warnings', () => {
    assert.throws(
      () => assertQuerySnapshotPublishable({ imported: 0, itemCount: 0 }),
      /没有可归档/,
    );
    assert.doesNotThrow(() =>
      assertQuerySnapshotPublishable({ imported: 10, itemCount: 10, warningCount: 3 }),
    );
  });
});
