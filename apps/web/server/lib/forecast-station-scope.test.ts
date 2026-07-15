import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORECAST_GLOBAL_STATION,
  normalizeForecastStation,
  resolveBaselineGenerateStations,
  resolveForecastGenerationStation,
} from './forecast-station-scope.js';

describe('forecast-station-scope', () => {
  it('normalizes empty or ALL to global station', () => {
    assert.equal(normalizeForecastStation(), FORECAST_GLOBAL_STATION);
    assert.equal(normalizeForecastStation('ALL'), FORECAST_GLOBAL_STATION);
    assert.equal(normalizeForecastStation('  all  '), FORECAST_GLOBAL_STATION);
  });

  it('always generates a single global station', () => {
    assert.deepEqual(resolveBaselineGenerateStations(), [FORECAST_GLOBAL_STATION]);
    assert.equal(resolveForecastGenerationStation('US'), FORECAST_GLOBAL_STATION);
  });
});
