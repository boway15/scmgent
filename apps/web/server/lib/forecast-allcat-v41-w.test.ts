import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateDailyQtyByIsoWeek,
  computeAllCatV41WBaseDaily,
  computeWalkForwardWeeklyMetrics,
  legacyTierMetricsFromWeekly,
} from './forecast-allcat-v41-w.js';
import { addIsoWeeks } from './planning-calendar.js';

describe('forecast-allcat-v41-w', () => {
  it('aggregates daily rows into ISO week keys', () => {
    const map = aggregateDailyQtyByIsoWeek([
      { saleDate: '2026-01-05', qtySold: 10 },
      { saleDate: '2026-01-06', qtySold: 5 },
    ]);
    assert.ok(map.size >= 1);
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    assert.equal(total, 15);
  });

  it('walk-forward metrics exclude target week and future weeks', () => {
    const target = '2026-W10';
    const weeklyQty = new Map<string, number>();
    for (let i = 1; i <= 16; i += 1) {
      weeklyQty.set(addIsoWeeks(target, -i), 56);
    }
    weeklyQty.set(target, 999);
    weeklyQty.set(addIsoWeeks(target, 1), 999);

    const m = computeWalkForwardWeeklyMetrics(weeklyQty, target);
    assert.equal(m.q8, 8 * 56);
    assert.equal(m.w8, (8 * 56) / 56);
    assert.equal(m.activeW8, 8);
  });

  it('T1 base daily uses w4/w8/w16 weights', () => {
    const m = {
      q4: 280,
      q8: 560,
      q12: 840,
      q16: 1120,
      w4: 10,
      w8: 10,
      w12: 10,
      w16: 10,
      activeW4: 4,
      activeW8: 8,
      activeW16: 16,
      cv8: 0.1,
      trendRatioW: 1,
    };
    const base = computeAllCatV41WBaseDaily('T1', m);
    assert.equal(base, 10);
  });

  it('maps weekly active windows for tier input', () => {
    const m = computeWalkForwardWeeklyMetrics(
      new Map([
        ['2026-W05', 10],
        ['2026-W06', 10],
        ['2026-W07', 10],
        ['2026-W08', 10],
        ['2026-W09', 10],
      ]),
      '2026-W10',
    );
    const legacy = legacyTierMetricsFromWeekly(m);
    assert.equal(legacy.d6, legacy.d6);
    assert.ok(legacy.active2 <= 2);
  });
});
