import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSharesFromSnapshot } from './inventory-share-allocation.js';
import {
  resolveReservedQty,
  shouldBackfillNativeAvailable,
} from './inventory-timeline-service.js';

describe('resolveReservedQty', () => {
  it('uses native warehouse reserved when present', () => {
    const share = parseSharesFromSnapshot({ 美西: '0.6', 美东: '0.4' });
    assert.equal(
      resolveReservedQty({
        warehouseReserved: 5,
        overseasReserved: 10,
        share,
        planningWarehouse: 'US-WEST',
      }),
      5,
    );
  });

  it('splits OVERSEAS reserved by sales share when native reserved is 0', () => {
    const share = parseSharesFromSnapshot({ 美西: '0.6', 美东: '0.4' });
    assert.equal(
      resolveReservedQty({
        warehouseReserved: 0,
        overseasReserved: 10,
        share,
        planningWarehouse: 'US-WEST',
      }),
      6,
    );
  });

  it('does not assign OVERSEAS reserved to a destination warehouse when unallocated', () => {
    const share = parseSharesFromSnapshot({});
    assert.equal(
      resolveReservedQty({
        warehouseReserved: 0,
        overseasReserved: 10,
        share,
        planningWarehouse: 'US-WEST',
      }),
      0,
    );
  });
});

describe('shouldBackfillNativeAvailable', () => {
  it('backfills only native warehouse qty, never OVERSEAS total into a destination', () => {
    assert.equal(shouldBackfillNativeAvailable(false, 8, 'US-WEST'), true);
    assert.equal(shouldBackfillNativeAvailable(false, 0, 'US-WEST'), false);
    assert.equal(shouldBackfillNativeAvailable(true, 8, 'US-WEST'), false);
    assert.equal(shouldBackfillNativeAvailable(false, 100, 'OVERSEAS'), false);
  });
});
