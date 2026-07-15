import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isForecastWriteRoleCode,
} from './rbac.js';

describe('forecast write permissions', () => {
  it('allows only forecast write role codes to write forecast data', () => {
    assert.equal(isForecastWriteRoleCode('super_admin'), true);
    assert.equal(isForecastWriteRoleCode('viewer'), false);
    assert.equal(isForecastWriteRoleCode('pmc_planner'), false);
    assert.equal(isForecastWriteRoleCode('purchaser'), false);
    assert.equal(isForecastWriteRoleCode('warehouse'), false);
  });
});
