import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FORECAST_HORIZON_MONTHS, MAX_FORECAST_MONTH_COUNT } from './forecast-limits.js';

describe('forecast horizon lock', () => {
  it('locks generation horizon to 6 months', () => {
    assert.equal(FORECAST_HORIZON_MONTHS, 6);
    assert.equal(MAX_FORECAST_MONTH_COUNT, 6);
  });
});
