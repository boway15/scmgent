import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  blendShadowWithHorizonDecay,
  buildHorizonIndexByMonthKey,
  dampenReshapeScale,
  shadowHorizonDecayAt,
} from './forecast-seasonal-dampen.js';

describe('forecast-seasonal-dampen', () => {
  it('decays shadow increment by horizon', () => {
    assert.equal(shadowHorizonDecayAt(0), 1);
    assert.equal(shadowHorizonDecayAt(1), 1);
    assert.equal(shadowHorizonDecayAt(2), 0.85);
    assert.equal(shadowHorizonDecayAt(9), 0.55);

    const blended = blendShadowWithHorizonDecay(100, 200, 2);
    assert.equal(blended, 100 + 0.85 * 100);

    const peak = blendShadowWithHorizonDecay(100, 200, 4, undefined, { calendarMonth: 12 });
    assert.equal(peak, 200);
  });

  it('keeps peak-month reshape full and damps near horizon', () => {
    const near = dampenReshapeScale(1.4, {
      horizonIndex: 0,
      calendarMonth: 2,
      nearBlend: 0.5,
      nearMonths: 2,
    });
    assert.equal(near, 1.2);

    const peak = dampenReshapeScale(1.4, {
      horizonIndex: 0,
      calendarMonth: 11,
      nearBlend: 0.5,
      nearMonths: 2,
    });
    assert.equal(peak, 1.4);

    const far = dampenReshapeScale(1.4, {
      horizonIndex: 3,
      calendarMonth: 4,
      nearBlend: 0.5,
      nearMonths: 2,
    });
    assert.equal(far, 1.4);
  });

  it('builds horizon index by sorted month keys', () => {
    const map = buildHorizonIndexByMonthKey([
      { year: 2026, month: 2 },
      { year: 2026, month: 4 },
      { year: 2026, month: 3 },
      { year: 2026, month: 2 },
    ]);
    assert.equal(map.get('2026-02'), 0);
    assert.equal(map.get('2026-03'), 1);
    assert.equal(map.get('2026-04'), 2);
  });
});
