import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMonthlyAvgMape,
  computeMonthlyAvgWmape,
  computeWeightedMape,
  capSkuWmapeForStats,
  SKU_WMAPE_STAT_CAP,
  type AccuracyRowInput,
} from './forecast-accuracy-tier.js';

function row(
  forecastYear: number,
  month: number,
  actualDaily: number,
  forecastDaily: number,
): AccuracyRowInput {
  return {
    skuCode: 'SKU1',
    actualDaily,
    forecastDaily,
    mape: actualDaily > 0 ? Math.abs(forecastDaily - actualDaily) / actualDaily : null,
    biasRate: null,
    forecastYear,
    month,
  };
}

describe('forecast-accuracy-tier monthly averages', () => {
  it('computeMonthlyAvgWmape averages per-month WMAPE instead of pooling all months', () => {
    const rows = [
      row(2025, 1, 100, 90),
      row(2025, 2, 1000, 700),
    ];
    assert.equal(computeWeightedMape(rows), 0.2818181818181818);
    assert.equal(computeMonthlyAvgWmape(rows), 0.2);
  });

  it('computeMonthlyAvgMape averages signed monthly MAPE', () => {
    const rows = [
      row(2025, 1, 100, 110),
      row(2025, 2, 100, 90),
    ];
    assert.equal(computeMonthlyAvgMape(rows), 0);
  });

  it('computeMonthlyAvgMape excludes T4B from KPI pool', () => {
    const rows = [
      row(2025, 1, 100, 50),
      { ...row(2025, 1, 100, 100), profileSegment: 'T4B' },
    ];
    assert.equal(computeMonthlyAvgMape(rows), -0.5);
  });

  it('capSkuWmapeForStats caps extreme SKU WMAPE at 999%', () => {
    assert.equal(capSkuWmapeForStats(12.5), SKU_WMAPE_STAT_CAP);
    assert.equal(capSkuWmapeForStats(9.99), 9.99);
    assert.equal(capSkuWmapeForStats(0.42), 0.42);
    assert.equal(capSkuWmapeForStats(null), null);
  });
});
