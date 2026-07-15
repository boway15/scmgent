import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forecastT3SeasonalDaily } from './forecast-t3-seasonal.js';
import {
  assessT2DemandProfile,
  forecastT2StableDaily,
} from './forecast-t2-stable.js';

describe('forecast-t3-seasonal', () => {
  it('uses seasonal blend for seasonal series', () => {
    const qty = [40, 50, 60, 45, 55, 65, 42, 52, 62, 48, 58, 68];
    const r = forecastT3SeasonalDaily({
      monthlyQty: qty,
      horizonIndex: 0,
      forecastYear: 2026,
      forecastMonth: 1,
      cv12m: 1.1,
    });
    assert.equal(r.model, 't3_seasonal');
    assert.ok(r.forecastDailyAvg > 0);
  });
});

describe('forecast-t2-stable', () => {
  it('returns t2_stable model for steady waist series', () => {
    const qty = [120, 130, 125, 128, 122, 135, 118, 132, 126, 129, 124, 131];
    const r = forecastT2StableDaily({
      monthlyQty: qty,
      rawMonthlyQty: qty,
      horizonIndex: 0,
      forecastYear: 2026,
      forecastMonth: 1,
    });
    assert.equal(r.model, 't2_stable');
    assert.ok(r.forecastDailyAvg > 0);
  });

  it('scales down intermittent-within-T2 instead of hard zero when last month sells', () => {
    const qty = [80, 0, 90, 0, 85, 0, 95, 0, 88, 0, 92, 70];
    const profile = assessT2DemandProfile(qty);
    assert.ok(profile.zeroMonthsLast12 >= 2);
    const r = forecastT2StableDaily({
      monthlyQty: qty,
      rawMonthlyQty: qty,
      horizonIndex: 2,
      forecastYear: 2026,
      forecastMonth: 1,
    });
    assert.equal(r.model, 't2_stable');
    assert.ok(r.forecastDailyAvg > 0);
    const med = profile.med6Monthly / 30;
    assert.ok(r.forecastDailyAvg < med * 1.2);
  });

  it('zeros truly stale series', () => {
    const qty = [50, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const r = forecastT2StableDaily({
      monthlyQty: qty,
      rawMonthlyQty: qty,
      horizonIndex: 0,
      forecastYear: 2026,
      forecastMonth: 1,
    });
    assert.equal(r.model, 'a_risk_zero');
    assert.equal(r.forecastDailyAvg, 0);
  });
});
