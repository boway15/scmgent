import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fitLinear,
  monthlySeasonalFactors,
  clipFactor,
  extrapolateTrendSeasonal,
  scaleChildrenToParent,
} from './layered-forecast-series.js';

describe('layered-forecast-series', () => {
  describe('fitLinear', () => {
    it('fits a perfect line', () => {
      const fit = fitLinear([10, 20, 30]);
      assert.equal(fit.a, 10);
      assert.equal(fit.b, 10);
      assert.equal(fit.r2, 1);
    });

    it('returns zeros for empty input', () => {
      const fit = fitLinear([]);
      assert.equal(fit.a, 0);
      assert.equal(fit.b, 0);
      assert.equal(fit.r2, 0);
    });
  });

  describe('clipFactor', () => {
    it('clips below min and above max', () => {
      assert.equal(clipFactor(0.5), 0.7);
      assert.equal(clipFactor(1.5), 1.3);
      assert.equal(clipFactor(1.0), 1.0);
    });

    it('respects custom bounds', () => {
      assert.equal(clipFactor(0.2, 0.5, 1.5), 0.5);
      assert.equal(clipFactor(2.0, 0.5, 1.5), 1.5);
    });
  });

  describe('monthlySeasonalFactors', () => {
    it('normalizes factors to mean 1 and finds peak month', () => {
      const values = [100, 100, 100, 100, 100, 100, 200, 100, 100, 100, 100, 100];
      const periods = [
        '2024-01',
        '2024-02',
        '2024-03',
        '2024-04',
        '2024-05',
        '2024-06',
        '2024-07',
        '2024-08',
        '2024-09',
        '2024-10',
        '2024-11',
        '2024-12',
      ];
      const { factors, peakMonth, strength } = monthlySeasonalFactors(values, periods);
      const factorValues = Object.values(factors);
      const mean =
        factorValues.reduce((sum, f) => sum + f, 0) / factorValues.length;
      assert.ok(Math.abs(mean - 1) < 0.01);
      assert.equal(peakMonth, 7);
      assert.ok(strength > 0);
      assert.ok(factors[7]! > factors[1]!);
    });
  });

  describe('extrapolateTrendSeasonal', () => {
    it('extrapolates trend × clipped season for long history', () => {
      const history = [100, 110, 120, 130, 140, 150];
      const historyPeriods = [
        '2025-01',
        '2025-02',
        '2025-03',
        '2025-04',
        '2025-05',
        '2025-06',
      ];
      const futurePeriods = ['2025-07', '2025-08'];
      const { qty, seasonalityFactor, peakMonth } = extrapolateTrendSeasonal(
        history,
        historyPeriods,
        futurePeriods,
      );

      assert.equal(qty.length, 2);
      assert.equal(seasonalityFactor.length, 2);
      assert.ok(qty.every((q) => q >= 0));
      assert.ok(seasonalityFactor.every((f) => f >= 0.7 && f <= 1.3));
      assert.ok(peakMonth >= 1 && peakMonth <= 12);
      assert.ok(qty[0]! > history[history.length - 1]!);
    });

    it('uses mean × season for short history (< 3)', () => {
      const history = [80, 120];
      const historyPeriods = ['2025-11', '2025-12'];
      const futurePeriods = ['2026-01', '2026-02'];
      const { qty } = extrapolateTrendSeasonal(history, historyPeriods, futurePeriods);

      assert.equal(qty.length, 2);
      assert.ok(qty.every((q) => q >= 0));
      const mean = (80 + 120) / 2;
      assert.ok(Math.abs(qty[0]! - mean) < mean * 0.5);
    });

    it('clamps negative extrapolation to zero', () => {
      const history = [100, 50, 10];
      const historyPeriods = ['2025-01', '2025-02', '2025-03'];
      const futurePeriods = ['2025-04', '2025-05', '2025-06'];
      const { qty } = extrapolateTrendSeasonal(history, historyPeriods, futurePeriods);

      assert.ok(qty.every((q) => q >= 0));
    });
  });

  describe('scaleChildrenToParent', () => {
    it('scales proportionally so sum equals parentQty', () => {
      const scaled = scaleChildrenToParent(100, [25, 75]);
      assert.deepEqual(scaled, [25, 75]);
      assert.equal(scaled.reduce((a, b) => a + b, 0), 100);
    });

    it('splits equally when all drafts are zero', () => {
      const scaled = scaleChildrenToParent(100, [0, 0, 0]);
      assert.equal(scaled.reduce((a, b) => a + b, 0), 100);
      assert.deepEqual(scaled, [33.33, 33.33, 33.34]);
    });

    it('rounds to 2 decimals and adjusts last item', () => {
      const scaled = scaleChildrenToParent(10, [1, 2, 3]);
      assert.equal(scaled.reduce((a, b) => a + b, 0), 10);
      assert.equal(scaled[0], 1.67);
      assert.equal(scaled[1], 3.33);
      assert.equal(scaled[2], 5);
    });

    it('returns empty array for no children', () => {
      assert.deepEqual(scaleChildrenToParent(100, []), []);
    });
  });
});
