import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeShippingLeadDays,
  shippingLeadAcrossWarehouses,
  shippingLeadFor,
} from './alert-ship-lead.js';

describe('shippingLeadFor', () => {
  it('prefers a configured warehouse value over the built-in table', () => {
    const configured = new Map<string, number | null>([['US-WEST', 70]]);
    assert.equal(shippingLeadFor('US-WEST', configured), 70);
  });

  it('uses a default profile total when the warehouse column is empty', () => {
    assert.equal(
      mergeShippingLeadDays({ warehouseDays: null, profileDays: 90 }),
      90,
    );
    assert.equal(shippingLeadFor('US-WEST', new Map([['US-WEST', 90]])), 90);
  });

  it('keeps the warehouse column when both warehouse and profile are set', () => {
    assert.equal(mergeShippingLeadDays({ warehouseDays: 40, profileDays: 90 }), 40);
  });

  it('falls back to the built-in table when nothing is configured', () => {
    assert.equal(shippingLeadFor('US-WEST', new Map()), 45);
    assert.equal(shippingLeadFor('DE', new Map()), 80);
    assert.equal(shippingLeadFor('UNKNOWN', new Map()), 60);
  });
});

describe('shippingLeadAcrossWarehouses', () => {
  it('uses the longest lead among the SKU warehouses', () => {
    const days = shippingLeadAcrossWarehouses(
      ['US-WEST', 'DE'],
      new Map<string, number | null>([['DE', 90]]),
    );
    assert.equal(days, 90);
  });
});
