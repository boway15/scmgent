import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { preferHigherTierSource } from './dedup.js';

describe('ingest pipeline helpers', () => {
  it('keeps lower-tier duplicate when existing is stronger', () => {
    assert.equal(
      preferHigherTierSource({
        incomingTier: 'tier_3',
        incomingOfficial: false,
        existingTier: 'tier_1',
        existingOfficial: true,
      }),
      'keep_existing',
    );
  });
});
