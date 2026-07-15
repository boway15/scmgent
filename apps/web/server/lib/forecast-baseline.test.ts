import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTrendBounds,
  applyHorizonTrendDecay,
  buildMonthlyForecastHorizon,
  classifySalesLifecycle,
  clipCombinedSeasonality,
  collectStockoutExcludedDates,
  computeBaselineDailyAvg,
  computeForecastDailyAvgForMonth,
  computeHorizonBlendWeights,
  applyHorizonBiasBudgetCap,
  applyACoreUpperBound,
  computeLastYearSameMonthDailyAvg,
  parseHorizonFactors,
  computeLifecycleBaselineWeights,
  computeSkuTrendFactor,
  clipCombinedSeasonality,
  effectiveRecentWindowEnd,
  filterSalesRowsExcludingDates,
  resolveEffectiveLastYearDailyAvg,
  resolveLastYearSameMonthDailyAvg,
  roundDaily,
} from './forecast-baseline.js';

describe('forecast-baseline', () => {
  it('builds future monthly horizon from current calendar month', () => {
    assert.deepEqual(buildMonthlyForecastHorizon(new Date('2026-06-29'), 3), [
      { forecastYear: 2026, month: 6 },
      { forecastYear: 2026, month: 7 },
      { forecastYear: 2026, month: 8 },
    ]);
  });

  it('builds monthly horizon deterministically across year and UTC boundaries', () => {
    assert.deepEqual(buildMonthlyForecastHorizon(new Date('2026-12-15'), 2), [
      { forecastYear: 2026, month: 12 },
      { forecastYear: 2027, month: 1 },
    ]);

    assert.deepEqual(
      buildMonthlyForecastHorizon(new Date('2026-06-01T00:00:00.000Z'), 2),
      [
        { forecastYear: 2026, month: 6 },
        { forecastYear: 2026, month: 7 },
      ],
    );
  });

  it('classifies growth and decline lifecycles from recent velocity', () => {
    assert.equal(
      classifySalesLifecycle({
        ageDays: 365,
        salesDayRatio90: 0.8,
        recent30DailyAvg: 13,
        recent90DailyAvg: 10,
        maxZeroRunDays: 0,
      }),
      'growth',
    );

    assert.equal(
      classifySalesLifecycle({
        ageDays: 365,
        salesDayRatio90: 0.8,
        recent30DailyAvg: 7,
        recent90DailyAvg: 10,
        maxZeroRunDays: 0,
      }),
      'decline',
    );
  });

  it('classifies stockout, new, intermittent, and mature lifecycles by priority', () => {
    assert.equal(
      classifySalesLifecycle({
        ageDays: 180,
        salesDayRatio90: 0.9,
        recent30DailyAvg: 0,
        recent90DailyAvg: 5,
        maxZeroRunDays: 7,
      }),
      'stockout_suspected',
    );

    assert.equal(
      classifySalesLifecycle({
        ageDays: 89,
        salesDayRatio90: 0.9,
        recent30DailyAvg: 5,
        recent90DailyAvg: 5,
        maxZeroRunDays: 0,
      }),
      'new',
    );

    assert.equal(
      classifySalesLifecycle({
        ageDays: 180,
        salesDayRatio90: 0.09,
        recent30DailyAvg: 5,
        recent90DailyAvg: 5,
        maxZeroRunDays: 0,
      }),
      'intermittent',
    );

    assert.equal(
      classifySalesLifecycle({
        ageDays: 180,
        salesDayRatio90: 0.5,
        recent30DailyAvg: 10,
        recent90DailyAvg: 10,
        maxZeroRunDays: 0,
      }),
      'mature',
    );
  });

  it('does not classify new or intermittent SKUs as stockout without stable history', () => {
    assert.equal(
      classifySalesLifecycle({
        ageDays: 20,
        salesDayRatio90: 0.9,
        recent30DailyAvg: 0,
        recent90DailyAvg: 5,
        maxZeroRunDays: 7,
      }),
      'new',
    );

    assert.equal(
      classifySalesLifecycle({
        ageDays: 180,
        salesDayRatio90: 0.09,
        recent30DailyAvg: 0,
        recent90DailyAvg: 5,
        maxZeroRunDays: 7,
      }),
      'intermittent',
    );
  });

  it('computes weighted baseline with and without last year same month', () => {
    assert.equal(
      computeBaselineDailyAvg({
        recent30DailyAvg: 12,
        recent90DailyAvg: 10,
        lastYearSameMonthDailyAvg: 8,
        lifecycle: 'mature',
      }),
      10.2,
    );

    assert.equal(
      computeBaselineDailyAvg({
        recent30DailyAvg: 12,
        recent90DailyAvg: 10,
        lifecycle: 'mature',
      }),
      10.7,
    );
  });

  it('raises growth lifecycle baseline weight on recent 30d window', () => {
    const mature = computeBaselineDailyAvg({
      recent30DailyAvg: 12,
      recent90DailyAvg: 10,
      lifecycle: 'mature',
    });
    const growth = computeBaselineDailyAvg({
      recent30DailyAvg: 12,
      recent90DailyAvg: 10,
      lifecycle: 'growth',
    });
    assert.ok(growth > mature);
  });

  it('computes sku trend factor and horizon decay', () => {
    assert.equal(computeSkuTrendFactor(13, 10, 'growth'), 1.3);
    assert.equal(applyHorizonTrendDecay(1.2, 6), 1);
    assert.ok(applyHorizonTrendDecay(1.2, 0) > 1);
  });

  it('clips out-of-bounds seasonality instead of discarding', () => {
    const clipped = clipCombinedSeasonality(1.5);
    assert.equal(clipped.factor, 1.15);
    assert.equal(clipped.wasClipped, true);
  });

  it('clamps negative inputs and rounds baseline daily average', () => {
    assert.equal(
      computeBaselineDailyAvg({
        recent30DailyAvg: -10,
        recent90DailyAvg: 0,
        categoryReferenceDailyAvg: 3.333333,
      }),
      1,
    );
    assert.equal(roundDaily(1.23456), 1.2346);
  });

  it('applies only finite positive trend factors within bounds', () => {
    assert.deepEqual(applyTrendBounds(1.2), { factor: 1.2, applied: true });
    assert.deepEqual(applyTrendBounds(0.7), { factor: 0.7, applied: true });
    assert.deepEqual(applyTrendBounds(1.3), { factor: 1.3, applied: true });
    assert.deepEqual(applyTrendBounds(0), { factor: 1, applied: false });
    assert.deepEqual(applyTrendBounds(Number.NaN), { factor: 1, applied: false });
    assert.deepEqual(applyTrendBounds(1.5), { factor: 1.5, applied: false });
  });

  it('derives last year same month daily average from daily sales rows', () => {
    const rows = [
      { saleDate: '2025-07-01', qtySold: 10 },
      { saleDate: '2025-07-15', qtySold: 20 },
      { saleDate: '2025-08-01', qtySold: 100 },
    ];

    assert.equal(computeLastYearSameMonthDailyAvg(rows, 2026, 7), roundDaily(30 / 31));
    assert.equal(computeLastYearSameMonthDailyAvg(rows, 2026, 8), roundDaily(100 / 31));
  });

  it('applies seasonality and trend per forecast month on top of horizon-aware baseline', () => {
    const result = computeForecastDailyAvgForMonth({
      recent30DailyAvg: 12,
      recent90DailyAvg: 10,
      lastYearSameMonthDailyAvg: 8,
      seasonalityFactor: 1.1,
      trendFactor: 1.1,
      horizonMonthIndex: 0,
      calendarMonth: 7,
      lifecycle: 'stockout_suspected',
    });

    assert.ok(result.baselineDailyAvg > 0);
    const seasonality = clipCombinedSeasonality(1.1).factor;
    const trend = clipCombinedSeasonality(1.1).factor;
    assert.equal(result.forecastDailyAvg, roundDaily(result.baselineDailyAvg * seasonality * trend));
    assert.equal(result.categoryTrendApplied, true);
    assert.equal(result.horizonFactors.wNear, 0.65);
    assert.ok(result.horizonFactors.nearLevel > 0);
  });

  it('shifts toward YoY structural level as horizon month index increases', () => {
    const monthlyRows = [
      { saleYear: 2024, month: 7, qtySold: 3100 },
      { saleYear: 2025, month: 7, qtySold: 3500 },
      { saleYear: 2024, month: 8, qtySold: 2400 },
      { saleYear: 2025, month: 8, qtySold: 2800 },
    ];
    const near = computeForecastDailyAvgForMonth({
      recent30DailyAvg: 60,
      recent90DailyAvg: 50,
      lastYearSameMonthDailyAvg: 100,
      lifecycle: 'mature',
      horizonMonthIndex: 0,
      calendarMonth: 7,
      monthlyRows,
      yoyAnchorDailyAvg: 80,
      seasonalityFactor: 1,
      trendFactor: 1,
    }).baselineDailyAvg;
    const far = computeForecastDailyAvgForMonth({
      recent30DailyAvg: 60,
      recent90DailyAvg: 50,
      lastYearSameMonthDailyAvg: 100,
      lifecycle: 'mature',
      horizonMonthIndex: 8,
      calendarMonth: 3,
      monthlyRows,
      yoyAnchorDailyAvg: 80,
      seasonalityFactor: 1,
      trendFactor: 1,
    }).baselineDailyAvg;
    assert.ok(far > near * 0.9);
  });

  it('horizon blend weights favor YoY at long horizons', () => {
    assert.deepEqual(computeHorizonBlendWeights(0), { wNear: 0.65, wYoy: 0.35 });
    assert.deepEqual(computeHorizonBlendWeights(8), { wNear: 0.1, wYoy: 0.9 });
  });

  it('varies forecast across horizon months with calendar seasonality and decay', () => {
    const monthlyRows = [
      { saleYear: 2024, month: 7, qtySold: 3100 },
      { saleYear: 2024, month: 8, qtySold: 2400 },
      { saleYear: 2024, month: 9, qtySold: 1800 },
      { saleYear: 2025, month: 7, qtySold: 3200 },
      { saleYear: 2025, month: 8, qtySold: 2500 },
      { saleYear: 2025, month: 9, qtySold: 1900 },
    ];
    const forecasts = [7, 8, 9].map((month, index) =>
      computeForecastDailyAvgForMonth({
        recent30DailyAvg: 48,
        recent90DailyAvg: 58,
        lastYearSameMonthDailyAvg: resolveEffectiveLastYearDailyAvg({
          dailyRows: [],
          monthlyRows,
          forecastYear: 2026,
          month,
        }),
        lifecycle: 'stockout_suspected',
        horizonMonthIndex: index,
        seasonalityFactor: month === 7 ? 1.15 : month === 8 ? 1.0 : 0.85,
        trendFactor: month === 7 ? 1.05 : month === 8 ? 1.0 : 0.95,
      }).forecastDailyAvg,
    );
    assert.equal(new Set(forecasts).size, forecasts.length);
  });

  it('parses persisted horizon factor snapshots', () => {
    const parsed = parseHorizonFactors({
      nearLevel: 58,
      structuralLevel: 62,
      yoyMonthLevel: 100,
      yoyAnchorLevel: 80,
      growthFactor: 1.05,
      wNear: 0.1,
      wYoy: 0.9,
      horizonMonthIndex: 8,
    });
    assert.deepEqual(parsed?.wNear, 0.1);
    assert.equal(parsed?.horizonMonthIndex, 8);
  });

  it('clips out-of-bounds combined seasonality factors', () => {
    const result = computeForecastDailyAvgForMonth({
      recent30DailyAvg: 10,
      recent90DailyAvg: 10,
      lastYearSameMonthDailyAvg: 0,
      seasonalityFactor: 1.5,
      trendFactor: 1,
      lifecycle: 'stockout_suspected',
    });

    assert.equal(result.forecastDailyAvg, roundDaily(10 * 1.15 * 1));
    assert.equal(result.seasonalityWasClipped, true);
    assert.equal(result.combinedTrendFactor, 1.15);
  });

  it('uses monthly history when daily rows do not cover last year same month', () => {
    assert.equal(
      resolveLastYearSameMonthDailyAvg({
        dailyRows: [{ saleDate: '2026-06-01', qtySold: 3 }],
        monthlyRows: [{ saleYear: 2025, month: 7, qtySold: 310 }],
        forecastYear: 2026,
        month: 7,
      }),
      10,
    );
  });

  it('caps recent window at prior month-end when current month is incomplete', () => {
    assert.equal(
      effectiveRecentWindowEnd(new Date('2026-06-26')).toISOString().slice(0, 10),
      '2026-05-31',
    );
    assert.equal(
      effectiveRecentWindowEnd(new Date('2026-05-31')).toISOString().slice(0, 10),
      '2026-05-31',
    );
  });

  it('excludes consecutive zero-qty runs from stockout filtering', () => {
    const rows = [
      { saleDate: '2026-06-01', qtySold: 5 },
      { saleDate: '2026-06-02', qtySold: 0 },
      { saleDate: '2026-06-03', qtySold: 0 },
      { saleDate: '2026-06-04', qtySold: 0 },
      { saleDate: '2026-06-05', qtySold: 0 },
      { saleDate: '2026-06-06', qtySold: 0 },
      { saleDate: '2026-06-07', qtySold: 0 },
      { saleDate: '2026-06-08', qtySold: 0 },
      { saleDate: '2026-06-09', qtySold: 3 },
    ];
    const excluded = collectStockoutExcludedDates(
      rows,
      new Date('2026-06-01'),
      new Date('2026-06-09'),
      7,
    );
    assert.equal(excluded.size, 7);
    const filtered = filterSalesRowsExcludingDates(rows, excluded);
    assert.deepEqual(
      filtered.map((row) => row.saleDate),
      ['2026-06-01', '2026-06-09'],
    );
  });

  it('intermittent lifecycle caps forecast without seasonality', () => {
    const result = computeForecastDailyAvgForMonth({
      recent30DailyAvg: 0.5,
      recent90DailyAvg: 2,
      lastYearSameMonthDailyAvg: 10,
      lifecycle: 'intermittent',
      horizonMonthIndex: 0,
      seasonalityFactor: 1.2,
      trendFactor: 1.1,
      calendarMonth: 6,
    });
    assert.ok(result.forecastDailyAvg <= 2.3);
    assert.equal(result.combinedTrendFactor, 1);
  });

  it('new lifecycle suppresses growth factor and far-month structural', () => {
    const near = computeForecastDailyAvgForMonth({
      recent30DailyAvg: 3,
      recent90DailyAvg: 2,
      lastYearSameMonthDailyAvg: 0,
      lifecycle: 'new',
      horizonMonthIndex: 0,
      calendarMonth: 3,
      monthlyRows: [],
      refYear: 2025,
      refMonth: 12,
    });
    const far = computeForecastDailyAvgForMonth({
      recent30DailyAvg: 3,
      recent90DailyAvg: 2,
      lastYearSameMonthDailyAvg: 0,
      lifecycle: 'new',
      horizonMonthIndex: 5,
      calendarMonth: 8,
      monthlyRows: [],
      refYear: 2025,
      refMonth: 12,
    });
    assert.equal(near.horizonFactors.growthFactor, 1);
    assert.ok(far.forecastDailyAvg <= near.forecastDailyAvg * 1.5);
  });

  it('declining mature SKU uses lower w_near at k=0', () => {
    const weights = computeHorizonBlendWeights(0, { decliningNearBias: true });
    assert.equal(weights.wNear, 0.5);
    assert.equal(weights.wYoy, 0.5);
  });

  it('applies horizon bias budget cap for mature flat SKU with inflated growth', () => {
    const cappedNear = applyHorizonBiasBudgetCap({
      forecastDailyAvg: 92,
      recent30DailyAvg: 131,
      recent90DailyAvg: 131,
      horizonMonthIndex: 0,
      lifecycle: 'mature',
      growthFactor: 1.3,
    });
    assert.ok(cappedNear < 92);
    assert.ok(cappedNear <= 82);

    const cappedFar = applyHorizonBiasBudgetCap({
      forecastDailyAvg: 158,
      recent30DailyAvg: 131,
      recent90DailyAvg: 131,
      horizonMonthIndex: 4,
      lifecycle: 'mature',
      growthFactor: 1.3,
    });
    assert.ok(cappedFar < 158);
    assert.ok(cappedFar <= 88);
  });

  it('caps A core over-forecast to recent anchor headroom', () => {
    const capped = applyACoreUpperBound({
      forecastDailyAvg: 123,
      recent30DailyAvg: 110,
      recent90DailyAvg: 95,
      horizonMonthIndex: 0,
      lifecycle: 'mature',
    });
    assert.ok(capped < 123);
    assert.ok(capped <= 95 * 1.06 + 0.01);
  });

  it('uses recent30 anchor when sales are declining below ratio threshold', () => {
    const capped = applyACoreUpperBound({
      forecastDailyAvg: 100,
      recent30DailyAvg: 50,
      recent90DailyAvg: 100,
      horizonMonthIndex: 0,
      lifecycle: 'decline',
      aCoreConfig: {
        k0Recent30Weight: 0.7,
        k1Recent30Weight: 0.55,
        upperHeadroom: [1.06, 1.08, 1.1, 1.12, 1.15, 1.18],
        declineRecent30Ratio: 0.85,
      },
    });
    assert.ok(capped <= 50 * 1.06 + 0.01);
    assert.ok(capped < 100 * 1.06);
  });
});
