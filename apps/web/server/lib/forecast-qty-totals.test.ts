import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildForecastQtyTotalsResult,
  filterCompletedMonthKeys,
  formatQtyTotalsLabel,
  monthKey,
  parseMonthKey,
  resolveHorizonMonthKeys,
} from './forecast-qty-totals.js';

describe('forecast-qty-totals', () => {
  it('monthKey pads month', () => {
    assert.equal(monthKey(2026, 2), '2026-02');
  });

  it('resolveHorizonMonthKeys prefers distinct forecast months', () => {
    const keys = resolveHorizonMonthKeys({
      distinctMonths: ['2026-02', '2026-03'],
      startMonth: '2026-01',
      monthCount: 6,
      now: new Date(Date.UTC(2026, 7, 12)),
    });
    assert.deepEqual(keys, ['2026-02', '2026-03']);
  });

  it('resolveHorizonMonthKeys falls back to startMonth + monthCount', () => {
    const keys = resolveHorizonMonthKeys({
      distinctMonths: [],
      startMonth: '2026-02',
      monthCount: 3,
      now: new Date(Date.UTC(2026, 7, 12)),
    });
    assert.deepEqual(keys, ['2026-02', '2026-03', '2026-04']);
  });

  it('parseMonthKey parses YYYY-MM', () => {
    assert.deepEqual(parseMonthKey('2026-02'), { year: 2026, month: 2 });
    assert.equal(parseMonthKey('bad'), null);
  });

  it('filterCompletedMonthKeys drops current and future months', () => {
    assert.deepEqual(
      filterCompletedMonthKeys(
        ['2026-06', '2026-07', '2026-08', '2026-09'],
        new Date(Date.UTC(2026, 7, 12)),
      ),
      ['2026-06', '2026-07'],
    );
  });

  it('in_progress when horizon includes current month', () => {
    const r = buildForecastQtyTotalsResult({
      horizonMonthKeys: ['2026-07', '2026-08'],
      forecastQty: 100,
      actualQty: 90,
      now: new Date(Date.UTC(2026, 7, 12)),
    });
    assert.equal(r.status, 'in_progress');
    assert.equal(r.label, '进行中');
  });

  it('empty_actual when all months completed and actualQty is 0', () => {
    const r = buildForecastQtyTotalsResult({
      horizonMonthKeys: ['2026-02', '2026-03'],
      forecastQty: 100,
      actualQty: 0,
      now: new Date(Date.UTC(2026, 7, 12)),
    });
    assert.equal(r.status, 'empty_actual');
    assert.equal(r.label, '-');
  });

  it('ready formats thousands', () => {
    const r = buildForecastQtyTotalsResult({
      horizonMonthKeys: ['2026-02'],
      forecastQty: 12345,
      actualQty: 11900,
      now: new Date(Date.UTC(2026, 7, 12)),
    });
    assert.equal(r.status, 'ready');
    assert.equal(r.label, '12,345 / 11,900');
    assert.equal(formatQtyTotalsLabel('ready', 12345, 11900), '12,345 / 11,900');
  });
});
