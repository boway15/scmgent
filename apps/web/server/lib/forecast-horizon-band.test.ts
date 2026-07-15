import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  horizonBandFromIndex,
  horizonMonthIndex,
  summarizeAccuracyMatrix,
} from './forecast-horizon-band.js';
import { getKpiTarget, isKpiMet } from './forecast-kpi-targets.js';

describe('forecast-horizon-band', () => {
  it('maps horizon index to band', () => {
    assert.equal(horizonBandFromIndex(0), 'precision');
    assert.equal(horizonBandFromIndex(2), 'precision');
    assert.equal(horizonBandFromIndex(3), 'flex');
    assert.equal(horizonBandFromIndex(6), 'strategic');
  });

  it('computes horizon month index from asOf', () => {
    const asOf = new Date('2026-01-01T00:00:00.000Z');
    assert.equal(horizonMonthIndex(2026, 1, asOf), 0);
    assert.equal(horizonMonthIndex(2026, 3, asOf), 2);
    assert.equal(horizonMonthIndex(2026, 4, asOf), 3);
  });

  it('summarizes matrix with 12 segments', () => {
    const rows = [
      {
        skuCode: 'SKU-A',
        actualDaily: 10,
        forecastDaily: 12,
        mape: 0.2,
        biasRate: -0.17,
        forecastYear: 2026,
        month: 1,
      },
      {
        skuCode: 'SKU-A',
        actualDaily: 10,
        forecastDaily: 11,
        mape: 0.1,
        biasRate: -0.09,
        forecastYear: 2026,
        month: 2,
      },
    ];
    const matrix = summarizeAccuracyMatrix(rows, {
      asOf: new Date('2026-01-01T00:00:00.000Z'),
    });
    assert.equal(matrix.cells.length, 36);
    assert.equal(matrix.bySegment.length, 12);
  });
});

describe('forecast-kpi-targets', () => {
  it('returns A core precision target 15%', () => {
    assert.equal(getKpiTarget('A:core', 'precision'), 0.15);
    assert.equal(isKpiMet('A:core', 'precision', 0.14), 'pass');
    assert.equal(isKpiMet('A:core', 'precision', 0.2), 'fail');
  });

  it('marks display_only for C sku split', () => {
    assert.equal(isKpiMet('C:sku-mid', 'precision', 0.5, false), 'display_only');
  });
});
