import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canSyncNewsArticle } from './bitable-sync.js';

describe('news article Bitable sync gate', () => {
  it('only allows published articles to sync', () => {
    assert.equal(canSyncNewsArticle('published'), true);
    assert.equal(canSyncNewsArticle('pending_review'), false);
    assert.equal(canSyncNewsArticle('ignored'), false);
  });
});
