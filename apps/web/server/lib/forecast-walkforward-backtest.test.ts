import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWalkForwardVersionName,
  buildWalkForwardMonthTierSummary,
  formatWalkForwardMonthTierSummaryLines,
  parseWalkForwardAsOf,
  resolveWalkForwardVersionName,
} from './forecast-walkforward-backtest.js';
import { buildMonthlyForecastHorizon } from './forecast-baseline.js';
import { formatForecastMonth } from './forecast-demand.js';
import { computeWalkForwardAsOf } from './sales-history-monthly.js';

describe('forecast-walkforward-backtest', () => {
  it('parses asOf date as UTC midnight', () => {
    const asOf = parseWalkForwardAsOf('2025-12-31');
    assert.equal(asOf.toISOString(), '2025-12-31T00:00:00.000Z');
  });

  it('builds version name from asOf and month count', () => {
    const asOf = parseWalkForwardAsOf('2025-12-31');
    assert.equal(buildWalkForwardVersionName(asOf, 6), 'WF-2025-12-31-6M');
  });

  it('appends timestamp when not replacing version', () => {
    const asOf = parseWalkForwardAsOf('2026-01-01');
    const name = resolveWalkForwardVersionName({ asOf, monthCount: 6, replaceVersion: false });
    assert.match(name, /^WF-2026-01-01-6M-\d+$/);
  });

  it('keeps stable name when replacing version', () => {
    const asOf = parseWalkForwardAsOf('2026-01-01');
    const name = resolveWalkForwardVersionName({
      asOf,
      monthCount: 6,
      replaceVersion: true,
    });
    assert.equal(name, 'WF-2026-01-01-6M');
  });

  it('targets Jan-Jun 2026 when asOf is start of Jan 2026 (cutoff = end of Dec 2025)', () => {
    const asOf = parseWalkForwardAsOf('2026-01-01');
    const months = buildMonthlyForecastHorizon(asOf, 6);
    assert.deepEqual(
      months.map((m) => formatForecastMonth(m.forecastYear, m.month)),
      ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
    );
  });

  it('computeWalkForwardAsOf aligns with first target month for 6 completed months', () => {
    const today = new Date(Date.UTC(2026, 6, 3));
    assert.equal(computeWalkForwardAsOf(6, today), '2026-01-01');
  });

  it('buildWalkForwardMonthTierSummary groups by month and tier with mape and wmape', () => {
    const stats = buildWalkForwardMonthTierSummary(
      [
        { forecastYear: 2026, month: 1, profileSegment: 'T1', forecastDaily: 12, actualDaily: 10 },
        { forecastYear: 2026, month: 1, profileSegment: 'T2', forecastDaily: 8, actualDaily: 10 },
        { forecastYear: 2026, month: 2, profileSegment: 'T1', forecastDaily: 5, actualDaily: 5 },
      ],
      [
        { forecastYear: 2026, month: 1, monthLabel: '2026-01' },
        { forecastYear: 2026, month: 2, monthLabel: '2026-02' },
      ],
    );
    assert.equal(stats.length, 3);
    const t1Jan = stats.find((row) => row.monthLabel === '2026-01' && row.profileSegment === 'T1');
    assert.ok(t1Jan);
    assert.equal(t1Jan.comparableRows, 1);
    assert.equal(t1Jan.mape, 0.2);
    assert.equal(t1Jan.wmape, 0.2);
    const lines = formatWalkForwardMonthTierSummaryLines(
      [
        { forecastYear: 2026, month: 1, profileSegment: 'T1', forecastDaily: 12, actualDaily: 10 },
      ],
      [{ forecastYear: 2026, month: 1, monthLabel: '2026-01' }],
    );
    assert.ok(lines.some((l) => l.includes('WMAPE')));
  });
});
