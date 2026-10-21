import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pendingSkuIdsToExpire } from './suggestion-expiry.js';

describe('pendingSkuIdsToExpire', () => {
  it('expires processed SKUs that are not kept this run', () => {
    assert.deepEqual(
      pendingSkuIdsToExpire({
        processedSkuIds: ['a', 'b', 'c', 'a'],
        keptSkuIds: ['b'],
      }),
      ['a', 'c'],
    );
  });

  it('keeps every SKU that still receives a suggestion', () => {
    assert.deepEqual(
      pendingSkuIdsToExpire({
        processedSkuIds: ['a', 'b'],
        keptSkuIds: ['a', 'b'],
      }),
      [],
    );
  });
});
