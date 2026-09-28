import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSharesFromSnapshot } from './inventory-share-allocation.js';
import {
  buildNetworkNativeBackfillLot,
  pickTimelineFallbackDaily,
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

describe('pickTimelineFallbackDaily', () => {
  it('uses planning fallback when source is demand_plan', () => {
    assert.equal(
      pickTimelineFallbackDaily({
        source: 'demand_plan',
        planningFallbackDaily: 8,
        avgDaily: 3,
      }),
      8,
    );
  });

  it('uses avgDaily when source is forecast', () => {
    assert.equal(
      pickTimelineFallbackDaily({
        source: 'forecast',
        planningFallbackDaily: 8,
        avgDaily: 3,
      }),
      3,
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

describe('buildNetworkNativeBackfillLot', () => {
  it('sums physical warehouse native available when no confirmed overseas lots', () => {
    const lot = buildNetworkNativeBackfillLot({
      hasConfirmedOverseas: false,
      nativeAvailableByWarehouse: [
        { warehouseCode: 'US-WEST', qtyAvailable: 30 },
        { warehouseCode: 'US-EAST', qtyAvailable: 20 },
        { warehouseCode: 'OVERSEAS', qtyAvailable: 999 },
        { warehouseCode: 'IN-PRODUCTION', qtyAvailable: 50 },
      ],
      today: '2026-09-22',
    });

    assert.ok(lot);
    assert.equal(lot!.qty, 50);
    assert.equal(lot!.availableAt, '2026-09-22');
    assert.equal(lot!.supplyClass, 'confirmed');
  });

  it('returns null when confirmed overseas lots already exist', () => {
    assert.equal(
      buildNetworkNativeBackfillLot({
        hasConfirmedOverseas: true,
        nativeAvailableByWarehouse: [{ warehouseCode: 'US-WEST', qtyAvailable: 10 }],
        today: '2026-09-22',
      }),
      null,
    );
  });
});
