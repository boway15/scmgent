import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyVolumeTier,
  evaluateForecastEligibility,
  shouldUseCategoryReference,
} from './forecast-eligibility.js';
import { computeWeightedMape, summarizeAccuracyByTier } from './forecast-accuracy-tier.js';

describe('forecast-eligibility', () => {
  it('passes when recent90 > 0', () => {
    assert.deepEqual(
      evaluateForecastEligibility({
        recent30DailyAvg: 1,
        recent90DailyAvg: 2,
        salesDays365: 10,
      }),
      { eligible: true, tier: 'mid' },
    );
  });

  it('skips when no sales signal', () => {
    assert.deepEqual(
      evaluateForecastEligibility({
        recent30DailyAvg: 0,
        recent90DailyAvg: 0,
        salesDays365: 5,
      }),
      { eligible: false, reason: 'no_recent_sales' },
    );
  });

  it('blocks category reference for intermittent', () => {
    assert.equal(
      shouldUseCategoryReference({
        lifecycle: 'intermittent',
        recent30DailyAvg: 1,
        recent90DailyAvg: 2,
      }),
      false,
    );
  });
});

describe('forecast-accuracy-tier', () => {
  it('computes weighted MAPE', () => {
    const mape = computeWeightedMape([
      { skuCode: 'A', actualDaily: 10, forecastDaily: 8, mape: 0.25, biasRate: -0.2 },
      { skuCode: 'B', actualDaily: 1, forecastDaily: 3, mape: 2, biasRate: -0.5 },
    ]);
    assert.ok(Math.abs(mape! - 0.3636) < 0.001);
  });

  it('classifies core tier', () => {
    assert.equal(classifyVolumeTier(5), 'core');
    assert.equal(classifyVolumeTier(4.99), 'mid');
  });
});
