import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { synthesizeDailySalesFromMonthly } from './forecast-monthly-daily-fallback.js';

describe('synthesizeDailySalesFromMonthly', () => {
  it('spreads a month evenly and clips to the lookback window', () => {
    const monthlyBySku = new Map([
      ['sku-1', [{ saleYear: 2025, month: 10, qtySold: 31 }]],
    ]);
    const points = synthesizeDailySalesFromMonthly({
      monthlyBySku,
      fromDate: '2025-10-15',
      toDate: '2025-10-31',
    }).get('sku-1');
    assert.ok(points);
    assert.equal(points.length, 17);
    assert.equal(points[0]?.saleDate, '2025-10-15');
    assert.equal(points.at(-1)?.saleDate, '2025-10-31');
    const total = points.reduce((sum, point) => sum + point.qtySold, 0);
    assert.ok(Math.abs(total - 17) < 1e-9);
  });
});
