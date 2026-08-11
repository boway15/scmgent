import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterMonthLabelsFromStart,
  formatBaselineWeightsLabel,
} from './forecast-sku-context.js';

describe('formatBaselineWeightsLabel', () => {
  it('formats lifecycle weights as percentages', () => {
    assert.equal(
      formatBaselineWeightsLabel({ w90: 0.5, w30: 0.3, wLy: 0.2, wCat: 0 }),
      '50% / 30% / 20% / 0%',
    );
  });

  it('formats new product weights', () => {
    assert.equal(
      formatBaselineWeightsLabel({ w90: 0, w30: 0.7, wLy: 0, wCat: 0.3 }),
      '0% / 70% / 0% / 30%',
    );
  });
});

describe('filterMonthLabelsFromStart', () => {
  it('slices from exact startMonth match', () => {
    assert.deepEqual(filterMonthLabelsFromStart(['2026-01', '2026-02', '2026-03'], '2026-02'), [
      '2026-02',
      '2026-03',
    ]);
  });

  it('keeps labels >= startMonth when exact match missing', () => {
    assert.deepEqual(filterMonthLabelsFromStart(['2026-03', '2026-04', '2026-05'], '2026-02'), [
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
  });

  it('returns empty when no labels meet startMonth', () => {
    assert.deepEqual(filterMonthLabelsFromStart(['2026-01', '2026-02'], '2026-06'), []);
  });
});
