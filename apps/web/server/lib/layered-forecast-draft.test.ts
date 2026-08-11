import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeSkuDraftQty } from './layered-forecast-draft.js';

describe('layered-forecast-draft', () => {
  describe('computeSkuDraftQty', () => {
    it('computes daily rate × month days × clipped seasonality', () => {
      // 900 over 90 days = 10/day; January has 31 days; factor 1.0
      const qty = computeSkuDraftQty({
        recent90Qty: 900,
        period: '2026-01',
        seasonalityFactor: 1.0,
      });
      assert.equal(qty, 310);
    });

    it('uses daysInMonth for the target period', () => {
      const feb = computeSkuDraftQty({
        recent90Qty: 900,
        period: '2026-02',
        seasonalityFactor: 1.0,
      });
      // 10/day × 28 days
      assert.equal(feb, 280);
    });

    it('clips seasonality factor to [0.7, 1.3]', () => {
      const low = computeSkuDraftQty({
        recent90Qty: 900,
        period: '2026-01',
        seasonalityFactor: 0.5,
      });
      const high = computeSkuDraftQty({
        recent90Qty: 900,
        period: '2026-01',
        seasonalityFactor: 2.0,
      });
      assert.equal(low, 310 * 0.7);
      assert.equal(high, 310 * 1.3);
    });

    it('clamps negative results to zero', () => {
      const qty = computeSkuDraftQty({
        recent90Qty: -100,
        period: '2026-01',
        seasonalityFactor: 1.0,
      });
      assert.equal(qty, 0);
    });

    it('returns zero when recent90Qty is zero', () => {
      const qty = computeSkuDraftQty({
        recent90Qty: 0,
        period: '2026-06',
        seasonalityFactor: 1.1,
      });
      assert.equal(qty, 0);
    });
  });
});
