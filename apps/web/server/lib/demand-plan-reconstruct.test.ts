import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  championRefLevel,
  classifyDemandPlanLifecycle,
  classifyReconstructSource,
  clipDemandShape,
  hasForecastShape,
  lastYearIsoWeekKey,
  lastYearSameWeekDailyAvg,
  systemDailyAvgForMonth,
  systemDailyAvgForWeek,
  systemDailyAvgForWeekFromMonthlyAlgo,
  warehouseShareWeight,
  weekForecastDailyForPlan,
  weekIndexToHorizonMonthIndex,
  weekWeightedForecastDaily,
} from './demand-plan-reconstruct.js';
import { computeHorizonBlendWeights } from './forecast-baseline.js';

describe('demand-plan-reconstruct', () => {
  it('clips shape to 0.5–2.0', () => {
    assert.equal(clipDemandShape(0.1), 0.5);
    assert.equal(clipDemandShape(3), 2);
    assert.equal(clipDemandShape(1.2), 1.2);
  });

  it('returns null share when warehouse missing', () => {
    assert.equal(warehouseShareWeight('US-WEST', [{ warehouse: 'US-EAST', weight: 1 }]), null);
    assert.equal(warehouseShareWeight('US-WEST', [{ warehouse: 'US-WEST', weight: 0.4 }]), 0.4);
  });

  it('uses first three positive months as champion ref', () => {
    assert.equal(championRefLevel([10, 10, 10, 20]), 10);
    assert.equal(championRefLevel([0, 0]), 0);
  });

  it('scales unconstrained by share and clipped shape', () => {
    const daily = systemDailyAvgForMonth({
      unconstrainedRecentDaily: 10,
      share: 0.5,
      monthForecastDaily: 20,
      championRefDaily: 10,
    });
    assert.equal(daily, 10); // 10 * 0.5 * clip(2)=10
  });

  it('classifies fallback without availability', () => {
    assert.equal(
      classifyReconstructSource({ hasAvailabilitySeries: false, inStockDays: 0 }),
      'fallback_forecast',
    );
    assert.equal(
      classifyReconstructSource({ hasAvailabilitySeries: true, inStockDays: 8 }),
      'reconstructed_shape',
    );
  });

  it('weights a split week by calendar days', () => {
    const monthly = new Map([['2026-01', 10], ['2026-02', 20]]);
    const daily = weekWeightedForecastDaily('2026-W05', monthly);
    assert.equal(daily, Math.round(((10 * 6 + 20 * 1) / 7) * 10000) / 10000);
  });

  it('treats missing month as 0 and does not fill from F_ref', () => {
    const monthly = new Map([['2026-01', 10]]);
    const daily = weekWeightedForecastDaily('2026-W05', monthly);
    assert.equal(daily, Math.round(((10 * 6 + 0 * 1) / 7) * 10000) / 10000);
  });

  it('maps weekIndex to horizon month index by fours', () => {
    assert.equal(weekIndexToHorizonMonthIndex(0), 0);
    assert.equal(weekIndexToHorizonMonthIndex(3), 0);
    assert.equal(weekIndexToHorizonMonthIndex(4), 1);
    assert.equal(weekIndexToHorizonMonthIndex(24), 6);
  });

  it('blends near U×shape with far F_w by weekIndex (k=0 near-biased)', () => {
    // near = 10 * 1 * clip(20/10) = 20; far = 20; k=0 → 0.65*20+0.35*20 = 20
    const daily = systemDailyAvgForWeek({
      unconstrainedRecentDaily: 10,
      share: 1,
      weekForecastDaily: 20,
      championRefDaily: 10,
      weekIndex: 0,
    });
    assert.equal(daily, 20);
  });

  it('weekIndex=0 prefers near when U×shape differs from F_w', () => {
    // shape=1 → near=20; far=10; k=0 → 0.65*20+0.35*10
    const { wNear, wYoy } = computeHorizonBlendWeights(0);
    const daily = systemDailyAvgForWeek({
      unconstrainedRecentDaily: 20,
      share: 1,
      weekForecastDaily: 10,
      championRefDaily: 10,
      weekIndex: 0,
    });
    assert.equal(daily, Math.round((20 * wNear + 10 * wYoy) * 10000) / 10000);
  });

  it('weekIndex≥24 (k≥6) prefers far absolute month daily', () => {
    // near=20; far=10; k=6 → 0.1*20+0.9*10
    const { wNear, wYoy } = computeHorizonBlendWeights(6);
    const daily = systemDailyAvgForWeek({
      unconstrainedRecentDaily: 20,
      share: 1,
      weekForecastDaily: 10,
      championRefDaily: 10,
      weekIndex: 24,
    });
    assert.equal(daily, Math.round((20 * wNear + 10 * wYoy) * 10000) / 10000);
  });

  it('falls back to near when F_w is 0', () => {
    // championRef≤0 → shape=1 → near=10；farRaw=0 → far=near → 远端权重也回到 near
    const daily = systemDailyAvgForWeek({
      unconstrainedRecentDaily: 10,
      share: 1,
      weekForecastDaily: 0,
      championRefDaily: 0,
      weekIndex: 24,
    });
    assert.equal(daily, 10);
  });

  it('hasForecastShape is true when any horizon month has daily > 0', () => {
    const map = new Map([['2026-09', 5], ['2026-10', 0]]);
    assert.equal(hasForecastShape(map, ['2026-09', '2026-10', '2026-11']), true);
    assert.equal(hasForecastShape(map, ['2026-11', '2026-12']), false);
  });

  it('weekForecastDailyForPlan falls back to flat daily without forecast shape', () => {
    const monthly = new Map([['2026-01', 30]]);
    assert.equal(
      weekForecastDailyForPlan({
        weekKey: '2026-W05',
        monthlyDaily: monthly,
        flatDaily: 8,
        useForecastShape: false,
      }),
      8,
    );
  });

  it('maps last year same ISO week', () => {
    assert.equal(lastYearIsoWeekKey('2026-W45'), '2025-W45');
    assert.equal(lastYearIsoWeekKey('bad'), null);
  });

  it('averages last year same week daily from daily rows', () => {
    const daily = lastYearSameWeekDailyAvg(
      [
        { saleDate: '2025-11-03', qtySold: 7 },
        { saleDate: '2025-11-04', qtySold: 7 },
        { saleDate: '2025-11-10', qtySold: 99 },
      ],
      '2026-W45',
    );
    assert.equal(daily, 2);
  });

  it('monthly-algo weekly forecast fluctuates with calendar-month history', () => {
    const monthlyRows = [
      { saleYear: 2025, month: 1, qtySold: 90 },
      { saleYear: 2025, month: 11, qtySold: 450 },
    ];
    const winter = systemDailyAvgForWeekFromMonthlyAlgo({
      recent30DailyAvg: 10,
      recent90DailyAvg: 10,
      lastYearSameWeekDailyAvg: 0,
      weekForecastDaily: 0,
      weekIndex: 8,
      calendarMonth: 1,
      seasonalityFactor: 1,
      trendFactor: 1,
      lifecycle: 'mature',
      monthlyRows,
    });
    const peak = systemDailyAvgForWeekFromMonthlyAlgo({
      recent30DailyAvg: 10,
      recent90DailyAvg: 10,
      lastYearSameWeekDailyAvg: 0,
      weekForecastDaily: 0,
      weekIndex: 8,
      calendarMonth: 11,
      seasonalityFactor: 1,
      trendFactor: 1,
      lifecycle: 'mature',
      monthlyRows,
    });
    assert.ok(peak.systemDailyAvg > winter.systemDailyAvg);
  });

  it('monthly-algo weekly forecast fluctuates with last-year same week', () => {
    const winter = systemDailyAvgForWeekFromMonthlyAlgo({
      recent30DailyAvg: 10,
      recent90DailyAvg: 10,
      lastYearSameWeekDailyAvg: 6,
      weekForecastDaily: 0,
      weekIndex: 4,
      calendarMonth: 1,
      seasonalityFactor: 1,
      trendFactor: 1,
      lifecycle: 'mature',
    });
    const peak = systemDailyAvgForWeekFromMonthlyAlgo({
      recent30DailyAvg: 10,
      recent90DailyAvg: 10,
      lastYearSameWeekDailyAvg: 18,
      weekForecastDaily: 0,
      weekIndex: 4,
      calendarMonth: 11,
      seasonalityFactor: 1,
      trendFactor: 1,
      lifecycle: 'mature',
    });
    assert.ok(peak.systemDailyAvg > winter.systemDailyAvg);
  });

  it('classifies mature lifecycle from continuous recent sales', () => {
    const sales = Array.from({ length: 90 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 7, 1 + index));
      return { saleDate: day.toISOString().slice(0, 10), qtySold: 3 };
    });
    assert.equal(
      classifyDemandPlanLifecycle({
        sales,
        windowEnd: new Date(Date.UTC(2026, 9, 29)),
        firstSaleDate: '2024-01-01',
      }),
      'mature',
    );
  });
});
