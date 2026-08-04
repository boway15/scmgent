import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldShowNewsSyncRetry } from './NewsIntelPage.js';

describe('shouldShowNewsSyncRetry', () => {
  it('shows retry only for published articles with pending or failed sync', () => {
    assert.equal(
      shouldShowNewsSyncRetry({ status: 'published', bitableSyncStatus: 'pending' }),
      true,
    );
    assert.equal(
      shouldShowNewsSyncRetry({ status: 'published', bitableSyncStatus: 'failed' }),
      true,
    );
    assert.equal(
      shouldShowNewsSyncRetry({ status: 'pending_review', bitableSyncStatus: 'pending' }),
      false,
    );
    assert.equal(
      shouldShowNewsSyncRetry({ status: 'ignored', bitableSyncStatus: 'failed' }),
      false,
    );
    assert.equal(
      shouldShowNewsSyncRetry({ status: 'published', bitableSyncStatus: 'synced' }),
      false,
    );
  });
});
