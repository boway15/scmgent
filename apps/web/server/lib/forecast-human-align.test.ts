/**
 * 对齐人工判断的关键约束单测（DJ502530_2 类场景）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyPeerPlatformNearFloor,
  applyT4aFarRecent90Floor,
  applyV41SecondaryChannelRunRateCap,
  computePeakYoyRatio,
} from './forecast-allcat-v41.js';
import {
  applyPostLandingNearRunRateCap,
  applyPostLandingSecondaryChannelCap,
  POST_LANDING_SHADOW_RUNRATE_UPLIFT,
  POST_LANDING_SHADOW_UPLIFT,
} from './forecast-optimism-post-landing.js';
import { blendRecent30WithMtd } from './forecast-baseline.js';
import { resolveAllowPeakFull } from './forecast-seasonal-dampen.js';

function roundLike(value: number): number {
  return Math.round(value * 100) / 100;
}

describe('forecast-human-align (DJ502530_2 shape)', () => {
  it('does not peer-lift collapsed Walmart toward Amazon run-rate', () => {
    const lifted = applyPeerPlatformNearFloor({
      forecastDaily: 2.2,
      horizonIndex: 0,
      peerPlatformRecentDaily: 55,
      platform: 'WALMART',
      recent30DailyAvg: 2,
    });
    assert.equal(lifted.peerPlatformFloor, null);
    assert.equal(lifted.forecastDaily, 2.2);

    const afterCap = applyV41SecondaryChannelRunRateCap({
      forecastDaily: 11.8,
      platform: 'WALMART',
      recent30DailyAvg: 2,
    });
    assert.equal(afterCap, roundLike(2 * 1.1));
  });

  it('post-landing secondary cap stays near Walmart recent not shadow', () => {
    const capped = applyPostLandingSecondaryChannelCap({
      forecastDaily: 11.8,
      platform: 'WALMART',
      recent30DailyAvg: 2,
      shadowDaily: 10,
    });
    assert.equal(capped, 2);
  });

  it('MTD blend pulls Nov anchor toward ~60 MTD from softer recent', () => {
    const blend = blendRecent30WithMtd({
      recent30DailyAvg: 52.74,
      mtdDaily: 60.43,
      mtdDays: 7,
      mtdWeight: 0.5,
    });
    assert.equal(blend.applied, true);
    assert.ok(blend.blended > 55 && blend.blended < 58);
  });

  it('near cap dual top keeps Amazon Nov closer to run-rate when shadow high', () => {
    const capped = applyPostLandingNearRunRateCap({
      forecastDaily: 81,
      horizonIndex: 0,
      recent30DailyAvg: 56.5,
      d6: 55,
      shadowDaily: 78,
    });
    const expected = roundLike(
      Math.min(78 * POST_LANDING_SHADOW_UPLIFT, 56.5 * POST_LANDING_SHADOW_RUNRATE_UPLIFT),
    );
    assert.equal(capped, expected);
    assert.ok(capped <= 75);
    assert.ok(capped < 81);
  });

  it('T4A April floor only lifts severe under-forecast', () => {
    const floored = applyT4aFarRecent90Floor({
      tier: 'T4A',
      forecastDaily: 20,
      horizonIndex: 5,
      recent90DailyAvg: 60,
      floorRatio: 0.55,
      triggerRatio: 0.45,
    });
    assert.equal(floored, roundLike(33));
    const mild = applyT4aFarRecent90Floor({
      tier: 'T4A',
      forecastDaily: 38.73,
      horizonIndex: 5,
      recent90DailyAvg: 60,
      floorRatio: 0.55,
      triggerRatio: 0.45,
    });
    assert.equal(mild, 38.73);
  });

  it('peak YoY damp disables full peak when ratio < 0.6', () => {
    const ratio = computePeakYoyRatio({
      monthlyRows: [
        { saleYear: 2025, month: 8, qtySold: 4000 },
        { saleYear: 2025, month: 9, qtySold: 4000 },
        { saleYear: 2025, month: 10, qtySold: 4000 },
      ],
      recent90DailyAvg: 55,
      endYear: 2026,
      endMonth: 10,
    });
    assert.ok(ratio != null && ratio < 0.6);
    assert.equal(resolveAllowPeakFull({ peakYoyRatio: ratio, threshold: 0.6 }), false);
  });
});
