import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertForecastWriteAllowed,
  isForecastResetInProgress,
} from './forecast-reset.js';

describe('forecast-reset guard', () => {
  it('is not in progress by default', () => {
    assert.equal(isForecastResetInProgress(), false);
    assert.doesNotThrow(() => assertForecastWriteAllowed());
  });
});
