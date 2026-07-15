import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSeasonalityFactors,
  monthKeysEndingAt,
  resolveSeasonalityAnchor,
} from './forecast-collaboration.js';

describe('forecast-seasonality-calc', () => {
  it('monthKeysEndingAt includes the end month (当月)', () => {
    assert.deepEqual(monthKeysEndingAt(2026, 6, 3), ['2026-04', '2026-05', '2026-06']);
  });

  it('resolveSeasonalityAnchor uses asOf month for current calendar month', () => {
    assert.deepEqual(resolveSeasonalityAnchor(2026, 6, 6), { endYear: 2026, endMonth: 6 });
    assert.deepEqual(resolveSeasonalityAnchor(2026, 6, 5), { endYear: 2026, endMonth: 5 });
    assert.deepEqual(resolveSeasonalityAnchor(2026, 6, 8), { endYear: 2025, endMonth: 8 });
  });

  it('computes conservative seasonality for current month', () => {
    const asOf = new Date('2026-06-15T00:00:00.000Z');
    const factors = computeSeasonalityFactors(
      [
        { dimensionType: 'category', dimensionValue: 'Patio', month: '2025-01', qtySold: 80 },
        { dimensionType: 'category', dimensionValue: 'Patio', month: '2025-02', qtySold: 85 },
        { dimensionType: 'category', dimensionValue: 'Patio', month: '2025-03', qtySold: 90 },
        { dimensionType: 'category', dimensionValue: 'Patio', month: '2025-04', qtySold: 80 },
        { dimensionType: 'category', dimensionValue: 'Patio', month: '2025-05', qtySold: 100 },
        { dimensionType: 'category', dimensionValue: 'Patio', month: '2025-06', qtySold: 120 },
        { dimensionType: 'category', dimensionValue: 'Patio', month: '2026-01', qtySold: 90 },
        { dimensionType: 'category', dimensionValue: 'Patio', month: '2026-02', qtySold: 95 },
        { dimensionType: 'category', dimensionValue: 'Patio', month: '2026-03', qtySold: 98 },
        { dimensionType: 'category', dimensionValue: 'Patio', month: '2026-04', qtySold: 100 },
        { dimensionType: 'category', dimensionValue: 'Patio', month: '2026-05', qtySold: 110 },
        { dimensionType: 'category', dimensionValue: 'Patio', month: '2026-06', qtySold: 150 },
      ],
      asOf,
    );

    const june = factors.find((f) => f.dimensionValue === 'Patio' && f.month === 6)!;
    assert.ok(june.seasonalityFactor > 0);
    assert.ok(june.trendFactor > 0);
    assert.equal(factors.filter((f) => f.dimensionValue === 'Patio').length, 12);
  });
});
