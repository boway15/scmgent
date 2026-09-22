import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSharesFromSnapshot } from './inventory-share-allocation.js';
import {
  applyConfirmedDestinationsToLots,
  applyDestAssignments,
  isUnallocatedLot,
  suggestDestAssignments,
  type DestAssignment,
} from './inventory-dest-allocation.js';
import type { BuiltSupplyLot } from './inventory-supply-lots.js';

const skuA = '11111111-1111-1111-1111-111111111111';

function overseasLot(partial: Partial<BuiltSupplyLot> = {}): BuiltSupplyLot {
  return {
    skuId: skuA,
    warehouseCode: 'OVERSEAS',
    pool: 'local',
    qty: 1500,
    availableAt: '2026-10-09',
    source: 'purchase_draft',
    sourceId: 'PO-1',
    status: 'open',
    ...partial,
  };
}

describe('isUnallocatedLot', () => {
  it('treats open OVERSEAS lots as unallocated', () => {
    assert.equal(isUnallocatedLot(overseasLot()), true);
  });

  it('skips dest warehouses and non-open lots', () => {
    assert.equal(isUnallocatedLot(overseasLot({ warehouseCode: 'US-WEST' })), false);
    assert.equal(isUnallocatedLot(overseasLot({ status: 'cancelled' })), false);
  });
});

describe('suggestDestAssignments', () => {
  it('returns a share-based draft when weights exist', () => {
    const share = parseSharesFromSnapshot({ 美西: '0.6', 美东: '0.4' });
    const suggested = suggestDestAssignments(1500, share);
    const byWh = Object.fromEntries(suggested.map((row) => [row.warehouseCode, row.qty]));
    assert.equal((byWh['US-WEST'] ?? 0) + (byWh['US-EAST'] ?? 0), 1500);
    assert.equal(byWh['US-WEST'], 900);
    assert.equal(byWh['US-EAST'], 600);
  });

  it('returns no draft when share is unallocated', () => {
    assert.deepEqual(suggestDestAssignments(1500, parseSharesFromSnapshot({})), []);
  });
});

describe('applyDestAssignments', () => {
  it('rejects assignments that do not sum to lot qty', () => {
    assert.throws(
      () =>
        applyDestAssignments(overseasLot(), [
          { warehouseCode: 'US-WEST', qty: 900 },
          { warehouseCode: 'US-EAST', qty: 500 },
        ]),
      /必须等于/,
    );
  });

  it('rejects OVERSEAS or IN-PRODUCTION destinations', () => {
    assert.throws(
      () => applyDestAssignments(overseasLot({ qty: 10 }), [{ warehouseCode: 'OVERSEAS', qty: 10 }]),
      /目的仓/,
    );
    assert.throws(
      () =>
        applyDestAssignments(overseasLot({ qty: 10 }), [
          { warehouseCode: 'IN-PRODUCTION', qty: 10 },
        ]),
      /目的仓/,
    );
  });

  it('splits an OVERSEAS lot into dest lots with the same source id', () => {
    const assignments: DestAssignment[] = [
      { warehouseCode: 'US-WEST', qty: 900 },
      { warehouseCode: 'US-EAST', qty: 600 },
    ];
    const lots = applyDestAssignments(overseasLot(), assignments);
    assert.deepEqual(
      lots.map((row) => ({ warehouseCode: row.warehouseCode, qty: row.qty, sourceId: row.sourceId })),
      [
        { warehouseCode: 'US-WEST', qty: 900, sourceId: 'PO-1' },
        { warehouseCode: 'US-EAST', qty: 600, sourceId: 'PO-1' },
      ],
    );
  });
});

describe('applyConfirmedDestinationsToLots', () => {
  it('rewrites matching OVERSEAS lots and keeps leftover', () => {
    const lots = applyConfirmedDestinationsToLots(
      [
        overseasLot({ qty: 1500 }),
        overseasLot({ skuId: 'other', sourceId: 'PO-2', qty: 80 }),
      ],
      [
        {
          source: 'purchase_draft',
          sourceId: 'PO-1',
          pool: 'local',
          warehouseCode: 'US-WEST',
          qty: 900,
        },
        {
          source: 'purchase_draft',
          sourceId: 'PO-1',
          pool: 'local',
          warehouseCode: 'US-EAST',
          qty: 400,
        },
      ],
    );
    const po1 = lots.filter((row) => row.sourceId === 'PO-1');
    assert.deepEqual(
      po1.map((row) => ({ warehouseCode: row.warehouseCode, qty: row.qty })).sort((a, b) =>
        a.warehouseCode.localeCompare(b.warehouseCode),
      ),
      [
        { warehouseCode: 'OVERSEAS', qty: 200 },
        { warehouseCode: 'US-EAST', qty: 400 },
        { warehouseCode: 'US-WEST', qty: 900 },
      ],
    );
    assert.equal(lots.filter((row) => row.sourceId === 'PO-2').length, 1);
  });

  it('leaves lots unchanged when no confirmation matches', () => {
    const original = [overseasLot()];
    const lots = applyConfirmedDestinationsToLots(original, []);
    assert.equal(lots[0]?.warehouseCode, 'OVERSEAS');
    assert.equal(lots[0]?.qty, 1500);
  });
});
