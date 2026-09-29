import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assembleWarehouseTimeline } from './inventory-timeline-service.js';

describe('assembleWarehouseTimeline', () => {
  it('uses preloaded reserved qty and does not invent a stockout when demand is zero', () => {
    const result = assembleWarehouseTimeline({
      today: new Date('2026-09-01T00:00:00.000Z'),
      warehouseCode: 'US-WEST',
      avgDaily: 0,
      totalLeadDays: 30,
      safetyStockDays: 14,
      safetyStockQty: 10,
      share: { method: 'unallocated', shareSum: 0, shareSumWarning: false, weights: [] },
      snapshot: {
        warehouseCode: 'US-WEST',
        qtyAvailable: 100,
        qtyInTransit: 0,
        qtyInProduction: 0,
        qtyReserved: 5,
      },
      overseasSnapshot: {
        warehouseCode: 'OVERSEAS',
        qtyAvailable: 0,
        qtyInTransit: 0,
        qtyInProduction: 0,
        qtyReserved: 0,
      },
      openLots: [],
      planningDemand: {
        demandMap: new Map(),
        championMap: new Map(),
        source: 'forecast',
        flags: [],
        fallbackDaily: 0,
      },
    });

    assert.equal(result.reservedQty, 5);
    assert.equal(result.timeline.stockoutDateConfirmed, null);
    assert.equal(result.suggestedQty, 0);
  });
});
