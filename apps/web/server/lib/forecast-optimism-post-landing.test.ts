import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyPostLandingNearRunRateCap,
  applyPostLandingOptimismCaps,
  applyPostLandingSecondaryChannelCap,
  POST_LANDING_RUNRATE_UPLIFT,
  POST_LANDING_SECONDARY_UPLIFT,
} from './forecast-optimism-post-landing.js';

function roundLike(value: number): number {
  return Math.round(value * 100) / 100;
}

describe('forecast-optimism-post-landing', () => {
  it('near cap uses 1.10 even in peak month Nov', () => {
    const capped = applyPostLandingNearRunRateCap({
      forecastDaily: 80,
      horizonIndex: 0,
      recent30DailyAvg: 54,
      d6: 50,
    });
    assert.equal(capped, roundLike(54 * POST_LANDING_RUNRATE_UPLIFT));
  });

  it('near cap covers horizon 2 (next month after peak pair) but skips farther', () => {
    const jan = applyPostLandingNearRunRateCap({
      forecastDaily: 80,
      horizonIndex: 2,
      recent30DailyAvg: 54,
      d6: 50,
    });
    assert.equal(jan, roundLike(54 * POST_LANDING_RUNRATE_UPLIFT));
    const far = applyPostLandingNearRunRateCap({
      forecastDaily: 80,
      horizonIndex: 3,
      recent30DailyAvg: 54,
      d6: 50,
    });
    assert.equal(far, 80);
  });

  it('secondary weak opening caps to ×1.0', () => {
    const capped = applyPostLandingSecondaryChannelCap({
      forecastDaily: 11.8,
      platform: 'WALMART',
      recent30DailyAvg: 2,
    });
    assert.equal(capped, roundLike(2 * POST_LANDING_SECONDARY_UPLIFT));
  });

  it('combo prefers the tighter secondary after near', () => {
    const damp = applyPostLandingOptimismCaps({
      forecastDaily: 20,
      platform: 'WALMART',
      horizonIndex: 0,
      recent30DailyAvg: 2,
      d6: 2,
    });
    assert.equal(damp.forecastDaily, roundLike(2 * POST_LANDING_SECONDARY_UPLIFT));
    assert.equal(damp.nearRunRateCap, null);
    assert.ok(damp.secondaryChannelCap != null);
  });
});
