import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateForecastRows } from './forecast-demand.js';
import {
  deriveSkuTrendFactor,
  buildHistoryMonthLabels,
  buildConfiguredHorizonLabels,
  resolveHorizonProfileSegmentFilter,
  resolveAnchorProfileSegment,
  findFirstForecastMonth,
  pickPrimaryTierRow,
} from './forecast-horizon.js';

describe('forecast-horizon', () => {
  it('builds history month labels ending before asOf month', () => {
    const labels = buildHistoryMonthLabels(3, new Date('2026-06-15T00:00:00.000Z'));
    assert.deepEqual(
      labels.map((l) => l.monthLabel),
      ['2026-03', '2026-04', '2026-05'],
    );
  });

  it('builds configured horizon labels from month count regardless of DB rows', () => {
    const labels = buildConfiguredHorizonLabels(3, new Date('2026-07-04T00:00:00.000Z'));
    assert.deepEqual(
      labels.map((l) => l.monthLabel),
      ['2026-07', '2026-08', '2026-09'],
    );
  });

  it('derives sku trend from forecast, baseline and category combined', () => {
    assert.equal(
      deriveSkuTrendFactor({
        forecastDailyAvg: 11.5,
        baselineDailyAvg: 10,
        categoryCombinedFactor: 1.15,
      }),
      1,
    );
    assert.equal(
      deriveSkuTrendFactor({
        forecastDailyAvg: 5,
        baselineDailyAvg: 0,
        categoryCombinedFactor: 1,
      }),
      null,
    );
  });

  it('aggregates per-platform forecast rows for ALL horizon display', () => {
    const map = aggregateForecastRows([
      { forecastYear: 2026, month: 7, forecastDailyAvg: 10, platform: 'AMAZON' },
      { forecastYear: 2026, month: 7, forecastDailyAvg: 3, platform: 'WALMART' },
      { forecastYear: 2026, month: 8, forecastDailyAvg: 8, platform: 'AMAZON' },
    ]);
    assert.equal(map.get('2026-07'), 13);
    assert.equal(map.get('2026-08'), 8);
  });

  it('resolveHorizonProfileSegmentFilter maps pending calibration to T99 only', () => {
    assert.equal(
      resolveHorizonProfileSegmentFilter({ profileSegment: 'T4B', pendingCalibration: true }),
      'T99',
    );
    assert.equal(resolveHorizonProfileSegmentFilter({ profileSegment: 'T4B' }), 'T4B');
    assert.equal(resolveHorizonProfileSegmentFilter({ profileSegment: 'T99' }), 'T99');
    assert.equal(resolveHorizonProfileSegmentFilter({}), null);
  });

  it('resolveAnchorProfileSegment uses first forecast month and prefers non-T99 AMAZON', () => {
    const rows = [
      { forecastYear: 2026, month: 7, platform: 'WALMART', profileSegment: 'T99' },
      { forecastYear: 2026, month: 7, platform: 'AMAZON', profileSegment: 'T4A' },
      { forecastYear: 2026, month: 8, platform: 'WALMART', profileSegment: 'T99' },
    ];
    assert.deepEqual(findFirstForecastMonth(rows), { forecastYear: 2026, month: 7 });
    assert.equal(resolveAnchorProfileSegment(rows), 'T4A');
    assert.equal(
      resolveAnchorProfileSegment([
        { forecastYear: 2026, month: 7, platform: 'WALMART', profileSegment: 'T99' },
        { forecastYear: 2026, month: 7, platform: 'TIKTOK', profileSegment: 'T99' },
      ]),
      'T99',
    );
    assert.equal(
      resolveAnchorProfileSegment([
        { forecastYear: 2026, month: 7, platform: 'AMAZON', profileSegment: null },
        { forecastYear: 2026, month: 7, platform: 'WALMART', profileSegment: 'T1' },
      ]),
      'T1',
    );
  });

  it('pickPrimaryTierRow prefers AMAZON over other non-T99 when WALMART is listed first', () => {
    const rows = [
      { forecastYear: 2026, month: 7, platform: 'WALMART', profileSegment: 'T4B' },
      { forecastYear: 2026, month: 7, platform: 'AMAZON', profileSegment: 'T1' },
    ];
    const picked = pickPrimaryTierRow(rows);
    assert.equal(picked?.platform, 'AMAZON');
    assert.equal(picked?.profileSegment, 'T1');
    assert.equal(resolveAnchorProfileSegment(rows), 'T1');
  });

  it('pickPrimaryTierRow ignores AI marker when choosing product tier', () => {
    const rows = [
      { forecastYear: 2026, month: 7, platform: 'AMAZON', profileSegment: 'AI' },
      { forecastYear: 2026, month: 7, platform: 'WALMART', profileSegment: 'T2' },
    ];
    const picked = pickPrimaryTierRow(rows);
    assert.equal(picked?.profileSegment, 'T2');
    assert.equal(resolveAnchorProfileSegment(rows), 'T2');
  });
});
