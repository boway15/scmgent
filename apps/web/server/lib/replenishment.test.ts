import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcDailyStats, calcSafetyStock } from './replenishment.js';

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

describe('calcDailyStats', () => {
  it('counts zero-sale days in the std dev window', () => {
    const sales = [
      { qtySold: 10, saleDate: isoDaysAgo(1) },
      { qtySold: 10, saleDate: isoDaysAgo(2) },
    ];
    const r = calcDailyStats(sales, 10);
    assert.equal(r.avgDaily, 2);
    // 2 天 10、8 天 0，均值 2 → 方差 (2×64 + 8×4)/10 = 16
    assert.equal(r.stdDev, 4);
  });

  it('returns zero std dev for flat daily demand', () => {
    const sales = Array.from({ length: 5 }, (_, i) => ({ qtySold: 3, saleDate: isoDaysAgo(i) }));
    const r = calcDailyStats(sales, 5);
    assert.equal(r.avgDaily, 3);
    assert.equal(r.stdDev, 0);
  });
});

describe('calcSafetyStock', () => {
  it('delegates to z table (0.99 → 2.33)', () => {
    assert.equal(calcSafetyStock(4, 25, 0.99), Math.ceil(2.33 * 4 * 5));
    assert.equal(calcSafetyStock(4, 25), Math.ceil(1.65 * 4 * 5));
  });
});
