import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyInTransitArrival,
  coverageDaysFromQty,
  horizonDemand,
  recommendOrder,
  orderCoverDays,
  recommendOrderForNetworkAlert,
  recommendShip,
} from './alert-horizon-demand.js';

describe('horizonDemand', () => {
  it('splits demand windows when full coverage is under 150 days', () => {
    const row = horizonDemand({
      coverageDays: 40,
      avgDaily: 2,
      overseasQty: 50,
      inTransitWithin45: 10,
      inTransitWithin60: 10,
    });
    assert.deepEqual(row, {
      demand150: 300,
      demand120: 240,
      demand90: 180,
      ship60: 60,
      urgent45: 30,
      demand30: 60,
      gap90: 130,
      gap120: 190,
      gap150: 250,
      windowCovered: false,
      shipWindowCovered: false,
      gap90Overseas: 130,
      gap150Overseas: 250,
      demandCover: 300,
      gapCover: 250,
      gapCoverOverseas: 250,
    });
  });

  it('does not subtract undated in-transit from the ship gap', () => {
    const row = horizonDemand({
      coverageDays: 40,
      avgDaily: 2,
      overseasQty: 50,
      inTransitWithin45: 0,
      inTransitWithin60: 0,
    });
    assert.equal(row?.ship60, 70);
    assert.equal(row?.urgent45, 40);
  });

  it('zeros order gaps when the full network is covered but still computes ship gaps overseas-only', () => {
    assert.deepEqual(
      horizonDemand({ coverageDays: 302, avgDaily: 2, overseasQty: 10 }),
      {
        demand150: 300,
        demand120: 240,
        demand90: 180,
        ship60: 110,
        urgent45: 80,
        demand30: 60,
        gap90: 0,
        gap120: 0,
        gap150: 0,
        windowCovered: true,
        shipWindowCovered: false,
        gap90Overseas: 170,
        gap150Overseas: 290,
        demandCover: 300,
        gapCover: 0,
        gapCoverOverseas: 290,
      },
    );
  });

  it('keeps a dated arrival inside 45 days and drops one after 60 days', () => {
    assert.deepEqual(
      classifyInTransitArrival({
        today: '2026-09-30',
        availableAt: '2026-10-20',
        qty: 8,
      }),
      { within45: 8, within60: 8, undated: 0 },
    );
    assert.deepEqual(
      classifyInTransitArrival({
        today: '2026-09-30',
        availableAt: '2026-12-30',
        qty: 8,
      }),
      { within45: 0, within60: 0, undated: 0 },
    );
    assert.deepEqual(
      classifyInTransitArrival({
        today: '2026-09-30',
        availableAt: '2026-10-20',
        etaEstimated: true,
        qty: 8,
      }),
      { within45: 0, within60: 0, undated: 8 },
    );
  });

  it('subtracts on-hand, in-transit, and local from the order gap', () => {
    const row = horizonDemand({
      coverageDays: 40,
      avgDaily: 2,
      overseasQty: 50,
      localQty: 80,
      inTransitQty: 20,
    });
    assert.equal(row?.gap90, 30);
    assert.equal(row?.gap120, 90);
    assert.equal(row?.gap150, 150);
    assert.equal(row?.ship60, 70);
  });

  it('orders today when the 90-day gap is already open', () => {
    assert.deepEqual(
      recommendOrder({
        today: '2026-09-30',
        coverageDays: 100,
        totalLeadDays: 70,
        gap90: 30,
        gap150: 150,
        windowCovered: false,
      }),
      { orderByDate: '2026-09-30', orderQty: 150, orderNow: true },
    );
  });

  it('requires urgent ship today when the sailing slack is within 7 days', () => {
    assert.deepEqual(
      recommendShip({
        today: '2026-09-30',
        shipWindowCovered: false,
        urgent45: 12,
        ship60: 20,
        action: 'ship_urgent',
        daysToStockout: 40,
        shippingLeadDays: 45,
      }),
      { shipByDate: '2026-09-30', shipQty: 12, shipNow: true },
    );
  });

  it('schedules ship by the latest sailing slack when not urgent', () => {
    assert.deepEqual(
      recommendShip({
        today: '2026-09-30',
        shipWindowCovered: false,
        urgent45: 0,
        ship60: 18,
        action: 'ship',
        daysToStockout: 60,
        shippingLeadDays: 45,
      }),
      { shipByDate: '2026-10-15', shipQty: 18, shipNow: false },
    );
  });

  it('orders the lead-plus-safety gap instead of the 150-day gap', () => {
    assert.equal(orderCoverDays(102, 14), 116);
    assert.equal(orderCoverDays(null, 14), 104);
    const horizons = horizonDemand({
      coverageDays: 80,
      avgDaily: 2,
      overseasQty: 20,
      localQty: 0,
      inTransitQty: 0,
      coverDays: 84,
    });
    assert.equal(horizons?.demandCover, 168);
    assert.equal(horizons?.gapCover, 148);
    assert.equal(horizons?.gap150, 280);
    assert.deepEqual(
      recommendOrder({
        today: '2026-09-30',
        coverageDays: 80,
        totalLeadDays: 70,
        safetyStockDays: 14,
        gap90: 30,
        gap150: horizons?.gap150 ?? 0,
        gapCover: horizons?.gapCover,
        windowCovered: false,
      }),
      { orderByDate: '2026-09-30', orderQty: 148, orderNow: true },
    );
  });

  it('keeps the lead-plus-safety gap when coverage is already past 150 days', () => {
    const horizons = horizonDemand({
      coverageDays: 150,
      avgDaily: 2,
      overseasQty: 0,
      localQty: 0,
      inTransitQty: 0,
      coverDays: 151,
    });
    assert.equal(horizons?.windowCovered, true);
    assert.equal(horizons?.gap150, 0);
    assert.equal(horizons?.gapCover, 302);
    assert.deepEqual(
      recommendOrder({
        today: '2026-10-21',
        coverageDays: 150,
        totalLeadDays: 137,
        safetyStockDays: 14,
        gap90: 0,
        gap150: horizons?.gap150 ?? 0,
        gapCover: horizons?.gapCover,
        windowCovered: true,
      }),
      { orderByDate: '2026-10-21', orderQty: 302, orderNow: true },
    );
  });

  it('schedules the 150-day gap when 90 days are still covered', () => {
    assert.deepEqual(
      recommendOrder({
        today: '2026-09-30',
        coverageDays: 120,
        totalLeadDays: 70,
        safetyStockDays: 14,
        gap90: 0,
        gap150: 80,
        windowCovered: false,
      }),
      { orderByDate: '2026-11-05', orderQty: 80, orderNow: false },
    );
  });

  it('suggests ship for price tier when local covers 150 days but overseas is short', () => {
    const horizons = horizonDemand({
      coverageDays: 200,
      avgDaily: 2,
      overseasQty: 20,
      localQty: 500,
      inTransitQty: 0,
    });
    assert.equal(horizons?.windowCovered, true);
    assert.equal(horizons?.ship60, 100);
    assert.deepEqual(
      recommendShip({
        today: '2026-09-30',
        shipWindowCovered: horizons?.shipWindowCovered ?? true,
        urgent45: horizons?.urgent45 ?? 0,
        ship60: horizons?.ship60 ?? 0,
        action: 'price',
        daysToStockout: 30,
        shippingLeadDays: 60,
      }),
      { shipByDate: '2026-09-30', shipQty: 100, shipNow: true },
    );
  });

  it('caps one shipment at 30 days of demand, then lifts to MOQ', () => {
    const horizons = horizonDemand({
      coverageDays: 0,
      avgDaily: 10,
      overseasQty: 0,
      localQty: 0,
      inTransitQty: 0,
    });
    assert.equal(horizons?.demand30, 300);
    assert.equal(horizons?.urgent45, 450);
    assert.deepEqual(
      recommendShip({
        today: '2026-09-30',
        shipWindowCovered: false,
        urgent45: horizons?.urgent45 ?? 0,
        ship60: horizons?.ship60 ?? 0,
        action: 'ship_urgent',
        daysToStockout: 0,
        shippingLeadDays: 45,
        maxCoverQty: horizons?.demand30,
        moq: 20,
      }),
      { shipByDate: '2026-09-30', shipQty: 300, shipNow: true },
    );
    assert.equal(
      recommendShip({
        today: '2026-09-30',
        shipWindowCovered: false,
        urgent45: horizons?.urgent45 ?? 0,
        ship60: horizons?.ship60 ?? 0,
        action: 'ship_urgent',
        daysToStockout: 0,
        shippingLeadDays: 45,
        maxCoverQty: horizons?.demand30,
        moq: 400,
      }).shipQty,
      400,
    );
    assert.equal(
      recommendShip({
        today: '2026-09-30',
        shipWindowCovered: true,
        urgent45: 450,
        ship60: 600,
        action: 'ship',
        daysToStockout: 0,
        shippingLeadDays: 45,
        maxCoverQty: 300,
        moq: 400,
      }).shipQty,
      0,
    );
  });

  it('falls back to overseas-only order gap for not_ready price tier', () => {
    const horizons = horizonDemand({
      coverageDays: 200,
      avgDaily: 2,
      overseasQty: 20,
      localQty: 500,
      inTransitQty: 0,
    });
    assert.deepEqual(
      recommendOrderForNetworkAlert({
        today: '2026-09-30',
        coverageDays: 200,
        totalLeadDays: 70,
        horizons,
        networkAction: 'price',
        priceReason: 'not_ready',
      }),
      { orderByDate: '2026-09-30', orderQty: 280, orderNow: true, orderOverseasReference: true },
    );
  });

  it('falls back to overseas-only order gap for ship_late when local is shippable', () => {
    const horizons = horizonDemand({
      coverageDays: 200,
      avgDaily: 2,
      overseasQty: 20,
      localQty: 500,
      inTransitQty: 0,
    });
    assert.deepEqual(
      recommendOrderForNetworkAlert({
        today: '2026-09-30',
        coverageDays: 200,
        totalLeadDays: 70,
        horizons,
        networkAction: 'price',
        priceReason: 'ship_late',
      }),
      { orderByDate: '2026-09-30', orderQty: 280, orderNow: true, orderOverseasReference: true },
    );
  });

  it('caps the alert order qty at 30 days of demand, then lifts to MOQ', () => {
    const horizons = horizonDemand({
      coverageDays: 0,
      avgDaily: 10,
      overseasQty: 0,
      localQty: 0,
      inTransitQty: 0,
      coverDays: 116,
    });
    assert.equal(horizons?.demand30, 300);
    assert.ok((horizons?.gapCover ?? 0) > 300);
    assert.equal(
      recommendOrderForNetworkAlert({
        today: '2026-09-30',
        coverageDays: 0,
        totalLeadDays: 102,
        horizons,
        networkAction: 'order',
        priceReason: null,
        maxCoverQty: horizons?.demand30,
        moq: 20,
      }).orderQty,
      300,
    );
    assert.equal(
      recommendOrderForNetworkAlert({
        today: '2026-09-30',
        coverageDays: 0,
        totalLeadDays: 102,
        horizons,
        networkAction: 'order',
        priceReason: null,
        maxCoverQty: horizons?.demand30,
        moq: 400,
      }).orderQty,
      400,
    );
  });

  it('covers network qty with daily demand', () => {
    assert.equal(coverageDaysFromQty(302, 1), 302);
    assert.equal(coverageDaysFromQty(10, 0), 9999);
    assert.equal(coverageDaysFromQty(0, 0), 0);
    assert.equal(coverageDaysFromQty(10, null), 9999);
  });
});
