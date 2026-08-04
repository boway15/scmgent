import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeSkuLifecycleLabel,
  computeSkuLifecycleLabelFromDailySales,
  labelForSalesLifecycle,
  SKU_LIFECYCLE_LABEL,
} from './sku-lifecycle.js';

describe('sku-lifecycle', () => {
  it('exposes chinese labels for all SalesLifecycle codes', () => {
    assert.equal(labelForSalesLifecycle('new'), '新品');
    assert.equal(labelForSalesLifecycle('mature'), '成熟');
    assert.equal(SKU_LIFECYCLE_LABEL.decline, '下滑');
  });

  it('leaves brand-new sku without sales as empty', () => {
    assert.equal(
      computeSkuLifecycleLabel({
        ageDays: 0,
        salesDayRatio90: 0,
        recent30DailyAvg: 0,
        recent90DailyAvg: 0,
        maxZeroRunDays: 0,
      }),
      null,
    );
    assert.equal(computeSkuLifecycleLabelFromDailySales([]), null);
  });

  it('classifies mature continuous sales', () => {
    const today = new Date('2026-07-24T00:00:00.000Z');
    const rows: Array<{ saleDate: string; qtySold: number }> = [];
    for (let i = 0; i < 100; i++) {
      const d = new Date(Date.UTC(2026, 3, 16));
      d.setUTCDate(d.getUTCDate() + i);
      rows.push({
        saleDate: d.toISOString().slice(0, 10),
        qtySold: 5,
      });
    }
    assert.equal(
      computeSkuLifecycleLabelFromDailySales(rows, {
        today,
        firstSaleDate: '2025-01-01',
      }),
      '成熟',
    );
  });

  it('classifies growth when recent30 >> recent90', () => {
    assert.equal(
      computeSkuLifecycleLabel({
        ageDays: 200,
        salesDayRatio90: 0.5,
        recent30DailyAvg: 20,
        recent90DailyAvg: 10,
        maxZeroRunDays: 2,
      }),
      '增长',
    );
  });
});
