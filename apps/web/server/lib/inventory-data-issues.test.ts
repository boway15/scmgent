import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectInventoryDataIssues,
  planDataIssueUpsert,
  type DataIssueLot,
  type DataIssueSku,
} from './inventory-data-issues.js';
import { parseSharesFromSnapshot } from './inventory-share-allocation.js';

const skuA = '11111111-1111-1111-1111-111111111111';
const skuB = '22222222-2222-2222-2222-222222222222';

function lot(partial: Partial<DataIssueLot> & Pick<DataIssueLot, 'skuId'>): DataIssueLot {
  return {
    warehouseCode: 'US-WEST',
    pool: 'in_transit',
    qty: 80,
    status: 'open',
    dateUnknown: true,
    availableAt: null,
    source: 'snapshot',
    sourceId: 'transit:sku:US-WEST:undated',
    ...partial,
  };
}

function sku(partial: Partial<DataIssueSku> & Pick<DataIssueSku, 'skuId' | 'skuCode'>): DataIssueSku {
  return {
    overseasAvailable: 100,
    share: parseSharesFromSnapshot({}),
    ...partial,
  };
}

describe('detectInventoryDataIssues', () => {
  it('flags open lots with unknown available date as missing_available_at', () => {
    const issues = detectInventoryDataIssues({
      lots: [lot({ skuId: skuA, qty: 80 })],
      skus: [],
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.issueType, 'missing_available_at');
    assert.equal(issues[0]?.impactModule, 'timeline');
    assert.equal(issues[0]?.qty, 80);
    assert.equal(issues[0]?.warehouseCode, 'US-WEST');
    assert.equal(
      issues[0]?.fingerprint,
      `missing_available_at:${skuA}:US-WEST:snapshot:transit:sku:US-WEST:undated`,
    );
    assert.match(issues[0]?.example ?? '', /不进时间轴/);
  });

  it('skips consumed, cancelled, zero-qty, and dated lots', () => {
    const issues = detectInventoryDataIssues({
      lots: [
        lot({ skuId: skuA, status: 'consumed' }),
        lot({ skuId: skuA, status: 'cancelled', sourceId: 'c1' }),
        lot({ skuId: skuA, qty: 0, sourceId: 'z1' }),
        lot({
          skuId: skuA,
          dateUnknown: false,
          availableAt: '2026-10-01',
          sourceId: 'dated',
        }),
      ],
      skus: [],
    });
    assert.equal(issues.length, 0);
  });

  it('treats empty availableAt as missing even when dateUnknown is false', () => {
    const issues = detectInventoryDataIssues({
      lots: [
        lot({
          skuId: skuA,
          dateUnknown: false,
          availableAt: null,
          sourceId: 'blank-date',
        }),
      ],
      skus: [],
    });
    assert.equal(issues[0]?.issueType, 'missing_available_at');
    assert.equal(issues[0]?.fingerprint, `missing_available_at:${skuA}:US-WEST:snapshot:blank-date`);
  });

  it('flags overseas stock without sales share as unallocated_warehouse', () => {
    const issues = detectInventoryDataIssues({
      lots: [],
      skus: [sku({ skuId: skuA, skuCode: 'US-AIR-01', overseasAvailable: 420 })],
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.issueType, 'unallocated_warehouse');
    assert.equal(issues[0]?.impactModule, 'horizon');
    assert.equal(issues[0]?.warehouseCode, 'OVERSEAS');
    assert.equal(issues[0]?.qty, 420);
    assert.equal(issues[0]?.fingerprint, `unallocated_warehouse:${skuA}:OVERSEAS`);
    assert.match(issues[0]?.example ?? '', /7\/15\/30/);
  });

  it('does not flag unallocated when overseas available is 0', () => {
    const issues = detectInventoryDataIssues({
      lots: [],
      skus: [sku({ skuId: skuA, skuCode: 'US-AIR-01', overseasAvailable: 0 })],
    });
    assert.equal(issues.length, 0);
  });

  it('flags share sum warning as share_sum_mismatch', () => {
    const share = parseSharesFromSnapshot({ 美西: '0.6', 美东: '0.2' });
    assert.equal(share.shareSumWarning, true);
    const issues = detectInventoryDataIssues({
      lots: [],
      skus: [
        sku({
          skuId: skuB,
          skuCode: 'US-HOME-03',
          overseasAvailable: 200,
          share,
        }),
      ],
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.issueType, 'share_sum_mismatch');
    assert.equal(issues[0]?.impactModule, 'planning');
    assert.equal(issues[0]?.fingerprint, `share_sum_mismatch:${skuB}:OVERSEAS`);
    assert.match(issues[0]?.example ?? '', /相对权重/);
  });

  it('does not emit share mismatch for a balanced sales share', () => {
    const share = parseSharesFromSnapshot({ 美西: '0.6', 美东: '0.4' });
    assert.equal(share.method, 'sales_share');
    assert.equal(share.shareSumWarning, false);
    const issues = detectInventoryDataIssues({
      lots: [],
      skus: [sku({ skuId: skuB, skuCode: 'US-HOME-03', share, overseasAvailable: 200 })],
    });
    assert.equal(issues.length, 0);
  });

  it('can emit a missing-date lot and an unallocated sku together', () => {
    const issues = detectInventoryDataIssues({
      lots: [lot({ skuId: skuA, warehouseCode: 'OVERSEAS', pool: 'local', sourceId: 'local-1' })],
      skus: [sku({ skuId: skuA, skuCode: 'US-AIR-01', overseasAvailable: 50 })],
    });
    const types = issues.map((row) => row.issueType).sort();
    assert.deepEqual(types, ['missing_available_at', 'unallocated_warehouse']);
  });

  it('uses none when lot sourceId is empty', () => {
    const issues = detectInventoryDataIssues({
      lots: [lot({ skuId: skuA, sourceId: null })],
      skus: [],
    });
    assert.equal(issues[0]?.fingerprint, `missing_available_at:${skuA}:US-WEST:snapshot:none`);
  });
});

describe('planDataIssueUpsert', () => {
  const candidate = {
    fingerprint: `unallocated_warehouse:${skuA}:OVERSEAS`,
    skuId: skuA,
    warehouseCode: 'OVERSEAS',
    issueType: 'unallocated_warehouse' as const,
    impactModule: 'horizon' as const,
    example: '飞书无销售占比',
    qty: 10,
  };

  it('inserts newly detected fingerprints', () => {
    const plan = planDataIssueUpsert({ existing: [], detected: [candidate] });
    assert.deepEqual(plan.insert, [candidate]);
    assert.equal(plan.refresh.length, 0);
    assert.equal(plan.autoResolve.length, 0);
  });

  it('refreshes open issues still detected', () => {
    const plan = planDataIssueUpsert({
      existing: [{ id: 'e1', fingerprint: candidate.fingerprint, status: 'open' }],
      detected: [candidate],
    });
    assert.equal(plan.insert.length, 0);
    assert.deepEqual(plan.refresh, [{ id: 'e1', candidate }]);
  });

  it('does not reopen dismissed fingerprints', () => {
    const plan = planDataIssueUpsert({
      existing: [{ id: 'e1', fingerprint: candidate.fingerprint, status: 'dismissed' }],
      detected: [candidate],
    });
    assert.equal(plan.insert.length, 0);
    assert.equal(plan.refresh.length, 0);
    assert.equal(plan.autoResolve.length, 0);
  });

  it('auto-resolves open issues that disappeared', () => {
    const plan = planDataIssueUpsert({
      existing: [{ id: 'e1', fingerprint: candidate.fingerprint, status: 'in_progress' }],
      detected: [],
    });
    assert.deepEqual(plan.autoResolve, [{ id: 'e1' }]);
  });

  it('reopens a previously resolved fingerprint as a new insert', () => {
    const plan = planDataIssueUpsert({
      existing: [{ id: 'e1', fingerprint: candidate.fingerprint, status: 'resolved' }],
      detected: [candidate],
    });
    assert.deepEqual(plan.insert, [candidate]);
    assert.equal(plan.refresh.length, 0);
  });
});
