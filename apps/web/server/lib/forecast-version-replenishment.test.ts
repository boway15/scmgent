import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FORECAST_BACKTEST_REPLENISHMENT_BLOCKED_MESSAGE,
  assertForecastVersionEligibleForReplenishment,
  isForecastVersionBacktestForReplenishment,
} from './forecast-version.js';

describe('forecast version replenishment eligibility', () => {
  it('treats missing startMonth as non-backtest', () => {
    assert.equal(isForecastVersionBacktestForReplenishment(null, new Date('2026-11-15T00:00:00Z')), false);
    assert.equal(isForecastVersionBacktestForReplenishment(undefined, new Date('2026-11-15T00:00:00Z')), false);
    assert.equal(isForecastVersionBacktestForReplenishment('  ', new Date('2026-11-15T00:00:00Z')), false);
  });

  it('blocks startMonth earlier than current month', () => {
    const now = new Date('2026-11-15T00:00:00Z');
    assert.equal(isForecastVersionBacktestForReplenishment('2026-11', now), false);
    assert.equal(isForecastVersionBacktestForReplenishment('2026-10', now), true);
    assert.throws(
      () => assertForecastVersionEligibleForReplenishment('2026-07', now),
      (err: unknown) =>
        err instanceof Error &&
        err.message === FORECAST_BACKTEST_REPLENISHMENT_BLOCKED_MESSAGE &&
        (err as { status?: number }).status === 400,
    );
  });
});
