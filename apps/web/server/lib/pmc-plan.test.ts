import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePmcHorizonForecastDaily } from './pmc-plan.js';

describe('pmc-plan horizon consumption', () => {
  it('A class flex window applies 1.1 buffer', () => {
    const daily = resolvePmcHorizonForecastDaily({
      forecastDailyAvg: 10,
      horizonMonthIndex: 4,
      profileClass: 'A',
    });
    assert.equal(daily, 11);
  });

  it('B class flex window uses P90', () => {
    const daily = resolvePmcHorizonForecastDaily({
      forecastDailyAvg: 10,
      forecastDailyP90: 15,
      horizonMonthIndex: 4,
      profileClass: 'B',
    });
    assert.equal(daily, 15);
  });

  it('precision window keeps point forecast for A', () => {
    const daily = resolvePmcHorizonForecastDaily({
      forecastDailyAvg: 10,
      horizonMonthIndex: 1,
      profileClass: 'A',
    });
    assert.equal(daily, 10);
  });
});
