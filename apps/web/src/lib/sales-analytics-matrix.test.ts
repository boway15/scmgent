import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMatrixRows } from './sales-analytics-matrix.js';
import type { SalesAnalyticsEntity } from './sales-analytics-types.js';

function entity(partial: Partial<SalesAnalyticsEntity> & { v: number[] }): SalesAnalyticsEntity {
  const n = partial.v.length;
  return {
    s: 'US',
    b: '项目1组',
    c: '床',
    p: '亚马逊',
    vw: Array.from({ length: n }, () => 0),
    ...partial,
  };
}

describe('buildMatrixRows', () => {
  const periods = ['2025-01', '2025-02', '2025-03', '2025-04'];

  it('groups by breakdown dims and sorts by window cumulative desc', () => {
    const rows = buildMatrixRows({
      entities: [
        entity({ s: 'US', v: [10, 20, 30, 40] }),
        entity({ s: 'US', p: '沃尔玛', v: [1, 1, 1, 1] }),
        entity({ s: 'UK', v: [100, 0, 0, 0] }),
      ],
      mode: 's',
      periods,
      gran: 'month',
      rangeStart: 1,
      rangeEnd: 3,
    });
    assert.deepEqual(
      rows.map((r) => r.key),
      ['US', 'UK'],
    );
    const us = rows[0]!;
    assert.deepEqual(us.hist, [21, 31, 41]);
    assert.equal(us.cum, 93);
    assert.deepEqual(us.series, [11, 21, 31, 41]);
    assert.deepEqual(us.peak, { period: '2025-04', qty: 41 });
    assert.deepEqual(us.trough, { period: '2025-02', qty: 21 });
    assert.equal(rows[1]!.cum, 0);
  });

  it('builds composite keys for two-dim modes', () => {
    const rows = buildMatrixRows({
      entities: [entity({ v: [5, 5, 5, 5] })],
      mode: 'sb',
      periods,
      gran: 'month',
      rangeStart: 0,
      rangeEnd: 3,
    });
    assert.equal(rows[0]!.key, 'US / 项目1组');
  });
});
