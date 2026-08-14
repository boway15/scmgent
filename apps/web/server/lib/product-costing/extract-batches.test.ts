import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hasActiveExtractRun,
  isStaleExtractRun,
  planExtractBatches,
  selectPagesInRange,
} from './extract-runner.js';

describe('planExtractBatches', () => {
  it('defaults invalid batch sizes to one page per batch', () => {
    assert.deepEqual(planExtractBatches([1, 2, 3], 0), [[1], [2], [3]]);
    assert.deepEqual(planExtractBatches([1, 2], Number.NaN), [[1], [2]]);
  });

  it('keeps page order while grouping by batch size', () => {
    assert.deepEqual(planExtractBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });
});

describe('hasActiveExtractRun', () => {
  it('blocks extracting projects and pending or running runs', () => {
    assert.equal(hasActiveExtractRun('extracting', []), true);
    assert.equal(hasActiveExtractRun('draft', [{ status: 'pending' }]), true);
    assert.equal(hasActiveExtractRun('ready', [{ status: 'running' }]), true);
  });

  it('allows a new run when no extraction is active', () => {
    assert.equal(hasActiveExtractRun('ready', []), false);
    assert.equal(hasActiveExtractRun('extract_failed', [{ status: 'failed' }]), false);
  });
});

describe('selectPagesInRange', () => {
  const pages = Array.from({ length: 25 }, (_, index) => ({ pageNo: index + 1 }));

  it('applies the requested range before enforcing the 20-page limit', () => {
    assert.deepEqual(
      selectPagesInRange(pages, { pageFrom: 6, pageTo: 25 }).map((page) => page.pageNo),
      Array.from({ length: 20 }, (_, index) => index + 6),
    );
  });

  it('rejects more than 20 pages after range filtering', () => {
    assert.throws(() => selectPagesInRange(pages, {}), /超过 20 页/);
  });
});

describe('isStaleExtractRun', () => {
  it('treats pending and running runs without recent heartbeat as stale', () => {
    const now = new Date('2026-08-13T12:30:00.000Z');
    assert.equal(
      isStaleExtractRun(
        {
          status: 'running',
          startedAt: new Date('2026-08-13T12:14:59.000Z'),
          createdAt: new Date('2026-08-13T12:00:00.000Z'),
        },
        now,
      ),
      true,
    );
    assert.equal(
      isStaleExtractRun(
        {
          status: 'pending',
          startedAt: null,
          createdAt: new Date('2026-08-13T12:20:00.000Z'),
        },
        now,
      ),
      false,
    );
    assert.equal(
      isStaleExtractRun(
        {
          status: 'succeeded',
          startedAt: new Date('2026-08-13T11:00:00.000Z'),
          createdAt: new Date('2026-08-13T11:00:00.000Z'),
        },
        now,
      ),
      false,
    );
  });

  it('keeps long-running jobs alive when heartbeat is recent', () => {
    const now = new Date('2026-08-13T12:30:00.000Z');
    assert.equal(
      isStaleExtractRun(
        {
          status: 'running',
          startedAt: new Date('2026-08-13T11:00:00.000Z'),
          createdAt: new Date('2026-08-13T11:00:00.000Z'),
          rawResponse: {
            batchCurrent: 8,
            batchTotal: 10,
            lastHeartbeatAt: '2026-08-13T12:28:00.000Z',
          },
        },
        now,
      ),
      false,
    );
  });

  it('marks a run stale when heartbeat is older than 15 minutes', () => {
    const now = new Date('2026-08-13T12:30:00.000Z');
    assert.equal(
      isStaleExtractRun(
        {
          status: 'running',
          startedAt: new Date('2026-08-13T11:00:00.000Z'),
          createdAt: new Date('2026-08-13T11:00:00.000Z'),
          rawResponse: {
            batchCurrent: 8,
            batchTotal: 10,
            lastHeartbeatAt: '2026-08-13T12:14:00.000Z',
          },
        },
        now,
      ),
      true,
    );
  });
});
