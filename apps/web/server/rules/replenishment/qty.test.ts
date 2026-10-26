import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideReplenishmentQty } from './qty.js';

describe('decideReplenishmentQty', () => {
  it('gap = demand + safety − supply, ceil', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 100.2, safetyStockQty: 20, supplyAtTarget: 50 }),
      71,
    );
  });
  it('caps at coverQty before MOQ', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 500, safetyStockQty: 0, supplyAtTarget: 0, coverQty: 300 }),
      300,
    );
  });
  it('MOQ lifts after cap', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 500, safetyStockQty: 0, supplyAtTarget: 0, coverQty: 300, moq: 400 }),
      400,
    );
  });
  it('no gap → 0 even with MOQ', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 10, safetyStockQty: 0, supplyAtTarget: 50, moq: 400 }),
      0,
    );
  });
  it('coverQty 0 means no cap', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 500, safetyStockQty: 0, supplyAtTarget: 0, coverQty: 0 }),
      500,
    );
  });
});
