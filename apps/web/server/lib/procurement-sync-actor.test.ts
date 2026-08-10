import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProcurementSyncActorId } from './procurement-sync-actor.js';

describe('resolveProcurementSyncActorId', () => {
  it('maps cron sentinel and empty values to null for uuid columns', () => {
    assert.equal(resolveProcurementSyncActorId('cron'), null);
    assert.equal(resolveProcurementSyncActorId(undefined), null);
    assert.equal(resolveProcurementSyncActorId(null), null);
    assert.equal(resolveProcurementSyncActorId(''), null);
    assert.equal(resolveProcurementSyncActorId('  '), null);
  });

  it('keeps real user uuids', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    assert.equal(resolveProcurementSyncActorId(userId), userId);
  });
});
