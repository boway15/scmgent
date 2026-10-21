import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  networkShippingLeadDays,
  resolveNetworkSkuAlertAction,
} from './alert-sku-network-classify.js';
import type { AlertListSupply } from './alert-list-supply.js';

function supply(partial: Partial<AlertListSupply>): AlertListSupply {
  return {
    localQty: 0,
    overseasQty: 0,
    inTransitQty: 0,
    futureNeedQty: null,
    projectedStockoutDate: null,
    networkLocalQty: 0,
    networkOverseasQty: 0,
    networkInTransitQty: 0,
    networkFutureNeedQty: null,
    networkAvgDaily: 2,
    networkForecastDaily: null,
    turnoverSales7d: null,
    turnoverSales14d: null,
    turnoverSales30d: null,
    warehouseAvgDaily: null,
    totalLeadDays: null,
    inTransitUndatedQty: 0,
    inTransitWithin45: 0,
    inTransitWithin60: 0,
    networkInTransitWithin45: 0,
    networkInTransitWithin60: 0,
    networkInTransitUndatedQty: 0,
    ...partial,
  };
}

describe('networkShippingLeadDays', () => {
  it('uses the longest shipping lead among the SKU warehouses', () => {
    assert.equal(
      networkShippingLeadDays(['US-WEST', 'DE'], new Map([['DE', 90]])),
      90,
    );
    assert.equal(
      networkShippingLeadDays(['US-WEST', 'DE'], new Map([['US-WEST', 20]])),
      80,
    );
  });
});

describe('resolveNetworkSkuAlertAction', () => {
  it('does not mark a SKU as order when network full coverage is far beyond 120 days', () => {
    const row = resolveNetworkSkuAlertAction({
      today: '2026-09-30',
      supply: supply({
        networkLocalQty: 1000,
        networkOverseasQty: 500,
        networkInTransitQty: 200,
        networkAvgDaily: 2,
      }),
      shippingLeadDays: 45,
      hasShippableLots: false,
      noise: false,
    });
    assert.notEqual(row.action, 'order');
    assert.notEqual(row.action, 'order_tight');
  });

  it('does not treat turnover projected stockout as price when on-hand transit coverage is long', () => {
    const row = resolveNetworkSkuAlertAction({
      today: '2026-09-30',
      supply: supply({
        networkLocalQty: 0,
        networkOverseasQty: 1500,
        networkInTransitQty: 0,
        networkAvgDaily: 2,
        projectedStockoutDate: '2026-10-15',
      }),
      shippingLeadDays: 45,
      hasShippableLots: true,
      noise: false,
    });
    assert.notEqual(row.action, 'price');
  });

  it('marks imminent price when on-hand transit coverage is below shipping lead', () => {
    const row = resolveNetworkSkuAlertAction({
      today: '2026-09-30',
      supply: supply({
        networkLocalQty: 0,
        networkOverseasQty: 60,
        networkInTransitQty: 0,
        networkAvgDaily: 2,
      }),
      shippingLeadDays: 45,
      hasShippableLots: true,
      noise: false,
    });
    assert.equal(row.action, 'price');
    assert.equal(row.priceReason, 'ship_late');
  });

  it('marks already out when on-hand transit is depleted', () => {
    const row = resolveNetworkSkuAlertAction({
      today: '2026-09-30',
      supply: supply({
        networkLocalQty: 0,
        networkOverseasQty: 0,
        networkInTransitQty: 0,
        networkAvgDaily: 2,
      }),
      shippingLeadDays: 45,
      hasShippableLots: false,
      noise: false,
    });
    assert.equal(row.action, 'price');
    assert.equal(row.priceReason, 'already_out');
  });

  it('keeps order band when network full coverage is inside 91–120 days', () => {
    const row = resolveNetworkSkuAlertAction({
      today: '2026-09-30',
      supply: supply({
        networkLocalQty: 0,
        networkOverseasQty: 200,
        networkInTransitQty: 0,
        networkAvgDaily: 2,
      }),
      shippingLeadDays: 45,
      hasShippableLots: false,
      noise: false,
    });
    assert.equal(row.action, 'order');
  });

  it('puts 151–180 day coverage into mild overstock', () => {
    const row = resolveNetworkSkuAlertAction({
      today: '2026-09-30',
      supply: supply({
        networkLocalQty: 20,
        networkOverseasQty: 300,
        networkInTransitQty: 0,
        networkAvgDaily: 2,
      }),
      shippingLeadDays: 45,
      hasShippableLots: false,
      noise: false,
    });
    assert.equal(row.action, 'mild_overstock');
  });

  it('puts 181–300 day coverage into overstock', () => {
    const row = resolveNetworkSkuAlertAction({
      today: '2026-09-30',
      supply: supply({
        networkLocalQty: 0,
        networkOverseasQty: 500,
        networkInTransitQty: 0,
        networkAvgDaily: 2,
      }),
      shippingLeadDays: 45,
      hasShippableLots: false,
      noise: false,
    });
    assert.equal(row.action, 'overstock');
  });

  it('caps empty daily with on-hand stock at 9999 days as confirmed slow', () => {
    const row = resolveNetworkSkuAlertAction({
      today: '2026-09-30',
      supply: supply({
        networkLocalQty: 10,
        networkOverseasQty: 80,
        networkInTransitQty: 0,
        networkAvgDaily: null,
        networkForecastDaily: null,
      }),
      shippingLeadDays: 45,
      hasShippableLots: false,
      noise: false,
    });
    assert.equal(row.action, 'confirmed_slow');
  });
});
