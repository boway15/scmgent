import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enrichSupplyLotSummary } from './inventory-supply-lot-summary.js';

describe('enrichSupplyLotSummary', () => {
  const base = {
    skuId: 'sku-1',
    skuCode: 'SKU-1',
    skuName: 'Test',
    warehouseCode: 'US-WEST',
    overseasQty: 100,
    inTransitQty: 80,
    localQty: 50,
    updatedAt: '2026-09-22T00:00:00.000Z',
  };

  it('picks earliest dated in-transit arrival and sums qty on that date', () => {
    const summary = enrichSupplyLotSummary(base, [
      {
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        pool: 'in_transit',
        qty: 30,
        availableAt: '2026-10-05',
        dateUnknown: false,
        etaEstimated: false,
      },
      {
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        pool: 'in_transit',
        qty: 20,
        availableAt: '2026-10-05',
        dateUnknown: false,
        etaEstimated: true,
      },
      {
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        pool: 'in_transit',
        qty: 30,
        availableAt: '2026-10-20',
        dateUnknown: false,
        etaEstimated: false,
      },
    ]);

    assert.equal(summary.nextTransitAt, '2026-10-05');
    assert.equal(summary.nextTransitQty, 50);
    assert.equal(summary.nextTransitEstimated, true);
    assert.equal(summary.inTransitBatchCount, 3);
  });

  it('tracks undated transit separately from next arrival', () => {
    const summary = enrichSupplyLotSummary(base, [
      {
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        pool: 'in_transit',
        qty: 40,
        availableAt: null,
        dateUnknown: true,
        etaEstimated: true,
      },
      {
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        pool: 'in_transit',
        qty: 10,
        availableAt: '2026-11-01',
        dateUnknown: false,
        etaEstimated: false,
      },
    ]);

    assert.equal(summary.undatedTransitQty, 40);
    assert.equal(summary.nextTransitAt, '2026-11-01');
    assert.equal(summary.nextTransitQty, 10);
  });

  it('computes next local available date from local lots', () => {
    const summary = enrichSupplyLotSummary(base, [
      {
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        pool: 'local',
        qty: 20,
        availableAt: '2026-12-01',
        dateUnknown: false,
        etaEstimated: false,
      },
      {
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        pool: 'local',
        qty: 30,
        availableAt: '2026-11-15',
        dateUnknown: false,
        etaEstimated: false,
      },
    ]);

    assert.equal(summary.nextLocalAt, '2026-11-15');
    assert.equal(summary.nextLocalQty, 30);
    assert.equal(summary.localBatchCount, 2);
  });
});
