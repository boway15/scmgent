import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveAlertListSupply } from './alert-list-supply.js';

const lots = { local: 120, overseas: 40, inTransit: 15 };

describe('resolveAlertListSupply', () => {
  it('uses open lots, pending suggestion, and the alert stockout date', () => {
    const supply = resolveAlertListSupply({
      alertStockoutDate: '2026-10-03',
      hasOpenLots: true,
      lotPools: lots,
      suggestionQty: 80,
      metrics: {
        timelineSuggestedQty: 50,
        timelineStockoutDate: '2026-11-01',
      },
    });
    assert.deepEqual(supply, {
      localQty: 120,
      overseasQty: 40,
      inTransitQty: 15,
      futureNeedQty: 80,
      projectedStockoutDate: '2026-10-03',
    });
  });

  it('falls back to timeline gap and stockout date when the alert has neither', () => {
    const supply = resolveAlertListSupply({
      alertStockoutDate: null,
      hasOpenLots: true,
      lotPools: { local: 0, overseas: 0, inTransit: 0 },
      suggestionQty: null,
      metrics: {
        timelineSuggestedQty: 36,
        timelineStockoutDate: '2026-09-28T00:00:00.000Z',
      },
    });
    assert.equal(supply.futureNeedQty, 36);
    assert.equal(supply.projectedStockoutDate, '2026-09-28');
    assert.equal(supply.localQty, 0);
  });

  it('uses Feishu turnover totals when this warehouse has no open lots', () => {
    const supply = resolveAlertListSupply({
      hasOpenLots: false,
      lotPools: { local: 0, overseas: 0, inTransit: 0 },
      suggestionQty: null,
      metrics: {
        inventoryPosition: {
          qtyAvailable: 0,
          qtyInTransit: 0,
          qtyInProduction: 0,
        },
      },
      turnover: {
        供应商订单: '1440',
        海外仓在库: '691',
        调拨在途合计: '329',
        本月预测日均销量: '23',
        采购周期: '50',
        预计海外仓断货时间: '2026-10-09T00:00:00.000Z',
      },
    });
    assert.equal(supply.localQty, 1440);
    assert.equal(supply.overseasQty, 691);
    assert.equal(supply.inTransitQty, 329);
    assert.equal(supply.futureNeedQty, 1150);
    assert.equal(supply.projectedStockoutDate, '2026-10-09');
  });

  it('reads double-encoded health metrics', () => {
    const supply = resolveAlertListSupply({
      hasOpenLots: false,
      lotPools: { local: 0, overseas: 0, inTransit: 0 },
      suggestionQty: null,
      metrics: JSON.stringify({
        timelineSuggestedQty: 12,
        timelineStockoutDate: '2026-12-01',
        inventoryPosition: { qtyAvailable: 4, qtyInTransit: 2, qtyInProduction: 1 },
      }),
    });
    assert.equal(supply.overseasQty, 4);
    assert.equal(supply.inTransitQty, 2);
    assert.equal(supply.localQty, 1);
    assert.equal(supply.futureNeedQty, 12);
    assert.equal(supply.projectedStockoutDate, '2026-12-01');
  });

  it('uses the health snapshot position when this warehouse has no open lots', () => {
    const supply = resolveAlertListSupply({
      hasOpenLots: false,
      lotPools: { local: 999, overseas: 999, inTransit: 999 },
      suggestionQty: null,
      metrics: {
        inventoryPosition: {
          qtyAvailable: 20,
          qtyInTransit: 8,
          qtyInProduction: 5,
          qtyConfirmedOpen: 3,
        },
      },
    });
    assert.equal(supply.overseasQty, 20);
    assert.equal(supply.inTransitQty, 8);
    assert.equal(supply.localQty, 8);
    assert.equal(supply.futureNeedQty, null);
    assert.equal(supply.projectedStockoutDate, null);
  });
});
