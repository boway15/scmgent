import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFeeAllocationMethod } from './fob-allocation-method-display.js';

describe('resolveFeeAllocationMethod', () => {
  const liveRules = [
    {
      feeType: '报关费',
      sourceBillType: 'trucking',
      matchPattern: null,
      priority: 10,
      allocationMethod: 'by_ticket' as const,
      isActive: true,
    },
  ];

  it('uses the batch stored method even when live rules differ', () => {
    const allocationsByBillItem = new Map([
      [
        'bill-1',
        [{ id: 'a1', allocationMethod: 'by_volume' }],
      ],
    ]);
    assert.equal(
      resolveFeeAllocationMethod(
        '报关费',
        'trucking',
        liveRules,
        'bill-1',
        allocationsByBillItem,
      ),
      'by_volume',
    );
  });

  it('falls back to bill item method when allocations are missing', () => {
    const billItemMethods = new Map([['bill-1', 'manual']]);
    assert.equal(
      resolveFeeAllocationMethod(
        '报关费',
        'trucking',
        liveRules,
        'bill-1',
        undefined,
        billItemMethods,
      ),
      'manual',
    );
  });

  it('ignores inactive live rules when falling back', () => {
    assert.equal(
      resolveFeeAllocationMethod('报关费', 'trucking', [
        { ...liveRules[0], isActive: false },
      ]),
      'by_volume',
    );
  });
});
