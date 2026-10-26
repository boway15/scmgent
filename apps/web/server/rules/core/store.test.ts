import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createParamsResolver } from './store.js';
import { REPLENISHMENT_PARAMS } from '../replenishment/params.js';

describe('createParamsResolver', () => {
  it('memoizes per scope key and resolves layered values', () => {
    const resolve = createParamsResolver(REPLENISHMENT_PARAMS, [
      { id: 'g', scopeType: 'global', scopeValue: '*', params: { singleCoverDays: 40 }, version: 1 },
      { id: 'w', scopeType: 'warehouse', scopeValue: 'UK', params: { singleCoverDays: 60 }, version: 1 },
    ]);
    const a = resolve({ warehouse: 'UK' });
    const b = resolve({ warehouse: 'UK' });
    assert.equal(a, b);
    assert.equal(a.values.singleCoverDays, 60);
    assert.equal(resolve({ warehouse: 'US-WEST' }).values.singleCoverDays, 40);
  });
});
