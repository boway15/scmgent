import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateDraftBucketsForWarehouse,
} from '../inventory-position.js';
import {
  buildPoMirrorDraftExternalId,
  createDraftsFromPoMirror,
  createMemoryPoMirrorDraftStore,
} from './create-draft-from-po-mirror.js';
import { SAP_SOURCE_SYSTEM } from './types.js';

describe('buildPoMirrorDraftExternalId', () => {
  it('combines source system, PO id, and line id', () => {
    assert.equal(
      buildPoMirrorDraftExternalId('sap', '4500012345', '00010'),
      'sap:4500012345:00010',
    );
  });
});

describe('createDraftsFromPoMirror', () => {
  const mirror = {
    id: 'mirror-1',
    sourceSystem: SAP_SOURCE_SYSTEM,
    externalId: '4500012345',
    externalVersion: '0001',
    poNumber: 'PO-2026-001',
    lines: [
      {
        id: 'line-1',
        externalLineId: '00010',
        skuId: 'sku-1',
        qty: 100,
        deliveryDate: '2026-08-01',
      },
      {
        id: 'line-2',
        externalLineId: '00020',
        skuId: null,
        qty: 50,
        deliveryDate: null,
      },
    ],
  };

  it('creates drafts for resolved lines and skips unresolved skuId', async () => {
    const store = createMemoryPoMirrorDraftStore({ mirrors: [mirror] });
    const result = await createDraftsFromPoMirror(
      { mirrorId: 'mirror-1', createdBy: 'user-1' },
      store,
    );

    assert.ok(result);
    assert.equal(result.mirrorId, 'mirror-1');
    assert.equal(result.positionExcluded, true);
    assert.equal(result.lines.length, 2);

    const created = result.lines.find((line) => line.action === 'created');
    assert.ok(created && 'draftId' in created);
    assert.equal(store.drafts.length, 1);
    assert.equal(store.drafts[0]?.externalId, 'sap:4500012345:00010');
    assert.equal(store.drafts[0]?.status, 'draft');
    assert.equal(store.drafts[0]?.planItemId, null);

    const skipped = result.lines.find((line) => line.action === 'skipped');
    assert.ok(skipped && 'reason' in skipped);
    assert.match(skipped.reason, /skuId not resolved/i);
  });

  it('returns existing draft on second call (idempotent)', async () => {
    const store = createMemoryPoMirrorDraftStore({ mirrors: [mirror] });
    const first = await createDraftsFromPoMirror(
      { mirrorId: 'mirror-1', createdBy: 'user-1' },
      store,
    );
    const second = await createDraftsFromPoMirror(
      { mirrorId: 'mirror-1', createdBy: 'user-1' },
      store,
    );

    assert.equal(store.drafts.length, 1);
    const firstLine = first!.lines.find((line) => line.lineId === '00010');
    const secondLine = second!.lines.find((line) => line.lineId === '00010');
    assert.equal(firstLine?.action, 'created');
    assert.equal(secondLine?.action, 'existing');
    if (firstLine && 'draftId' in firstLine && secondLine && 'draftId' in secondLine) {
      assert.equal(secondLine.draftId, firstLine.draftId);
    }
  });

  it('returns null when mirror not found', async () => {
    const store = createMemoryPoMirrorDraftStore();
    const result = await createDraftsFromPoMirror(
      { mirrorId: 'missing', createdBy: 'user-1' },
      store,
    );
    assert.equal(result, null);
  });

  it('SAP-linked drafts without warehouse stay out of position buckets', () => {
    const aggregated = aggregateDraftBucketsForWarehouse(
      [
        {
          draftId: 'draft-1',
          status: 'draft',
          openQty: 100,
          warehouseCode: null,
        },
      ],
      'WH-US',
    );
    assert.equal(aggregated.draftBuckets.confirmedOpen, 0);
    assert.equal(aggregated.draftBuckets.inTransit, 0);
    assert.equal(aggregated.draftBuckets.inProduction, 0);
    assert.equal(aggregated.unassignedOpenQty, 100);
  });
});
