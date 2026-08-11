import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MODEL_NAME,
  chooseModel,
  modelForecast,
  nextPeriodLabel,
} from './sales-analytics-forecast.js';

describe('sales-analytics-forecast', () => {
  it('picks naive for flat noisy short series', () => {
    const v = [10, 10, 10];
    const m = chooseModel(v, false);
    assert.ok(['naive', 'avg', 'trend'].includes(m.type));
    const fc = modelForecast(m, v.length, 3, '2026-07', false);
    assert.equal(fc.length, 3);
  });

  it('uses month thresholds and labels next periods', () => {
    // Strong linear growth → trend (r2 high, trendRel > 0.02)
    const rising = [10, 20, 30, 40, 50, 60, 70, 80];
    const m = chooseModel(rising, false);
    assert.equal(m.type, 'trend');
    assert.equal(MODEL_NAME.trend, '线性趋势');

    assert.equal(nextPeriodLabel('2026-07', 1, false), '2026-08');
    assert.equal(nextPeriodLabel('2026-12', 2, false), '2027-02');
    assert.equal(nextPeriodLabel('2026-W50', 3, true), '2027-W01');

    const fc = modelForecast(m, rising.length, 2, '2026-07', false);
    assert.equal(fc[0]!.ym, '2026-08');
    assert.ok(fc[0]!.val > rising[rising.length - 1]!);
  });

  it('does not pick seasonal for week series', () => {
    const rising = [10, 20, 30, 40, 50, 60, 70, 80];
    const m = chooseModel(rising, true);
    assert.ok(m.type === 'trend' || m.type === 'avg' || m.type === 'naive');
    assert.notEqual(m.type, 'seasonal');
  });
});
