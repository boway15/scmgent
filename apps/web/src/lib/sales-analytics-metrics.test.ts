import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filterEntities,
  momPct,
  sumSeries,
  yoyPct,
} from './sales-analytics-metrics.js';
import type { SalesAnalyticsEntity } from './sales-analytics-types.js';

describe('sales-analytics-metrics', () => {
  it('computes mom and yoy', () => {
    const v = [100, 110, 90];
    const periods = ['2025-01', '2025-02', '2026-02'];
    assert.equal(momPct(v, 0), null);
    assert.ok(Math.abs((momPct(v, 1) ?? 0) - 10) < 1e-6);
    // yoy: index 2 (2026-02) vs 2025-02 at index 1
    assert.ok(Math.abs((yoyPct(v, periods, 2) ?? 0) - ((90 - 110) / 110) * 100) < 1e-6);
  });

  it('filters entities and sums month/week series', () => {
    const data: SalesAnalyticsEntity[] = [
      { s: 'US', b: '项目1组', c: '桌', p: '亚马逊', v: [1, 2], vw: [10, 20] },
      { s: 'EU', b: '项目1组', c: '桌', p: '亚马逊', v: [3, 4], vw: [30, 40] },
      { s: 'US', b: '项目2组', c: '椅', p: '非亚马逊', v: [5, 6], vw: [50, 60] },
    ];
    const filtered = filterEntities(data, {
      s: new Set(['US']),
      b: new Set(['项目1组', '项目2组']),
      c: new Set(['桌', '椅']),
      p: new Set(['亚马逊', '非亚马逊']),
    });
    assert.equal(filtered.length, 2);
    assert.deepEqual(sumSeries(filtered, 'month'), [6, 8]);
    assert.deepEqual(sumSeries(filtered, 'week'), [60, 80]);
  });
});
