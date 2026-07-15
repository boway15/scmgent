import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllCatV41CoreKpiTier,
  isForecastRowComparableForAccuracy,
  isForecastRowIncludedInAccuracyStats,
} from './forecast-accuracy-comparable.js';

describe('forecast-accuracy-comparable', () => {
  it('includes all forecast>0 rows in accuracy stats', () => {
    assert.equal(isForecastRowIncludedInAccuracyStats({ forecastDaily: 1.2 }), true);
    assert.equal(isForecastRowIncludedInAccuracyStats({ forecastDaily: 0 }), false);
  });

  it('includes T4B and ghost-tier rows in accuracy stats when forecast>0', () => {
    assert.equal(
      isForecastRowIncludedInAccuracyStats({ forecastDaily: 0.5 }),
      true,
    );
  });

  it('excludes V4.1 T4B and T99 from strict KPI accuracy', () => {
    assert.equal(
      isForecastRowComparableForAccuracy({
        profileSegment: 'T4B',
        forecastProfileClass: 'C',
        actualDaily: 10,
      }),
      false,
    );
    assert.equal(
      isForecastRowComparableForAccuracy({
        profileSegment: 'T99',
        forecastProfileClass: 'D',
        actualDaily: 5,
      }),
      false,
    );
    assert.equal(
      isForecastRowComparableForAccuracy({
        profileSegment: 'T1',
        forecastProfileClass: 'A',
        actualDaily: 20,
      }),
      true,
    );
  });

  it('keeps legacy ABCD segments comparable when actual > 0', () => {
    assert.equal(
      isForecastRowComparableForAccuracy({
        profileSegment: 'A:core',
        forecastProfileClass: 'A',
        actualDaily: 8,
      }),
      true,
    );
    assert.equal(
      isForecastRowComparableForAccuracy({
        profileSegment: 'D:floor',
        forecastProfileClass: 'D',
        actualDaily: 8,
      }),
      false,
    );
  });

  it('identifies core KPI tiers', () => {
    assert.equal(isAllCatV41CoreKpiTier('T1'), true);
    assert.equal(isAllCatV41CoreKpiTier('T2'), true);
    assert.equal(isAllCatV41CoreKpiTier('T3'), false);
  });
});
