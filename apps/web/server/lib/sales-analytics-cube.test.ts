import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  accumulateCubeRows,
  bucketForDailySale,
  cubeHasProjectGroupDim,
  filterCubeByProjectGroupScope,
} from './sales-analytics-cube.js';
import type { SalesAnalyticsCubePayload } from '@scm/db';

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

  it('writes project group dimension g on each entity', () => {
    const payload = accumulateCubeRows(
      [
        {
          saleDate: '2026-01-05',
          qtySold: 10,
          station: 'US',
          channel: '亚马逊',
          category: '部\\Amazon项目1组-第一曲线-US\\书桌',
        },
      ],
      new Map(),
      new Map([['AMAZON', '亚马逊']]),
    );
    assert.equal(cubeHasProjectGroupDim(payload), true);
    assert.ok(payload.data.every((row) => Object.prototype.hasOwnProperty.call(row, 'g')));
    assert.equal(payload.data[0]?.g, 'Amazon项目1组-第一曲线-US');
    assert.deepEqual(payload.meta.projectGroups, ['Amazon项目1组-第一曲线-US']);
  });
});

describe('filterCubeByProjectGroupScope', () => {
  const sample: SalesAnalyticsCubePayload = {
    meta: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      dateStart: '2026-01-01',
      dateEnd: '2026-02-01',
      weekStart: null,
      weekEnd: null,
      recordCount: 3,
      totalSales: 18,
      sites: ['US', 'EU'],
      depts: ['组A', '组B'],
      categories: ['书桌'],
      platforms: ['亚马逊'],
      projectGroups: ['组A', '组B'],
    },
    months: ['2026-01', '2026-02'],
    weeks: [],
    data: [
      { s: 'US', b: '组A', c: '书桌', p: '亚马逊', g: '组A', v: [10, 0], vw: [] },
      { s: 'EU', b: '组B', c: '书桌', p: '亚马逊', g: '组B', v: [0, 8], vw: [] },
      { s: 'US', b: '(未分组)', c: '书桌', p: '亚马逊', g: null, v: [1, 0], vw: [] },
    ],
  };

  it('passes through when scope is all', () => {
    const result = filterCubeByProjectGroupScope(sample, { mode: 'all' });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.cube, sample);
  });

  it('filters rows and recalculates meta for restricted scope', () => {
    const result = filterCubeByProjectGroupScope(sample, {
      mode: 'restricted',
      groups: ['组A'],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.cube.data.length, 1);
    assert.equal(result.cube.data[0]?.g, '组A');
    assert.equal(result.cube.meta.totalSales, 10);
    assert.deepEqual(result.cube.meta.projectGroups, ['组A']);
    assert.deepEqual(result.cube.meta.sites, ['US']);
  });

  it('rejects stale cubes without g for restricted users', () => {
    const stale: SalesAnalyticsCubePayload = {
      ...sample,
      meta: { ...sample.meta, projectGroups: undefined },
      data: sample.data.map(({ g: _g, ...rest }) => rest),
    };
    const result = filterCubeByProjectGroupScope(stale, {
      mode: 'restricted',
      groups: ['组A'],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'CUBE_SCOPE_STALE');
  });
});
