import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMonthsQuery,
  buildForecastDrawerActualByMonth,
} from './forecast-drawer-actual.js';

describe('forecast-drawer-actual', () => {
  it('parses months query and drops empties', () => {
    assert.deepEqual(parseMonthsQuery('2026-03,2026-04, ,2026-05'), [
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
    assert.deepEqual(parseMonthsQuery(undefined), []);
  });

  it('returns null actual for future months', () => {
    const asOf = new Date('2026-08-11T12:00:00.000Z');
    const cells = buildForecastDrawerActualByMonth({
      monthLabels: ['2026-09'],
      qtyByMonthLabel: new Map([['2026-09', 100]]),
      asOf,
    });
    assert.deepEqual(cells, [
      { monthLabel: '2026-09', actualDailyAvg: null, inProgress: false },
    ]);
  });

  it('uses full calendar days for past months; zero when missing', () => {
    const asOf = new Date('2026-08-11T12:00:00.000Z');
    const cells = buildForecastDrawerActualByMonth({
      monthLabels: ['2026-06', '2026-07'],
      qtyByMonthLabel: new Map([['2026-06', 300]]),
      asOf,
    });
    assert.equal(cells[0]!.actualDailyAvg, 10); // 300/30
    assert.equal(cells[0]!.inProgress, false);
    assert.equal(cells[1]!.actualDailyAvg, 0);
    assert.equal(cells[1]!.inProgress, false);
  });

  it('uses elapsed UTC days for current month and marks inProgress', () => {
    const asOf = new Date('2026-08-11T12:00:00.000Z');
    const cells = buildForecastDrawerActualByMonth({
      monthLabels: ['2026-08'],
      qtyByMonthLabel: new Map([['2026-08', 110]]),
      asOf,
    });
    assert.deepEqual(cells, [
      { monthLabel: '2026-08', actualDailyAvg: 10, inProgress: true }, // 110/11
    ]);
  });
});
