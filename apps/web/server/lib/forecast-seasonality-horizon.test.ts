import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHorizonCellsForDimension, buildHistoricalCellsForDimension } from './forecast-seasonality-horizon.js';

describe('forecast-seasonality-horizon', () => {
  it('maps calendar-month factors onto absolute forecast horizon months', () => {
    const byMonth = new Map([
      [7, { seasonalityFactor: 1.2, trendFactor: 1.1 }],
      [8, { seasonalityFactor: 0.9, trendFactor: 1.0 }],
    ]);

    const cells = buildHorizonCellsForDimension(byMonth, 2, new Date('2026-06-15T00:00:00Z'));

    assert.equal(cells.length, 2);
    assert.equal(cells[0]!.monthLabel, '2026-07');
    assert.equal(cells[0]!.seasonalityFactor, 1.2);
    assert.equal(cells[0]!.combinedFactor, 1.3);
    assert.equal(cells[0]!.wasClipped, true);
    assert.equal(cells[1]!.monthLabel, '2026-08');
    assert.equal(cells[1]!.combinedFactor, 0.9);
  });

  it('builds historical cells replaying factors month by month', () => {
    const qtyByMonth = new Map([
      ['2025-04', 80],
      ['2025-05', 100],
      ['2025-06', 120],
      ['2026-04', 100],
      ['2026-05', 110],
      ['2026-06', 150],
    ]);
    const cells = buildHistoricalCellsForDimension(qtyByMonth, 2, new Date('2026-06-15T00:00:00Z'));
    assert.equal(cells.length, 2);
    assert.equal(cells[0]!.monthLabel, '2026-04');
    assert.equal(cells[1]!.monthLabel, '2026-05');
    assert.ok(!cells.some((cell) => cell.monthLabel === '2026-06'));
  });
});
