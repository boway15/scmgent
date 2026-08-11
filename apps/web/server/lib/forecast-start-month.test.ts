import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORECAST_START_MONTH_LOOKBACK,
  buildForecastStartMonthOptions,
  formatForecastStartMonth,
  isForecastStartMonthBacktest,
  parseAndValidateForecastStartMonth,
  resolveBaselineGenerationAsOf,
  resolveForecastStartMonthAsOf,
} from './forecast-start-month.js';

describe('forecast-start-month', () => {
  const now = new Date(Date.UTC(2026, 7, 10)); // 2026-08

  it('formats UTC calendar month as YYYY-MM', () => {
    assert.equal(formatForecastStartMonth(now), '2026-08');
  });

  it('builds current month plus lookback options newest-first', () => {
    assert.equal(FORECAST_START_MONTH_LOOKBACK, 6);
    assert.deepEqual(buildForecastStartMonthOptions(now), [
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-05',
      '2026-04',
      '2026-03',
      '2026-02',
    ]);
  });

  it('defaults empty startMonth to current month', () => {
    const resolved = parseAndValidateForecastStartMonth(undefined, now);
    assert.equal(resolved.startMonth, '2026-08');
    assert.equal(resolved.isBacktest, false);
  });

  it('accepts startMonth within lookback window', () => {
    const resolved = parseAndValidateForecastStartMonth('2026-02', now);
    assert.equal(resolved.startMonth, '2026-02');
    assert.equal(resolved.isBacktest, true);
  });

  it('rejects invalid format and out-of-range months', () => {
    assert.throws(() => parseAndValidateForecastStartMonth('2026-8', now), /YYYY-MM/);
    assert.throws(() => parseAndValidateForecastStartMonth('2026-01', now), /往前/);
    assert.throws(() => parseAndValidateForecastStartMonth('2026-09', now), /往前/);
  });

  it('maps startMonth to UTC first-of-month asOf', () => {
    const asOf = resolveForecastStartMonthAsOf('2026-02');
    assert.equal(asOf.toISOString(), '2026-02-01T00:00:00.000Z');
  });

  it('detects backtest relative to now', () => {
    assert.equal(isForecastStartMonthBacktest('2026-08', now), false);
    assert.equal(isForecastStartMonthBacktest('2026-07', now), true);
  });

  it('resolveBaselineGenerationAsOf prefers startMonth over today', () => {
    const resolved = resolveBaselineGenerationAsOf({
      startMonth: '2026-08',
      today: new Date(Date.UTC(2026, 1, 1)),
    });
    assert.equal(resolved.startMonth, '2026-08');
    assert.equal(resolved.asOf.toISOString(), '2026-08-01T00:00:00.000Z');
  });

  it('resolveBaselineGenerationAsOf coerces ISO today string', () => {
    const resolved = resolveBaselineGenerationAsOf({
      today: '2026-08-01T00:00:00.000Z',
    });
    assert.equal(resolved.startMonth, '2026-08');
    assert.equal(resolved.asOf.toISOString(), '2026-08-01T00:00:00.000Z');
  });
});
