import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  coverageAlongForecast,
  publishedNetworkAvgDaily,
  resolveNetworkForecastCoverage,
  sumForecastDemand,
} from './alert-network-coverage.js';

describe('coverageAlongForecast', () => {
  it('switches daily when the month changes, including a week that crosses months', () => {
    const forecast = new Map<string, number>([
      ['2026-09', 1],
      ['2026-10', 10],
    ]);
    const walked = coverageAlongForecast({
      qty: 10,
      startYmd: '2026-09-28',
      forecast,
    });
    assert.ok(walked.coverageDays != null && Math.abs(walked.coverageDays - 3.7) < 1e-9);
    assert.equal(walked.stockoutDate, '2026-10-01');
  });

  it('caps all-zero forecast days at 9999 when qty remains', () => {
    const walked = coverageAlongForecast({
      qty: 80,
      startYmd: '2026-09-30',
      forecast: new Map([['2026-09', 0], ['2026-10', 0]]),
    });
    assert.equal(walked.coverageDays, 9999);
  });

  it('sums window demand with each month daily instead of freezing the start month', () => {
    const forecast = new Map<string, number>([
      ['2026-09', 1],
      ['2026-10', 10],
      ['2026-11', 2],
      ['2026-12', 2],
    ]);
    const summed = sumForecastDemand(forecast, '2026-09-28', 90);
    assert.notEqual(summed, 90);
    assert.ok(summed > 300);
  });
});

describe('resolveNetworkForecastCoverage', () => {
  it('uses the published curve and ignores a flat turnover daily', () => {
    const row = resolveNetworkForecastCoverage({
      today: '2026-09-28',
      localQty: 0,
      overseasQty: 10,
      inTransitQty: 0,
      forecastDaily: { '2026-09': 1, '2026-10': 10 },
      flatDaily: 23,
    });
    assert.equal(row.stockoutDate, '2026-10-01');
    assert.ok(row.coverageDays != null && row.coverageDays < 10);
    assert.equal(row.onHandTransitCoverageDays, row.coverageDays);
  });

  it('falls back to one turnover daily when no published curve exists', () => {
    const row = resolveNetworkForecastCoverage({
      today: '2026-09-30',
      localQty: 50,
      overseasQty: 117,
      inTransitQty: 150,
      forecastDaily: null,
      flatDaily: 1,
    });
    assert.equal(row.coverageDays, 317);
    assert.equal(row.onHandTransitCoverageDays, 267);
    assert.equal(row.stockoutDate, '2027-08-13');
    assert.equal(row.horizons?.windowCovered, true);
    assert.equal(row.horizons?.urgent45, 0);
    assert.equal(row.horizons?.ship60, 0);
  });

  it('caps empty daily with stock at 9999 days instead of dropping the row', () => {
    const row = resolveNetworkForecastCoverage({
      today: '2026-09-30',
      localQty: 10,
      overseasQty: 80,
      inTransitQty: 0,
      forecastDaily: null,
      flatDaily: null,
    });
    assert.equal(row.coverageDays, 9999);
    assert.equal(row.onHandTransitCoverageDays, 9999);
  });
});

describe('publishedNetworkAvgDaily', () => {
  it('reads the business month from published forecast map', () => {
    const daily = publishedNetworkAvgDaily(
      { map: new Map([['2026-09', 2.5]]), versionId: 'v1' },
      '2026-09-30',
    );
    assert.equal(daily, 2.5);
  });
});
