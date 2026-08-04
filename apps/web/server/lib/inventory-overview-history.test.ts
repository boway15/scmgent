import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filterSnapshotItems,
  resolveInventorySnapshotSelection,
} from './inventory-overview-history.js';

describe('inventory overview history', () => {
  const dates = ['2026-07-24', '2026-07-23', '2026-07-21'];

  it('selects today when today has a published snapshot', () => {
    assert.deepEqual(resolveInventorySnapshotSelection(dates, undefined, '2026-07-24'), {
      selectedSnapshotDate: '2026-07-24',
      latestSnapshotDate: '2026-07-24',
      isLatestSnapshot: true,
      isStale: false,
    });
  });

  it('falls back to latest published date and marks it stale', () => {
    assert.deepEqual(resolveInventorySnapshotSelection(dates, undefined, '2026-07-25'), {
      selectedSnapshotDate: '2026-07-24',
      latestSnapshotDate: '2026-07-24',
      isLatestSnapshot: true,
      isStale: true,
    });
  });

  it('rejects a requested date that was not published', () => {
    assert.deepEqual(resolveInventorySnapshotSelection(dates, '2026-07-22', '2026-07-24'), {
      selectedSnapshotDate: null,
      latestSnapshotDate: '2026-07-24',
      isLatestSnapshot: false,
      isStale: false,
    });
  });

  it('filters archived payloads without reading current SKU master', () => {
    const rows = [
      { code: 'A-1', name: '旧名称', category: '家具', salesCountry: 'US' },
      { code: 'B-1', name: '灯具', category: '家居', salesCountry: 'DE' },
    ];
    const result = filterSnapshotItems(rows, {
      q: '旧名称',
      category: '家具',
      salesCountry: 'US',
    });
    assert.deepEqual(result.map((row) => row.code), ['A-1']);
  });
});
