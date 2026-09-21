import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unconstrainRecentDaily } from './forecast-demand-unconstrain.js';

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function daysBetweenInclusive(start: Date, end: Date): Array<{ saleDate: string; qtySold: number }> {
  const rows: Array<{ saleDate: string; qtySold: number }> = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    rows.push({ saleDate: new Date(t).toISOString().slice(0, 10), qtySold: 0 });
  }
  return rows;
}

describe('unconstrainRecentDaily', () => {
  it('reconstructs core SKU: 100 sold in 70 days, 20 consecutive zeros → U=100/70 capped by 1.5×calendar', () => {
    const windowEnd = utcDate('2026-05-31');
    const windowStart = utcDate('2026-03-03'); // 90 days
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    for (const row of rows) {
      if (row.saleDate <= '2026-05-11') row.qtySold = 100 / 70;
    }
    const qtySum = rows.reduce((s, r) => s + r.qtySold, 0);
    assert.ok(Math.abs(qtySum - 100) < 0.01);

    const result = unconstrainRecentDaily({
      sales: rows,
      windowStart,
      windowEnd,
      lifecycle: 'mature',
      firstSaleDate: '2025-01-01',
    });
    assert.equal(result.reconstructed, true);
    assert.equal(result.stockoutDays, 20);
    assert.equal(result.effectiveDays, 70);
    assert.equal(result.skipReason, null);
    const calendar = 100 / 90;
    const expected = Math.min(100 / 70, 1.5 * calendar);
    assert.ok(Math.abs(result.unconstrainedDaily - expected) < 1e-4);
    assert.equal(result.reconstructCapHit, false);
  });

  it('does not reconstruct tail when calendar 90 daily < 1', () => {
    const windowEnd = utcDate('2026-05-31');
    const windowStart = utcDate('2026-03-03');
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    for (const row of rows.slice(0, 10)) row.qtySold = 2;
    const result = unconstrainRecentDaily({
      sales: rows,
      windowStart,
      windowEnd,
      lifecycle: 'mature',
      firstSaleDate: '2025-01-01',
    });
    assert.equal(result.reconstructed, false);
    assert.equal(result.skipReason, 'tail');
    assert.equal(result.unconstrainedDaily, result.calendarDaily);
  });

  it('does not reconstruct new or intermittent', () => {
    const windowEnd = utcDate('2026-05-31');
    const windowStart = utcDate('2026-03-03');
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    for (const row of rows.slice(0, 70)) row.qtySold = 2;
    for (const lifecycle of ['new', 'intermittent'] as const) {
      const result = unconstrainRecentDaily({
        sales: rows,
        windowStart,
        windowEnd,
        lifecycle,
        firstSaleDate: '2026-04-01',
      });
      assert.equal(result.reconstructed, false);
      assert.equal(result.skipReason, lifecycle);
    }
  });

  it('skips coverage_insufficient when effective days < 30% of window', () => {
    const windowEnd = utcDate('2026-05-31');
    const windowStart = utcDate('2026-03-03');
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    for (const row of rows.slice(0, 20)) row.qtySold = 10;
    const result = unconstrainRecentDaily({
      sales: rows,
      windowStart,
      windowEnd,
      lifecycle: 'mature',
      firstSaleDate: '2025-01-01',
    });
    assert.equal(result.reconstructed, false);
    assert.equal(result.skipReason, 'coverage_insufficient');
  });

  it('ignores zeros before firstSaleDate', () => {
    const windowEnd = utcDate('2026-05-31');
    const windowStart = utcDate('2026-03-03');
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    for (const row of rows) {
      if (row.saleDate >= '2026-05-01') row.qtySold = 5;
    }
    const result = unconstrainRecentDaily({
      sales: rows,
      windowStart,
      windowEnd,
      lifecycle: 'mature',
      firstSaleDate: '2026-05-01',
    });
    assert.equal(result.skipReason === 'no_run' || result.stockoutDays === 0, true);
  });

  it('sets reconstructCapHit when raw U exceeds 1.5× calendar daily', () => {
    const windowEnd = utcDate('2026-05-31');
    const windowStart = utcDate('2026-03-03'); // 90 days
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    const sellDays = 55;
    const qtyTotal = 180;
    for (const row of rows.slice(0, sellDays)) row.qtySold = qtyTotal / sellDays;
    const qtySum = rows.reduce((s, r) => s + r.qtySold, 0);
    assert.ok(Math.abs(qtySum - qtyTotal) < 0.01);

    const result = unconstrainRecentDaily({
      sales: rows,
      windowStart,
      windowEnd,
      lifecycle: 'mature',
      firstSaleDate: '2025-01-01',
    });
    assert.equal(result.reconstructed, true);
    assert.equal(result.stockoutDays, 35);
    assert.equal(result.effectiveDays, 55);
    const calendar = qtyTotal / 90;
    const cap = 1.5 * calendar;
    assert.ok(qtyTotal / sellDays > cap + 1e-12);
    assert.equal(result.reconstructCapHit, true);
    assert.ok(Math.abs(result.unconstrainedDaily - cap) < 1e-4);
  });

  it('reconstructs stockout_suspected SKU when volume/coverage gates pass', () => {
    const windowEnd = utcDate('2026-05-31');
    const windowStart = utcDate('2026-03-03'); // 90 days
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    for (const row of rows) {
      if (row.saleDate <= '2026-05-11') row.qtySold = 100 / 70;
    }
    const qtySum = rows.reduce((s, r) => s + r.qtySold, 0);
    assert.ok(Math.abs(qtySum - 100) < 0.01);

    const result = unconstrainRecentDaily({
      sales: rows,
      windowStart,
      windowEnd,
      lifecycle: 'stockout_suspected',
      firstSaleDate: '2025-01-01',
    });
    assert.equal(result.reconstructed, true);
    assert.equal(result.stockoutDays, 20);
    assert.equal(result.effectiveDays, 70);
    assert.equal(result.skipReason, null);
    const calendar = 100 / 90;
    const expected = Math.min(100 / 70, 1.5 * calendar);
    assert.ok(Math.abs(result.unconstrainedDaily - expected) < 1e-4);
    assert.equal(result.reconstructCapHit, false);
  });

  it('caps at 1.5× calendar daily', () => {
    const windowEnd = utcDate('2026-04-29');
    const windowStart = utcDate('2026-01-30');
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    const windowDays = rows.length;
    const sellDays = Math.ceil(windowDays * 0.32);
    for (const row of rows.slice(0, sellDays)) row.qtySold = 8;
    const result = unconstrainRecentDaily({
      sales: rows,
      windowStart,
      windowEnd,
      lifecycle: 'mature',
      firstSaleDate: '2024-01-01',
    });
    if (result.reconstructed) {
      assert.ok(result.unconstrainedDaily <= result.calendarDaily * 1.5 + 1e-9);
    }
  });
});
