import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  coverageAlongForecast,
  publishedNetworkAvgDaily,
  resolveNetworkForecastCoverage,
  sumForecastDemand,
} from './alert-network-coverage.js';

describe('sumForecastDemand far horizon', () => {
  it('applies the A class buffer only when a profile class is supplied', () => {
    const forecast = new Map<string, number>([['2027-01', 10]]);
    assert.equal(sumForecastDemand(forecast, '2027-01-01', 31), 310);
    assert.equal(
      sumForecastDemand(forecast, '2027-01-01', 31, {
        profileClass: 'A',
        asOf: new Date('2026-10-01T00:00:00.000Z'),
      }),
      341,
    );
  });
});

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

  it('keeps consuming after the forecast horizon using the last three positive months', () => {
    const forecast = new Map<string, number>([
      ['2026-10', 10],
      ['2026-11', 10],
      ['2026-12', 10],
      ['2027-01', 10],
      ['2027-02', 10],
      ['2027-03', 10],
    ]);
    const sixMonths = coverageAlongForecast({
      qty: 1800,
      startYmd: '2026-10-21',
      forecast,
    });
    assert.ok(sixMonths.coverageDays != null && Math.abs(sixMonths.coverageDays - 180) < 1e-6);
    assert.equal(sixMonths.stockoutDate, '2027-04-19');

    const longer = coverageAlongForecast({
      qty: 3000,
      startYmd: '2026-10-21',
      forecast,
    });
    assert.ok(longer.coverageDays != null && Math.abs(longer.coverageDays - 300) < 1e-6);
    assert.ok(longer.stockoutDate != null && longer.stockoutDate < '2027-09-01');
  });

  it('does not stretch an expired forecast into the next same month', () => {
    const walked = coverageAlongForecast({
      qty: 1800,
      startYmd: '2026-10-21',
      forecast: new Map([['2026-09', 10]]),
    });
    assert.ok(walked.coverageDays != null && walked.coverageDays < 365);
    assert.ok(Math.abs(walked.coverageDays - 180) < 1e-6);
  });

  it('sums days past the horizon with the same fallback daily', () => {
    const summed = sumForecastDemand(
      new Map([
        ['2027-01', 10],
        ['2027-02', 10],
        ['2027-03', 10],
      ]),
      '2027-03-01',
      60,
    );
    assert.equal(summed, 600);
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
  it('sizes the order gap to the requested cover window', () => {
    const row = resolveNetworkForecastCoverage({
      today: '2026-10-21',
      localQty: 0,
      overseasQty: 0,
      inTransitQty: 0,
      forecastDaily: { '2026-10': 10, '2026-11': 10, '2026-12': 10 },
      flatDaily: null,
      coverDays: 30,
    });
    assert.equal(row.horizons?.demandCover, 300);
    assert.equal(row.horizons?.gapCover, 300);
    assert.ok((row.horizons?.demand150 ?? 0) > 300);
  });

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
