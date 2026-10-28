import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accumulateCubeRows, bucketForDailySale } from './sales-analytics-cube.js';

describe('accumulateCubeRows', () => {
  it('rolls daily rows into month and week vectors by selling site/b/c/p', () => {
    const stationMap = new Map([
      ['US-WEST', 'US'],
      ['DE-1', 'DE'],
    ]);
    const names = new Map([
      ['AMAZON', '亚马逊'],
      ['WAYFAIR', 'wayfair'],
    ]);
    const payload = accumulateCubeRows(
      [
        {
          saleDate: '2026-01-05',
          qtySold: 10,
          station: 'US',
          warehouseCode: null,
          channel: '亚马逊',
          category: '部\\项目1组-US\\书桌',
        },
        {
          saleDate: '2026-01-06',
          qtySold: 5,
          station: 'US',
          warehouseCode: null,
          channel: '亚马逊',
          category: '部\\项目1组-US\\书桌',
        },
        {
          saleDate: '2026-02-01',
          qtySold: 3,
          station: '',
          warehouseCode: null,
          channel: 'wayfair',
          category: '部\\项目1组-第一曲线-EU\\书桌',
        },
        {
          saleDate: '2026-02-02',
          qtySold: 4,
          station: 'Amazon英国',
          warehouseCode: 'US-WEST',
          channel: '亚马逊',
          category: '部\\项目1组-US\\书桌',
        },
      ],
      stationMap,
      names,
    );
    assert.deepEqual(payload.months, ['2026-01', '2026-02']);
    assert.ok(payload.weeks.length >= 2);
    const us = payload.data.find((e) => e.s === 'US' && e.b === '项目1组-US' && e.p === '亚马逊');
    assert.ok(us);
    assert.equal(us.v[0], 15);
    assert.equal(us.v[1], 0);
    const eu = payload.data.find((e) => e.s === 'EU');
    assert.ok(eu);
    assert.equal(eu.b, '项目1组-第一曲线-EU');
    assert.equal(eu.v[1], 3);
    const uk = payload.data.find((e) => e.s === 'UK');
    assert.ok(uk);
    assert.equal(uk.v[1], 4);
  });

  it('starts month history before the daily window without double-counting a partial month', () => {
    assert.equal(bucketForDailySale('2025-10-30', '2025-10-28'), 'week');
    assert.equal(bucketForDailySale('2025-11-01', '2025-10-28'), 'both');
    assert.equal(bucketForDailySale('2024-06-15', '2025-10-28'), 'week');

    const names = new Map([['AMAZON', '亚马逊']]);
    const category = 'DJ01-郑州大件\\Amazon项目3组-第一曲线-US\\客厅-咖啡桌Coffee Tables';
    const payload = accumulateCubeRows(
      [
        {
          saleDate: '2024-06-01',
          qtySold: 100,
          bucket: 'month',
          station: '',
          category,
          channel: '亚马逊',
        },
        {
          saleDate: '2025-10-28',
          qtySold: 8,
          bucket: 'week',
          station: 'US',
          category,
          channel: '亚马逊',
        },
        {
          saleDate: '2025-11-02',
          qtySold: 4,
          bucket: 'both',
          station: 'US',
          category,
          channel: '亚马逊',
        },
      ],
      new Map(),
      names,
    );

    assert.deepEqual(payload.months, ['2024-06', '2025-11']);
    assert.equal(payload.meta.totalSales, 104);
    assert.equal(payload.meta.dateStart, '2024-06-01');
    const row = payload.data.find((e) => e.b === 'Amazon项目3组-第一曲线-US');
    assert.ok(row);
    assert.equal(row.c, '客厅-咖啡桌Coffee Tables');
    assert.equal(row.v[0], 100);
    assert.equal(row.v[1], 4);
    assert.equal(
      row.vw.reduce((sum, qty) => sum + qty, 0),
      12,
    );
    assert.equal(payload.weeks.some((week) => week.startsWith('2024-')), false);
  });
});
