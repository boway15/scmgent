import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  championRefLevel,
  classifyReconstructSource,
  clipDemandShape,
  systemDailyAvgForMonth,
  systemDailyAvgForWeek,
  warehouseShareWeight,
  weekWeightedForecastDaily,
} from './demand-plan-reconstruct.js';

describe('demand-plan-reconstruct', () => {
  it('clips shape to 0.5–2.0', () => {
    assert.equal(clipDemandShape(0.1), 0.5);
    assert.equal(clipDemandShape(3), 2);
    assert.equal(clipDemandShape(1.2), 1.2);
  });

  it('returns null share when warehouse missing', () => {
    assert.equal(warehouseShareWeight('US-WEST', [{ warehouse: 'US-EAST', weight: 1 }]), null);
    assert.equal(warehouseShareWeight('US-WEST', [{ warehouse: 'US-WEST', weight: 0.4 }]), 0.4);
  });

  it('uses first three positive months as champion ref', () => {
    assert.equal(championRefLevel([10, 10, 10, 20]), 10);
    assert.equal(championRefLevel([0, 0]), 0);
  });

  it('scales unconstrained by share and clipped shape', () => {
    const daily = systemDailyAvgForMonth({
      unconstrainedRecentDaily: 10,
      share: 0.5,
      monthForecastDaily: 20,
      championRefDaily: 10,
    });
    assert.equal(daily, 10); // 10 * 0.5 * clip(2)=10
  });

  it('classifies fallback without availability', () => {
    assert.equal(
      classifyReconstructSource({ hasAvailabilitySeries: false, inStockDays: 0 }),
      'fallback_forecast',
    );
    assert.equal(
      classifyReconstructSource({ hasAvailabilitySeries: true, inStockDays: 8 }),
      'reconstructed_shape',
    );
  });

  it('weights a split week by calendar days', () => {
    const monthly = new Map([['2026-01', 10], ['2026-02', 20]]);
    const daily = weekWeightedForecastDaily('2026-W05', monthly);
    assert.equal(daily, Math.round(((10 * 6 + 20 * 1) / 7) * 10000) / 10000);
  });

  it('treats missing month as 0 and does not fill from F_ref', () => {
    const monthly = new Map([['2026-01', 10]]);
    const daily = weekWeightedForecastDaily('2026-W05', monthly);
    assert.equal(daily, Math.round(((10 * 6 + 0 * 1) / 7) * 10000) / 10000);
  });

  it('delegates systemDailyAvgForWeek to month helper', () => {
    const daily = systemDailyAvgForWeek({
      unconstrainedRecentDaily: 10,
      share: 0.5,
      weekForecastDaily: 20,
      championRefDaily: 10,
    });
    assert.equal(daily, 10);
  });
});
