import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  daysUntilDate,
  fullCoverageDays,
  inventoryRiskViewFromPrice,
  inventoryRiskViewLabel,
  isAlertNoise,
  matchesInventoryRiskView,
  resolveAlertAction,
  resolveAlertLevel,
  stockoutDateFromBandDays,
} from './alert-action.js';

const base = {
  shipDays: null as number | null,
  fullDays: 40,
  shippingLeadDays: 45,
  hasShippableLots: false,
  noise: false,
};

describe('resolveAlertAction', () => {
  it('prices an already missed stockout', () => {
    assert.deepEqual(
      resolveAlertAction({ ...base, shipDays: 0, fullDays: 0, hasShippableLots: true }),
      { action: 'price', priceReason: 'already_out' },
    );
  });

  it('prices west-coast 30 days even when local goods are ready', () => {
    assert.deepEqual(
      resolveAlertAction({ ...base, shipDays: 30, fullDays: 130, hasShippableLots: true }),
      { action: 'price', priceReason: 'ship_late' },
    );
  });

  it('prices east-coast 50 days because sea freight is 60 days', () => {
    assert.deepEqual(
      resolveAlertAction({
        ...base,
        shipDays: 50,
        fullDays: 50,
        shippingLeadDays: 60,
        hasShippableLots: true,
      }),
      { action: 'price', priceReason: 'ship_late' },
    );
  });

  it('prices 30 days when local goods are still in production', () => {
    assert.deepEqual(
      resolveAlertAction({ ...base, shipDays: 30, fullDays: 80, hasShippableLots: false }),
      { action: 'price', priceReason: 'not_ready' },
    );
  });

  it('marks west-coast 50 days with ready goods as urgent shipping', () => {
    assert.deepEqual(
      resolveAlertAction({ ...base, shipDays: 50, fullDays: 200, hasShippableLots: true }),
      { action: 'ship_urgent', priceReason: null },
    );
  });

  it('keeps the sailing window when local goods are not ready to ship', () => {
    assert.equal(
      resolveAlertAction({ ...base, shipDays: 50, fullDays: 200, hasShippableLots: false }).action,
      'ship_urgent',
    );
    assert.equal(
      resolveAlertAction({ ...base, shipDays: 58, fullDays: 58, hasShippableLots: false }).action,
      'ship',
    );
  });

  it('marks a later sailing window as shipping', () => {
    assert.deepEqual(
      resolveAlertAction({ ...base, shipDays: 58, fullDays: 58, hasShippableLots: true }),
      { action: 'ship', priceReason: null },
    );
  });

  it('shifts order bands out with a long total lead time', () => {
    const de = {
      ...base,
      shippingLeadDays: 80,
      hasShippableLots: false,
      totalLeadDays: 137,
      safetyStockDays: 14,
    };
    assert.equal(resolveAlertAction({ ...de, shipDays: 100, fullDays: 100 }).action, 'order_tight');
    assert.equal(resolveAlertAction({ ...de, shipDays: 125, fullDays: 125 }).action, 'order_tight');
    assert.equal(resolveAlertAction({ ...de, shipDays: 145, fullDays: 145 }).action, 'order');
  });

  it('keeps the old order band above a US-West lead of about 102 days', () => {
    const west = { ...base, shippingLeadDays: 45, totalLeadDays: 102, safetyStockDays: 14 };
    assert.equal(resolveAlertAction({ ...west, shipDays: 100, fullDays: 100 }).action, 'order_tight');
    assert.equal(resolveAlertAction({ ...west, shipDays: 110, fullDays: 110 }).action, 'order');
    assert.equal(resolveAlertAction({ ...west, shipDays: 130, fullDays: 130 }).action, 'healthy');
  });

  it('orders from full days when shipping cannot take the row', () => {
    assert.equal(resolveAlertAction({ ...base, shipDays: 80, fullDays: 80 }).action, 'order_tight');
    assert.equal(resolveAlertAction({ ...base, shipDays: 100, fullDays: 100 }).action, 'order');
  });

  it('treats 121–150 as healthy and 151–180 as mild overstock', () => {
    assert.equal(resolveAlertAction({ ...base, shipDays: 130, fullDays: 130 }).action, 'healthy');
    assert.equal(resolveAlertAction({ ...base, shipDays: 160, fullDays: 160 }).action, 'mild_overstock');
    assert.equal(resolveAlertAction({ ...base, shipDays: 180, fullDays: 180 }).action, 'mild_overstock');
  });

  it('splits 181–300 overstock from confirmed slow stock above 300', () => {
    assert.equal(resolveAlertAction({ ...base, shipDays: null, fullDays: 181 }).action, 'overstock');
    assert.equal(resolveAlertAction({ ...base, shipDays: 200, fullDays: 300 }).action, 'overstock');
    assert.equal(resolveAlertAction({ ...base, shipDays: null, fullDays: 301 }).action, 'confirmed_slow');
  });

  it('does not call long local cover overstock when a confirmed stockout is inside 120 days', () => {
    assert.equal(
      resolveAlertAction({ ...base, shipDays: 100, fullDays: 350, hasShippableLots: false }).action,
      'order',
    );
  });

  it('drops empty warehouses with no demand', () => {
    assert.equal(isAlertNoise({ avgDaily: 0, demandShare: 0, hasOpenLots: false }), true);
    assert.equal(resolveAlertAction({ ...base, shipDays: 10, noise: true }).action, 'none');
  });

  it('adds local quantity on top of confirmed days', () => {
    assert.equal(
      fullCoverageDays({ shipDays: 40, confirmedCoverageDays: 40, localQty: 80, avgDaily: 2 }),
      80,
    );
  });

  it('parses calendar days until the stockout date', () => {
    assert.equal(daysUntilDate('2026-09-30', '2026-10-30'), 30);
    assert.equal(daysUntilDate('2026-09-30', null), null);
  });
});

