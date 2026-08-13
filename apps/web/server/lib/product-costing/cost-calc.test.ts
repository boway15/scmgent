import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcCostSummary } from './cost-calc.js';

describe('calcCostSummary', () => {
  it('uses override over book price', () => {
    const s = calcCostSummary([
      { qtyNet: 2, lossRate: 0, unitPriceOverride: 10, bookUnitPrice: 99, category: '五金' },
    ]);
    assert.equal(s.lines[0].lineAmount, 20);
    assert.equal(s.totalAmount, 20);
  });

  it('counts missing price and qty; zero total share is 0', () => {
    const s = calcCostSummary([
      { qtyNet: 0, lossRate: 0, unitPriceOverride: null, bookUnitPrice: null, category: '板材' },
    ]);
    assert.equal(s.missingQtyCount, 1);
    assert.equal(s.missingPriceCount, 1);
    assert.equal(s.totalAmount, 0);
    assert.equal(s.byCategory[0].share, 0);
  });
});
