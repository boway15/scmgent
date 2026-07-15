import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMonthlyQtyForTraining, detectMonthlyAnomalies } from './forecast-monthly-clean.js';

describe('forecast-monthly-clean', () => {
  it('flags stockout only after prior sales and promo months', () => {
    const flags = detectMonthlyAnomalies([0, 10, 10, 100, 10, 10]);
    assert.equal(flags[0], 'none');
    assert.equal(flags[3], 'promo');
    assert.equal(flags[1], 'none');
    const withGap = detectMonthlyAnomalies([10, 0, 10]);
    assert.equal(withGap[1], 'stockout');
  });

  it('fills stockout with category mean after prior sales', () => {
    const result = cleanMonthlyQtyForTraining([10, 0, 12, 8, 11, 9], {
      categoryMeanQty: 15,
    });
    assert.equal(result.cleaned[1], 15);
    assert.equal(result.cells[1]?.anomaly, 'stockout');
  });

  it('winsorizes promo spike', () => {
    const result = cleanMonthlyQtyForTraining([10, 10, 10, 200, 10, 10]);
    assert.ok(result.cleaned[3]! < 200);
    assert.equal(result.cells[3]?.anomaly, 'promo');
  });
});
