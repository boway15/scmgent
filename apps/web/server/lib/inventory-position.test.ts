import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateDraftBucketsForWarehouse,
  buildInventoryPositionMetrics,
  effectiveQtyWithProductionFallback,
  mapDraftStatusToBucket,
  mergeInventoryPosition,
  normalizeSnapshotForWarehouse,
  openDraftQty,
} from './inventory-position.js';

describe('inventory-position pure', () => {
  it('maps draft statuses to buckets', () => {
    assert.equal(mapDraftStatusToBucket('draft'), 'confirmedOpen');
    assert.equal(mapDraftStatusToBucket('confirmed'), 'confirmedOpen');
    assert.equal(mapDraftStatusToBucket('in_production'), 'inProduction');
    assert.equal(mapDraftStatusToBucket('ready_to_ship'), 'inProduction');
    assert.equal(mapDraftStatusToBucket('in_transit'), 'inTransit');
    assert.equal(mapDraftStatusToBucket('partial_received'), 'inTransit');
    assert.equal(mapDraftStatusToBucket('exception'), 'confirmedOpen');
    assert.equal(mapDraftStatusToBucket('received'), null);
    assert.equal(mapDraftStatusToBucket('cancelled'), null);
  });

  it('computes open qty', () => {
    assert.equal(openDraftQty(100, 30), 70);
    assert.equal(openDraftQty(10, 15), 0);
  });

  it('zeros in-production snapshot quantity for a physical warehouse', () => {
    const snapshot = normalizeSnapshotForWarehouse(
      {
        qtyAvailable: 100,
        qtyInTransit: 20,
        qtyInProduction: 75,
        qtyReserved: 10,
      },
      'US-WEST',
    );

    assert.deepEqual(snapshot, {
      qtyAvailable: 100,
      qtyInTransit: 20,
      qtyInProduction: 0,
      qtyReserved: 10,
    });
  });

  it('aggregates draft lines for one warehouse and tracks unassigned', () => {
    const { draftBuckets, sources, unassignedOpenQty } = aggregateDraftBucketsForWarehouse(
      [
        { draftId: 'a', status: 'submitted', openQty: 100, warehouseCode: 'US-WEST' },
        { draftId: 'b', status: 'in_transit', openQty: 50, warehouseCode: 'US-WEST' },
        { draftId: 'c', status: 'in_production', openQty: 20, warehouseCode: null },
        { draftId: 'd', status: 'exception', openQty: 5, warehouseCode: 'US-WEST' },
        { draftId: 'e', status: 'confirmed', openQty: 30, warehouseCode: 'US-EAST' },
      ],
      'US-WEST',
    );

    assert.deepEqual(draftBuckets, {
      confirmedOpen: 105,
      inTransit: 50,
      inProduction: 0,
    });
    assert.equal(unassignedOpenQty, 20);
    assert.equal(sources.length, 3);
    assert.ok(sources.some((source) => source.draftId === 'd' && source.atRisk === true));
  });

  it('drafts_fill_gap only fills zero snapshot buckets', () => {
    const result = mergeInventoryPosition({
      dedupeMode: 'drafts_fill_gap',
      snapshot: {
        qtyAvailable: 2400,
        qtyInTransit: 1000,
        qtyInProduction: 0,
        qtyReserved: 100,
      },
      draftBuckets: {
        inProduction: 500,
        inTransit: 2000,
        confirmedOpen: 300,
      },
      sources: [
        { source: 'snapshot', bucket: 'inTransit', qty: 1000 },
        {
          source: 'purchase_draft',
          bucket: 'inProduction',
          qty: 500,
          draftId: 'production-draft',
        },
        {
          source: 'purchase_draft',
          bucket: 'inTransit',
          qty: 2000,
          draftId: 'transit-draft',
        },
        {
          source: 'purchase_draft',
          bucket: 'confirmedOpen',
          qty: 300,
          draftId: 'confirmed-draft',
        },
      ],
    });
    assert.equal(result.qtyAvailable, 2400);
    assert.equal(result.qtyInTransit, 1000); // snapshot wins
    assert.equal(result.qtyInProduction, 500); // fill gap
    assert.equal(result.qtyConfirmedOpen, 300);
    assert.equal(result.qtyReserved, 100);
    assert.equal(result.effectiveQty, 2400 + 1000 + 500 + 300 - 100);
    assert.equal(result.dedupeMode, 'drafts_fill_gap');
    assert.deepEqual(
      result.sources.map(({ bucket, qty, draftId }) => ({ bucket, qty, draftId })),
      [
        { bucket: 'inTransit', qty: 1000, draftId: undefined },
        { bucket: 'inProduction', qty: 500, draftId: 'production-draft' },
        { bucket: 'confirmedOpen', qty: 300, draftId: 'confirmed-draft' },
      ],
    );
    assert.deepEqual(buildInventoryPositionMetrics(result).inventoryPosition.sources, result.sources);
  });

  it('does not imply a snapshot-winning draft in-transit quantity was counted', () => {
    const result = mergeInventoryPosition({
      dedupeMode: 'drafts_fill_gap',
      snapshot: {
        qtyAvailable: 0,
        qtyInTransit: 100,
        qtyInProduction: 0,
        qtyReserved: 0,
      },
      draftBuckets: {
        inProduction: 0,
        inTransit: 2000,
        confirmedOpen: 0,
      },
      sources: [
        { source: 'snapshot', bucket: 'inTransit', qty: 100 },
        {
          source: 'purchase_draft',
          bucket: 'inTransit',
          qty: 2000,
          draftId: 'draft-in-transit',
        },
      ],
    });

    assert.equal(result.qtyInTransit, 100);
    assert.equal(result.effectiveQty, 100);
    assert.deepEqual(result.sources, [{ source: 'snapshot', bucket: 'inTransit', qty: 100 }]);
  });

  it('snapshot_only ignores drafts', () => {
    const result = mergeInventoryPosition({
      dedupeMode: 'snapshot_only',
      snapshot: {
        qtyAvailable: 100,
        qtyInTransit: 0,
        qtyInProduction: 0,
        qtyReserved: 0,
      },
      draftBuckets: { inProduction: 50, inTransit: 20, confirmedOpen: 10 },
    });
    assert.equal(result.effectiveQty, 100);
    assert.equal(result.qtyConfirmedOpen, 0);
  });

  it('sum_both adds drafts on top of snapshot', () => {
    const result = mergeInventoryPosition({
      dedupeMode: 'sum_both',
      snapshot: {
        qtyAvailable: 100,
        qtyInTransit: 10,
        qtyInProduction: 5,
        qtyReserved: 0,
      },
      draftBuckets: { inProduction: 50, inTransit: 20, confirmedOpen: 10 },
    });
    assert.equal(result.qtyInProduction, 55);
    assert.equal(result.qtyInTransit, 30);
    assert.equal(result.qtyConfirmedOpen, 10);
    assert.equal(result.effectiveQty, 100 + 55 + 30 + 10);
  });

  it('fills region production once only when warehouse positions contain none', () => {
    assert.equal(
      effectiveQtyWithProductionFallback(
        [
          { effectiveQty: 100, qtyInProduction: 0 },
          { effectiveQty: 50, qtyInProduction: 0 },
        ],
        25,
      ),
      175,
    );
    assert.equal(
      effectiveQtyWithProductionFallback(
        [
          { effectiveQty: 120, qtyInProduction: 20 },
          { effectiveQty: 50, qtyInProduction: 0 },
        ],
        25,
      ),
      170,
    );
  });
});
