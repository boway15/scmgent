import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLast12MonthlyQty,
  monthlyQtyToAvgDaily,
  resolveSkuProfileSnapshot,
} from './forecast-profile-snapshot.js';
import { DEFAULT_FORECAST_PROFILE_CONFIG } from './forecast-profile-config.js';

describe('forecast-profile-snapshot', () => {
  it('builds 12 months ending before asOf', () => {
    const asOf = new Date('2026-01-01T00:00:00.000Z');
    const qty = buildLast12MonthlyQty(
      [
        { saleYear: 2025, month: 12, qtySold: 310 },
        { saleYear: 2025, month: 11, qtySold: 300 },
      ],
      asOf,
    );
    assert.equal(qty.length, 12);
    assert.equal(qty[qty.length - 2], 310);
  });

  it('uses monthly qty / days for volume tier (not raw monthly total)', () => {
    const asOf = new Date('2026-01-01T00:00:00.000Z');
    const monthlyQty = Array(12).fill(300);
    const avgDaily = monthlyQtyToAvgDaily(monthlyQty, asOf);
    assert.ok(avgDaily > 5 && avgDaily < 15, `expected ~10/day, got ${avgDaily}`);
    const profile = resolveSkuProfileSnapshot({ monthlyQty, asOf, recent90DailyAvg: 10 });
    assert.equal(profile.volumeTier, 'core');
  });

  it('demotes A class to mid when recent90 below core threshold', () => {
    const asOf = new Date('2026-01-01T00:00:00.000Z');
    const monthlyQty = Array(12).fill(6000);
    const profile = resolveSkuProfileSnapshot({
      monthlyQty,
      asOf,
      recent90DailyAvg: 3,
    });
    assert.equal(profile.profileClass, 'A');
    assert.equal(profile.segment, 'A:mid');
  });

  it('demotes A core when continuity below coreContinuityMin', () => {
    const asOf = new Date('2026-01-01T00:00:00.000Z');
    const monthlyQty = [...Array(10).fill(3000), 0, 0];
    const profile = resolveSkuProfileSnapshot({
      monthlyQty,
      asOf,
      recent90DailyAvg: 12,
      config: { ...DEFAULT_FORECAST_PROFILE_CONFIG, coreContinuityMin: 0.9 },
    });
    assert.equal(profile.profileClass, 'A');
    assert.equal(profile.segment, 'A:mid');
  });
});
