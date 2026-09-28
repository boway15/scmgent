import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildRecentHistoryWeekKeys,
  buildWeeklyActualFromDaily,
  expandMonthlyForecastToWeeks,
} from './demand-plan-sku-detail.js';

describe('demand-plan-sku-detail', () => {
  it('builds 26 recent ISO week keys ending at window end week', () => {
    const weeks = buildRecentHistoryWeekKeys(new Date('2026-03-15T00:00:00.000Z'), 26);
    assert.equal(weeks.length, 26);
    assert.equal(weeks[weeks.length - 1], '2026-W11');
    assert.match(weeks[0]!, /^\d{4}-W\d{2}$/);
    assert.notEqual(weeks[0], weeks[weeks.length - 1]);
  });

  it('aggregates weekly actual daily with in-progress current week', () => {
    const windowEnd = new Date('2026-03-11T00:00:00.000Z');
    const rows = buildWeeklyActualFromDaily({
      weekKeys: ['2026-W10', '2026-W11'],
      dailyRows: [
        { saleDate: '2026-03-02', qtySold: 70 },
        { saleDate: '2026-03-09', qtySold: 30 },
        { saleDate: '2026-03-10', qtySold: 20 },
        { saleDate: '2026-03-11', qtySold: 10 },
      ],
      windowEnd,
    });
    assert.equal(rows[0]?.qtySold, 70);
    assert.equal(rows[0]?.actualDailyAvg, 10);
    assert.equal(rows[0]?.inProgress, false);
    assert.equal(rows[1]?.qtySold, 60);
    assert.equal(rows[1]?.inProgress, true);
  });

  it('expands monthly forecast to weekly using day weights', () => {
    const rows = expandMonthlyForecastToWeeks({
      weekKeys: ['2026-W10'],
      monthCells: [
        {
          id: '1',
          forecastYear: 2026,
          month: 3,
          monthLabel: '2026-03',
          forecastDailyAvg: 3,
          effectiveDailyAvg: 4,
          manualDailyAvg: 4,
          adjustReason: null,
          baselineDailyAvg: 2,
          lifecycle: null,
          confidenceLevel: 'high',
          skuTrendFactor: null,
          seasonalityFactor: 1,
          trendFactor: 1,
          categoryCombinedFactor: 1,
          categoryTrendWasClipped: false,
          categoryTrendMatched: true,
          horizonFactors: null,
          allCatV41Factors: null,
          forecastModel: null,
        },
      ],
      actualByWeek: new Map(),
      planByWeek: new Map(),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.systemDailyAvg, 3);
    assert.equal(rows[0]?.effectiveDailyAvg, 4);
    assert.equal(rows[0]?.hasManual, true);
    assert.equal(rows[0]?.anchorMonthLabel, '2026-03');
  });
});
