import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  freezeHorizonMonths,
  isDemandPeriodFrozen,
  reconcileSkuQtyToParentTotal,
} from './demand-plan-freeze.js';

describe('demand-plan-freeze', () => {
  it('computes freeze months from lead days', () => {
    assert.equal(freezeHorizonMonths(90), 3);
    assert.equal(freezeHorizonMonths(45), 2);
  });

  it('freezes early horizon months', () => {
    assert.equal(
      isDemandPeriodFrozen({
        period: '2026-10',
        startMonth: '2026-10',
        freezeMonths: 3,
      }),
      true,
    );
    assert.equal(
      isDemandPeriodFrozen({
        period: '2026-12',
        startMonth: '2026-10',
        freezeMonths: 3,
      }),
      true,
    );
    assert.equal(
      isDemandPeriodFrozen({
        period: '2027-01',
        startMonth: '2026-10',
        freezeMonths: 3,
      }),
      false,
    );
  });

  it('reconciles sku drafts to parent total', () => {
    assert.deepEqual(
      reconcileSkuQtyToParentTotal({ skuDraftQty: [10, 20, 30], parentTotal: 100 }),
      [17, 33, 50],
    );
  });
});
