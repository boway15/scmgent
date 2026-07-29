import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcEffectiveDailyDemand } from './effective-daily-demand.js';

function dateRange(start: string, days: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  for (let i = 0; i < days; i += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

describe('effective-daily-demand', () => {
  it('adjusts for stockout days', () => {
    const inStockDates = dateRange('2026-06-01', 20);
    const stockoutDates = dateRange('2026-06-21', 10);
    const sales = inStockDates.map((saleDate) => ({ saleDate, qtySold: 50 }));
    const availability = [
      ...inStockDates.map((date) => ({ date, qtyAvailable: 100 })),
      ...stockoutDates.map((date) => ({ date, qtyAvailable: 0 })),
    ];

    const r = calcEffectiveDailyDemand({
      sales,
      availability,
      windowDays: 30,
      asOf: new Date('2026-07-01'),
    });

    assert.equal(r.stockoutAdjusted, true);
    assert.equal(r.inStockDays, 20);
    assert.equal(r.avgDaily, 50);
    assert.equal(r.soldOnInStockDays, 1000);
    assert.equal(r.calendarSold, 1000);
    assert.equal(r.windowDays, 30);
  });

  it('falls back to calendar average without availability', () => {
    const r = calcEffectiveDailyDemand({
      sales: [{ saleDate: '2026-06-01', qtySold: 90 }],
      availability: [],
      windowDays: 30,
      asOf: new Date('2026-07-01'),
    });

    assert.equal(r.stockoutAdjusted, false);
    assert.equal(r.avgDaily, 3);
    assert.equal(r.calendarSold, 90);
    assert.equal(r.inStockDays, 0);
    assert.equal(r.soldOnInStockDays, 0);
    assert.equal(r.windowDays, 30);
  });
});
