import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickModeChampionVersionId } from './demand-plan-champion.js';

describe('demand-plan-champion', () => {
  it('picks mode version id and counts missing', () => {
    const result = pickModeChampionVersionId(['a', 'b', 'a', null, 'a', 'b']);
    assert.equal(result.defaultVersionId, 'a');
    assert.equal(result.skuWithoutForecastCount, 1);
    assert.equal(result.versionCounts.a, 3);
    assert.equal(result.versionCounts.b, 2);
  });
});
