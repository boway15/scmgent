import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mapDraftStatusToBucket,
  mergeInventoryPosition,
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
    });
    assert.equal(result.qtyAvailable, 2400);
    assert.equal(result.qtyInTransit, 1000); // snapshot wins
    assert.equal(result.qtyInProduction, 500); // fill gap
    assert.equal(result.qtyConfirmedOpen, 300);
    assert.equal(result.qtyReserved, 100);
    assert.equal(result.effectiveQty, 2400 + 1000 + 500 + 300 - 100);
    assert.equal(result.dedupeMode, 'drafts_fill_gap');
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
});
