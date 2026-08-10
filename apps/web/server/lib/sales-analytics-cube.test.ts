import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accumulateCubeRows } from './sales-analytics-cube.js';

describe('accumulateCubeRows', () => {
  it('rolls daily rows into month and week vectors by s/b/c/p', () => {
    const stationMap = new Map([['US-WEST', 'US'], ['DE-1', 'DE']]);
    const names = new Map([['AMAZON', '亚马逊'], ['UNKNOWN', '未知']]);
    const payload = accumulateCubeRows(
      [
        {
          saleDate: '2026-01-05',
          qtySold: 10,
          warehouseCode: 'US-WEST',
          channel: '亚马逊',
          category: '部\\项目1组-US\\书桌',
        },
        {
          saleDate: '2026-01-06',
          qtySold: 5,
          warehouseCode: 'US-WEST',
          channel: '亚马逊',
          category: '部\\项目1组-US\\书桌',
        },
        {
          saleDate: '2026-02-01',
          qtySold: 3,
          warehouseCode: 'DE-1',
          channel: 'wayfair',
          category: '部\\项目1组-US\\书桌',
        },
      ],
      stationMap,
      names,
    );
    assert.deepEqual(payload.months, ['2026-01', '2026-02']);
    assert.ok(payload.weeks.length >= 2);
    const us = payload.data.find((e) => e.s === 'US' && e.b === '项目1组' && e.p === '亚马逊');
    assert.ok(us);
    assert.equal(us.v[0], 15);
    assert.equal(us.v[1], 0);
    const eu = payload.data.find((e) => e.s === 'EU');
    assert.ok(eu);
    assert.equal(eu.v[1], 3);
  });
});
