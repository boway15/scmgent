import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLatePoActions, estimateNearWindowGap } from './planning-late-po-actions.js';

describe('planning-late-po-actions', () => {
  it('returns empty when not uncoverable', () => {
    assert.deepEqual(
      buildLatePoActions({
        today: '2026-09-01',
        warehouseCode: 'US-WEST',
        regionGroup: 'US',
        uncoverableByNewPo: false,
        stockoutDateConfirmed: '2026-09-20',
        avgDaily: 10,
        totalLeadDays: 90,
      }),
      [],
    );
  });

  it('ranks transfer, fast ship, and accept stockout', () => {
    const actions = buildLatePoActions({
      today: '2026-09-01',
      warehouseCode: 'US-WEST',
      regionGroup: 'US',
      uncoverableByNewPo: true,
      stockoutDateConfirmed: '2026-09-20',
      avgDaily: 10,
      totalLeadDays: 90,
      fastShipLeadDays: 40,
      peerWarehouses: [
        { warehouseCode: 'US-EAST', regionGroup: 'US', confirmedAvailableQty: 300 },
        { warehouseCode: 'DE', regionGroup: 'EU', confirmedAvailableQty: 999 },
      ],
    });
    assert.equal(actions[0]?.kind, 'transfer');
    assert.equal(actions[0]?.qty, 300);
    assert.ok(actions.some((a) => a.kind === 'fast_ship'));
    assert.ok(actions.some((a) => a.kind === 'accept_stockout'));
  });

  it('estimates near window gap from stockout span', () => {
    assert.equal(
      estimateNearWindowGap({
        today: '2026-09-01',
        stockoutDateConfirmed: '2026-09-11',
        avgDaily: 5,
      }),
      50,
    );
  });
});
