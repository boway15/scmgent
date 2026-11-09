import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyPostLandingNearRunRateCap,
  applyPostLandingOptimismCaps,
  applyPostLandingSecondaryChannelCap,
  POST_LANDING_RUNRATE_UPLIFT,
  POST_LANDING_SHADOW_UPLIFT,
  POST_LANDING_SECONDARY_UPLIFT,
} from './forecast-optimism-post-landing.js';

function roundLike(value: number): number {
  return Math.round(value * 100) / 100;
}

describe('forecast-optimism-post-landing', () => {
  it('near cap prefers month shadow relative uplift over absolute run-rate', () => {
    const capped = applyPostLandingNearRunRateCap({
      forecastDaily: 80,
      horizonIndex: 0,
      recent30DailyAvg: 54,
      d6: 50,
      shadowDaily: 67.8,
    });
    assert.equal(capped, roundLike(67.8 * POST_LANDING_SHADOW_UPLIFT));
  });

  it('falls back to absolute run-rate when shadow missing', () => {
    const capped = applyPostLandingNearRunRateCap({
      forecastDaily: 80,
      horizonIndex: 0,
      recent30DailyAvg: 54,
      d6: 50,
    });
    assert.equal(capped, roundLike(54 * POST_LANDING_RUNRATE_UPLIFT));
  });

  it('shadow-relative caps preserve Dec>Jan seasonal gap', () => {
    const dec = applyPostLandingNearRunRateCap({
      forecastDaily: 76.74,
      horizonIndex: 1,
      recent30DailyAvg: 49.23,
      d6: 58.98,
      shadowDaily: 67.8,
    });
    const jan = applyPostLandingNearRunRateCap({
      forecastDaily: 65.21,
      horizonIndex: 2,
      recent30DailyAvg: 49.23,
      d6: 58.98,
      shadowDaily: 54.77,
    });
    assert.equal(dec, roundLike(67.8 * POST_LANDING_SHADOW_UPLIFT));
    assert.equal(jan, roundLike(54.77 * POST_LANDING_SHADOW_UPLIFT));
    assert.ok(dec > jan);
  });

  it('near cap covers horizon 2 but skips farther', () => {
    const jan = applyPostLandingNearRunRateCap({
      forecastDaily: 80,
      horizonIndex: 2,
      shadowDaily: 54,
    });
    assert.equal(jan, roundLike(54 * POST_LANDING_SHADOW_UPLIFT));
    const far = applyPostLandingNearRunRateCap({
      forecastDaily: 80,
      horizonIndex: 3,
      shadowDaily: 54,
    });
    assert.equal(far, 80);
  });

  it('secondary weak opening caps to shadow×1.0 when present', () => {
    const capped = applyPostLandingSecondaryChannelCap({
      forecastDaily: 11.8,
      platform: 'WALMART',
      recent30DailyAvg: 2,
      shadowDaily: 3.5,
    });
    assert.equal(capped, roundLike(3.5 * POST_LANDING_SECONDARY_UPLIFT));
  });

  it('combo prefers the tighter secondary after near', () => {
    const damp = applyPostLandingOptimismCaps({
      forecastDaily: 20,
      platform: 'WALMART',
      horizonIndex: 0,
      recent30DailyAvg: 2,
      d6: 2,
      shadowDaily: 4,
    });
    // near: min(20, 4*1.1)=4.4；secondary: min(4.4, 4*1.0)=4
    assert.equal(damp.forecastDaily, roundLike(4 * POST_LANDING_SECONDARY_UPLIFT));
    assert.ok(damp.nearRunRateCap != null);
    assert.ok(damp.secondaryChannelCap != null);
    assert.equal(damp.capMode, 'shadow_relative');
  });
});
