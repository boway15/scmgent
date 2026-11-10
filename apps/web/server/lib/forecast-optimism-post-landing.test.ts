import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyPostLandingNearRunRateCap,
  applyPostLandingOptimismCaps,
  applyPostLandingSecondaryChannelCap,
  POST_LANDING_RUNRATE_UPLIFT,
  POST_LANDING_SHADOW_RUNRATE_UPLIFT,
  POST_LANDING_SHADOW_UPLIFT,
  POST_LANDING_SECONDARY_UPLIFT,
  scaleForecastQuantiles,
} from './forecast-optimism-post-landing.js';

function roundLike(value: number): number {
  return Math.round(value * 100) / 100;
}

describe('forecast-optimism-post-landing', () => {
  it('near cap uses min(shadow uplift, run-rate dual top) when both present', () => {
    const capped = applyPostLandingNearRunRateCap({
      forecastDaily: 80,
      horizonIndex: 0,
      recent30DailyAvg: 54,
      d6: 50,
      shadowDaily: 67.8,
    });
    assert.equal(
      capped,
      roundLike(Math.min(67.8 * POST_LANDING_SHADOW_UPLIFT, 54 * POST_LANDING_SHADOW_RUNRATE_UPLIFT)),
    );
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

  it('shadow-relative caps preserve Dec>Jan seasonal gap under run-rate dual top', () => {
    const dec = applyPostLandingNearRunRateCap({
      forecastDaily: 85,
      horizonIndex: 1,
      recent30DailyAvg: 49.23,
      d6: 58.98,
      shadowDaily: 67.8,
    });
    const jan = applyPostLandingNearRunRateCap({
      forecastDaily: 72,
      horizonIndex: 2,
      recent30DailyAvg: 49.23,
      d6: 58.98,
      shadowDaily: 54.77,
    });
    const decCap = Math.min(
      67.8 * POST_LANDING_SHADOW_UPLIFT,
      58.98 * POST_LANDING_SHADOW_RUNRATE_UPLIFT,
    );
    const janCap = Math.min(
      54.77 * POST_LANDING_SHADOW_UPLIFT,
      58.98 * POST_LANDING_SHADOW_RUNRATE_UPLIFT,
    );
    assert.equal(dec, roundLike(decCap));
    assert.equal(jan, roundLike(janCap));
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

  it('secondary weak opening caps to min(shadow, recent)×uplift', () => {
    const capped = applyPostLandingSecondaryChannelCap({
      forecastDaily: 11.8,
      platform: 'WALMART',
      recent30DailyAvg: 2,
      shadowDaily: 3.5,
    });
    assert.equal(capped, roundLike(2 * POST_LANDING_SECONDARY_UPLIFT));
  });

  it('secondary cap does not use shadow alone above recent', () => {
    const capped = applyPostLandingSecondaryChannelCap({
      forecastDaily: 11.8,
      platform: 'WALMART',
      recent30DailyAvg: 2,
      shadowDaily: 10,
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
      shadowDaily: 4,
    });
    // near: min(20, 4*1.1)=4.4；secondary: min(4.4, min(4,2)*1.0)=2
    assert.equal(damp.forecastDaily, roundLike(2 * POST_LANDING_SECONDARY_UPLIFT));
    assert.ok(damp.nearRunRateCap != null);
    assert.ok(damp.secondaryChannelCap != null);
    assert.equal(damp.capMode, 'shadow_relative');
  });

  it('scaleForecastQuantiles keeps P50 inside band and repairs stale inverted P90', () => {
    const ok = scaleForecastQuantiles({
      daily: 77.85,
      prevDaily: 81.59,
      p10: 66.9,
      p90: 96.28,
    });
    assert.equal(ok.p10, roundLike(66.9 * (77.85 / 81.59)));
    assert.equal(ok.p90, roundLike(96.28 * (77.85 / 81.59)));
    assert.ok(ok.p10 <= 77.85 && 77.85 <= ok.p90);

    const repaired = scaleForecastQuantiles({
      daily: 77.85,
      prevDaily: 81.59,
      p10: 53.04,
      p90: 76.34,
    });
    assert.ok(repaired.p10 <= 77.85 && 77.85 <= repaired.p90);
    assert.ok(repaired.p90 > 77.85);
  });
});