describe('resolveAlertLevel', () => {
  it('raises A-class pricing and A/B overstock to L3', () => {
    assert.equal(resolveAlertLevel({ action: 'price', shipDays: 10, profileClass: 'A' }), 'l3');
    assert.equal(resolveAlertLevel({ action: 'price', shipDays: 10, profileClass: 'C' }), 'l2');
    assert.equal(resolveAlertLevel({ action: 'overstock', shipDays: 200, profileClass: 'B' }), 'l3');
    assert.equal(resolveAlertLevel({ action: 'confirmed_slow', shipDays: null, profileClass: 'A' }), 'l3');
    assert.equal(resolveAlertLevel({ action: 'overstock', shipDays: 200, profileClass: null }), 'l1');
  });

  it('leaves healthy unclassified', () => {
    assert.equal(resolveAlertLevel({ action: 'healthy', shipDays: 130, profileClass: 'A' }), null);
  });

  it('keeps mild overstock and orders at L1', () => {
    assert.equal(resolveAlertLevel({ action: 'mild_overstock', shipDays: 160, profileClass: 'A' }), 'l1');
    assert.equal(resolveAlertLevel({ action: 'order_tight', shipDays: 80, profileClass: null }), 'l1');
  });

  it('raises order_tight to L2 when coverage is inside the total lead time', () => {
    assert.equal(
      resolveAlertLevel({
        action: 'order_tight',
        shipDays: 100,
        fullDays: 100,
        profileClass: null,
        totalLeadDays: 137,
      }),
      'l2',
    );
    assert.equal(
      resolveAlertLevel({
        action: 'order_tight',
        shipDays: 100,
        fullDays: 100,
        profileClass: null,
        totalLeadDays: 80,
      }),
      'l1',
    );
  });
});

describe('stockoutDateFromBandDays', () => {
  it('adds full-coverage band days to today', () => {
    assert.equal(stockoutDateFromBandDays('2026-09-30', 302), '2027-07-29');
  });
});

describe('inventory risk views', () => {
  it('splits price into already out vs imminent', () => {
    assert.equal(inventoryRiskViewFromPrice('already_out'), 'stockout_now');
    assert.equal(inventoryRiskViewFromPrice('ship_late'), 'stockout_imminent');
    assert.equal(inventoryRiskViewLabel({ action: 'price', priceReason: 'not_ready' }), 'stockout_imminent');
  });

  it('filters list views for the two price bands', () => {
    assert.equal(
      matchesInventoryRiskView({ action: 'price', priceReason: 'already_out', view: 'stockout_now' }),
      true,
    );
    assert.equal(
      matchesInventoryRiskView({ action: 'price', priceReason: 'ship_late', view: 'stockout_now' }),
      false,
    );
    assert.equal(
      matchesInventoryRiskView({ action: 'price', priceReason: 'ship_late', view: 'stockout_imminent' }),
      true,
    );
    assert.equal(
      matchesInventoryRiskView({ action: 'price', priceReason: 'already_out', view: 'price' }),
      true,
    );
  });
});
