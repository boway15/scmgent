import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { preferHigherTierSource } from './dedup.js';
import {
  buildNewsDiscoveryMetadata,
  decideCandidateDisposition,
  hasNewsIngestStageBudget,
  isCompletedSuccessfulIngestTaskRunToday,
  isNewsIngestDeadlineExceeded,
  isPublishedPendingSync,
  resolveIngestItemLimit,
  shouldContinueNewsIngest,
  tryAcquireNewsIngestLock,
} from './ingest-pipeline.js';

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

  it('discards only hard filter reasons', () => {
    for (const filterReason of [
      'outside_lookback_window',
      'negative_keyword',
      'source_exclude_keyword',
      'source_include_keyword_miss',
    ]) {
      assert.equal(
        decideCandidateDisposition({ filterReason, relevanceScore: 100 }),
        'discard',
      );
    }
  });

  it('keeps soft filter reasons for review', () => {
    for (const filterReason of [
      'non_official_english',
      'no_business_anchor',
      'excluded_region',
    ]) {
      assert.equal(
        decideCandidateDisposition({ filterReason, relevanceScore: 5 }),
        'pending_review',
      );
    }
  });

  it('keeps low-scoring candidates for review', () => {
    assert.equal(
      decideCandidateDisposition({ filterReason: 'ok', relevanceScore: 0 }),
      'pending_review',
    );
  });

  it('uses the per-query limit only for query feeds', () => {
    assert.equal(
      resolveIngestItemLimit({
        sourceType: 'query_feed',
        maxItemsPerQuery: 7,
        maxItemsPerSource: 20,
      }),
      7,
    );
    assert.equal(
      resolveIngestItemLimit({
        sourceType: 'rss',
        maxItemsPerQuery: 7,
        maxItemsPerSource: 20,
      }),
      20,
    );
  });

  it('builds query-feed discovery metadata and marks Google as aggregator-only', () => {
    assert.deepEqual(
      buildNewsDiscoveryMetadata({
        sourceType: 'query_feed',
        isOfficial: false,
        canonicalUrl: 'https://news.google.com/rss/articles/example',
        discoveryQuery: 'Amazon seller policy',
        sourceUrl: 'https://sellercentral.amazon.com/',
      }),
      {
        discoveryChannel: 'query_feed',
        discoveryQuery: 'Amazon seller policy',
        sourceDomain: 'sellercentral.amazon.com',
        aggregatorOnly: true,
      },
    );
  });

  it('rejects a concurrent ingest lock and releases after completion', () => {
    const release = tryAcquireNewsIngestLock();
    assert.ok(release);
    assert.equal(tryAcquireNewsIngestLock(), null);
    release();

    const reacquired = tryAcquireNewsIngestLock();
    assert.ok(reacquired);
    reacquired();
  });

  it('stops accepting work when the run deadline is reached', () => {
    assert.equal(isNewsIngestDeadlineExceeded(10_000, 9_999), false);
    assert.equal(isNewsIngestDeadlineExceeded(10_000, 10_000), true);
    assert.equal(shouldContinueNewsIngest(10_000, 9_999), true);
    assert.equal(shouldContinueNewsIngest(10_000, 10_000), false);
    assert.equal(hasNewsIngestStageBudget(10_000, 2_000, 7_999), true);
    assert.equal(hasNewsIngestStageBudget(10_000, 2_000, 8_000), false);
  });

  it('counts only completed successful news_ingest task runs from today in Shanghai', () => {
    const now = new Date('2026-07-27T08:00:00.000Z');
    const todayStart = new Date('2026-07-26T16:01:00.000Z');
    const todayFinish = new Date('2026-07-27T07:59:00.000Z');
    const base = {
      taskName: 'news_ingest',
      status: 'success',
      startedAt: todayStart,
      finishedAt: todayFinish,
    };

    assert.equal(isCompletedSuccessfulIngestTaskRunToday(base, now), true);
    assert.equal(
      isCompletedSuccessfulIngestTaskRunToday({ ...base, taskName: 'other_task' }, now),
      false,
    );
    assert.equal(
      isCompletedSuccessfulIngestTaskRunToday({ ...base, status: 'running', finishedAt: null }, now),
      false,
    );
    assert.equal(
      isCompletedSuccessfulIngestTaskRunToday({
        ...base,
        startedAt: new Date('2026-07-26T15:59:59.000Z'),
      }, now),
      false,
    );
    assert.equal(
      isCompletedSuccessfulIngestTaskRunToday({
        ...base,
        finishedAt: new Date('2026-07-27T16:00:00.000Z'),
      }, now),
      false,
    );
  });

  it('counts pending sync only for published pending or failed articles', () => {
    assert.equal(
      isPublishedPendingSync({ status: 'published', bitableSyncStatus: 'pending' }),
      true,
    );
    assert.equal(
      isPublishedPendingSync({ status: 'published', bitableSyncStatus: 'failed' }),
      true,
    );
    assert.equal(
      isPublishedPendingSync({ status: 'pending_review', bitableSyncStatus: 'pending' }),
      false,
    );
    assert.equal(
      isPublishedPendingSync({ status: 'ignored', bitableSyncStatus: 'failed' }),
      false,
    );
    assert.equal(
      isPublishedPendingSync({ status: 'published', bitableSyncStatus: 'synced' }),
      false,
    );
  });
});
