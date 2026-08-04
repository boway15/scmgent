import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertSnapshotPublishable,
  dedupeSnapshotItemsBySku,
  getShanghaiBusinessDate,
  projectInventoryTrend,
} from './inventory-daily-snapshot.js';

describe('inventory-daily-snapshot', () => {
  it('uses Asia/Shanghai calendar date at the UTC boundary', () => {
    assert.equal(getShanghaiBusinessDate(new Date('2026-07-23T15:59:59.000Z')), '2026-07-23');
    assert.equal(getShanghaiBusinessDate(new Date('2026-07-23T16:00:00.000Z')), '2026-07-24');
  });

  it('keeps the last item when a SKU appears more than once', () => {
    const result = dedupeSnapshotItemsBySku([
      { skuId: 'sku-1', code: 'A', turnoverExtras: { 海外仓在库: '10' } },
      { skuId: 'sku-2', code: 'B', turnoverExtras: { 海外仓在库: '20' } },
      { skuId: 'sku-1', code: 'A', turnoverExtras: { 海外仓在库: '30' } },
    ]);

    assert.equal(result.length, 2);
    assert.equal(
      result.find((item) => item.skuId === 'sku-1')?.turnoverExtras.海外仓在库,
      '30',
    );
  });

  it('rejects empty or partially failed imports', () => {
    assert.throws(
      () => assertSnapshotPublishable({ imported: 0, errors: [], itemCount: 0 }),
      /没有可归档/,
    );
    assert.throws(
      () => assertSnapshotPublishable({ imported: 10, errors: ['row failed'], itemCount: 10 }),
      /存在 1 条错误/,
    );
    assert.doesNotThrow(() =>
      assertSnapshotPublishable({ imported: 10, errors: [], itemCount: 10 }),
    );
  });

  it('projects requested inventory trend fields by snapshot date', () => {
    const result = projectInventoryTrend(
      [
        {
          snapshotDate: '2026-07-23',
          payload: {
            turnoverExtras: { 海外仓在库: '12', 预计海外周转天数: '30' },
          },
        },
        {
          snapshotDate: '2026-07-24',
          payload: {
            turnoverExtras: { 海外仓在库: '18', 预计海外周转天数: '24' },
          },
        },
      ],
      ['海外仓在库', '预计海外周转天数'],
    );

    assert.deepEqual(result, [
      {
        snapshotDate: '2026-07-23',
        values: { 海外仓在库: '12', 预计海外周转天数: '30' },
      },
      {
        snapshotDate: '2026-07-24',
        values: { 海外仓在库: '18', 预计海外周转天数: '24' },
      },
    ]);
  });
});
