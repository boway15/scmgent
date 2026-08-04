import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildReviewPatch } from './article-review.js';

describe('buildReviewPatch', () => {
  const now = new Date('2026-07-27T06:30:00.000Z');

  it('sets review metadata and resets Bitable sync when publishing', () => {
    assert.deepEqual(buildReviewPatch('published', 'user-1', now), {
      status: 'published',
      reviewedAt: now,
      reviewedBy: 'user-1',
      bitableSyncStatus: 'pending',
      bitableSyncError: null,
    });
  });

  it('sets review metadata when ignoring', () => {
    assert.deepEqual(buildReviewPatch('ignored', 'user-1', now), {
      status: 'ignored',
      reviewedAt: now,
      reviewedBy: 'user-1',
    });
  });

  it('clears review metadata when restoring pending review', () => {
    assert.deepEqual(buildReviewPatch('pending_review', 'user-1', now), {
      status: 'pending_review',
      reviewedAt: null,
      reviewedBy: null,
    });
  });

  it('rejects unsupported statuses', () => {
    assert.throws(
      () => buildReviewPatch('archived', 'user-1', now),
      /Invalid article review status/,
    );
  });
});
