import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rollupForecastLeaves } from './forecast-region-rollup.js';

const leaves = [
  { skuId: 's1', salesRegion: 'US', platform: 'AMAZON', forecastYear: 2026, month: 11, effectiveDailyAvg: 10 },
  { skuId: 's1', salesRegion: 'US', platform: 'WALMART', forecastYear: 2026, month: 11, effectiveDailyAvg: 5 },
  { skuId: 's1', salesRegion: 'EU', platform: 'AMAZON', forecastYear: 2026, month: 11, effectiveDailyAvg: 4 },
  { skuId: 's1', salesRegion: 'ALL', platform: 'AMAZON', forecastYear: 2026, month: 11, effectiveDailyAvg: 99 },
];

describe('forecast-region-rollup', () => {
  it('region_all_platforms sums channels', () => {
    const rows = rollupForecastLeaves(leaves, 'region_all_platforms');
    const us = rows.find((r) => r.salesRegion === 'US')!;
    assert.equal(us.effectiveDailyAvg, 15);
    assert.equal(us.platform, 'ALL');
  });

  it('all_regions_platform sums regions', () => {
    const rows = rollupForecastLeaves(leaves, 'all_regions_platform');
    const amz = rows.find((r) => r.platform === 'AMAZON')!;
    assert.equal(amz.effectiveDailyAvg, 14);
    assert.equal(amz.salesRegion, 'ALL');
  });

  it('grand total', () => {
    const rows = rollupForecastLeaves(leaves, 'all_regions_all_platforms');
    assert.equal(rows[0]!.effectiveDailyAvg, 19);
  });
});
