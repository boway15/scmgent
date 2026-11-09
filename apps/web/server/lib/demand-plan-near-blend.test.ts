import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NEAR_BLEND_ALPHAS,
  blendInlineWeekDaily,
  nearBlendAlpha,
  resolveNearBlendLevel,
  resolveNearBlendShape,
} from './demand-plan-near-blend.js';

describe('demand-plan-near-blend', () => {
  it('uses the decay schedule then zero alpha', () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4, 10].map((weekIndex) => nearBlendAlpha(weekIndex)),
      [...NEAR_BLEND_ALPHAS, 0, 0],
    );
  });

  it('returns inline daily unchanged from week 5', () => {
    const blended = blendInlineWeekDaily({
      weekIndex: 4,
      inlineDaily: 8.2,
      anchorInlineDaily: 10,
      nearLevel: 20,
    });
    assert.equal(blended.alpha, 0);
    assert.equal(blended.forecastDaily, 8.2);
  });

  it('uses shape 1 when the anchor week has no inline forecast', () => {
    assert.equal(resolveNearBlendShape(4, 0), 1);
    const blended = blendInlineWeekDaily({
      weekIndex: 0,
      inlineDaily: 4,
      anchorInlineDaily: 0,
      nearLevel: 10,
    });
    assert.equal(blended.shape, 1);
    assert.equal(blended.forecastDaily, 8.2);
  });

  it('winsorizes the near level against r90', () => {
    assert.equal(resolveNearBlendLevel({ r14: 100, unconstrainedRecentDaily: 100, r90: 10 }), 25);
    assert.equal(resolveNearBlendLevel({ r14: 1, unconstrainedRecentDaily: 1, r90: 10 }), 4);
    assert.equal(resolveNearBlendLevel({ r14: 12, unconstrainedRecentDaily: 8, r90: 0 }), 10.4);
  });

  it('pulls the first weeks toward the near level while keeping monthly shape', () => {
    const first = blendInlineWeekDaily({
      weekIndex: 0,
      inlineDaily: 10,
      anchorInlineDaily: 10,
      nearLevel: 20,
    });
    assert.equal(first.shape, 1);
    assert.equal(first.alpha, 0.7);
    assert.equal(first.forecastDaily, 17);

    const shaped = blendInlineWeekDaily({
      weekIndex: 1,
      inlineDaily: 5,
      anchorInlineDaily: 10,
      nearLevel: 20,
    });
    assert.equal(shaped.shape, 0.5);
    assert.equal(shaped.forecastDaily, 7.5);
  });
});
