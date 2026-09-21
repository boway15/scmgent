import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifySalesLifecycle } from './forecast-baseline.js';
import { resolveRecentDemandWindows } from './forecast-demand-unconstrain.js';
import {
  filterMonthLabelsFromStart,
  formatBaselineWeightsLabel,
} from './forecast-sku-context.js';

describe('formatBaselineWeightsLabel', () => {
  it('formats lifecycle weights as percentages', () => {
    assert.equal(
      formatBaselineWeightsLabel({ w90: 0.5, w30: 0.3, wLy: 0.2, wCat: 0 }),
      '50% / 30% / 20% / 0%',
    );
  });

  it('formats new product weights', () => {
    assert.equal(
      formatBaselineWeightsLabel({ w90: 0, w30: 0.7, wLy: 0, wCat: 0.3 }),
      '0% / 70% / 0% / 30%',
    );
  });
});

describe('filterMonthLabelsFromStart', () => {
  it('slices from exact startMonth match', () => {
    assert.deepEqual(filterMonthLabelsFromStart(['2026-01', '2026-02', '2026-03'], '2026-02'), [
      '2026-02',
      '2026-03',
    ]);
  });

  it('keeps labels >= startMonth when exact match missing', () => {
    assert.deepEqual(filterMonthLabelsFromStart(['2026-03', '2026-04', '2026-05'], '2026-02'), [
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
  });

  it('returns empty when no labels meet startMonth', () => {
    assert.deepEqual(filterMonthLabelsFromStart(['2026-01', '2026-02'], '2026-06'), []);
  });
});

describe('sku-context recent demand reconstruction', () => {
  it('core SKU with 20 consecutive zeros has recent90DailyAvg > calendar90', () => {
    const recentWindowEnd = new Date('2026-05-31T00:00:00.000Z');
    const recent90Since = new Date('2026-03-03T00:00:00.000Z');
    const recent30Since = new Date('2026-05-02T00:00:00.000Z');
    const sales: Array<{ saleDate: string; qtySold: number }> = [];
    for (let t = recent90Since.getTime(); t <= recentWindowEnd.getTime(); t += 86400000) {
      const saleDate = new Date(t).toISOString().slice(0, 10);
      sales.push({
        saleDate,
        qtySold: saleDate <= '2026-05-11' ? 100 / 70 : 0,
      });
    }

    const calendar90 = sales.reduce((sum, row) => sum + row.qtySold, 0) / 90;
    const calendar30 =
      sales
        .filter((row) => row.saleDate >= '2026-05-02')
        .reduce((sum, row) => sum + row.qtySold, 0) / 30;
    const salesDays90 = sales.filter((row) => row.qtySold > 0).length;
    const lifecycle = classifySalesLifecycle({
      ageDays: 365,
      salesDayRatio90: salesDays90 / 90,
      recent30DailyAvg: calendar30,
      recent90DailyAvg: calendar90,
      maxZeroRunDays: 20,
    });
    const windows = resolveRecentDemandWindows({
      sales,
      recent30Since,
      recent90Since,
      recentWindowEnd,
      lifecycle,
      firstSaleDate: '2025-01-01',
    });

    assert.notEqual(lifecycle, 'new');
    assert.notEqual(lifecycle, 'intermittent');
    assert.ok(windows.recent90DailyAvg > windows.calendar90);
  });
});
