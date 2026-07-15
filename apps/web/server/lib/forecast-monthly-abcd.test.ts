import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMonthlyAbcdCPoolContext,
  computeDynamicSkuShare,
  computeMonthlyAbcdForecastDailyAvg,
  inferLifecycleFromMonthly,
  median6MonthlyQty,
  monthlyQtyToDailyAvg,
  poolWeightedMonthlyQty,
  seasonalNaiveMonthlyQty,
  trendForecastMonthlyQty,
} from './forecast-monthly-abcd.js';
import { resolveForecastAlgoMode } from './forecast-algo-mode.js';

describe('forecast-monthly-abcd', () => {
  it('seasonal naive repeats last-12 pattern', () => {
    const qty = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
    assert.equal(seasonalNaiveMonthlyQty(qty, 0), 10);
    assert.equal(seasonalNaiveMonthlyQty(qty, 11), 120);
    assert.equal(seasonalNaiveMonthlyQty(qty, 12), 10);
  });

  it('trend extrapolates upward series', () => {
    const qty = [10, 20, 30, 40, 50, 60];
    const h0 = trendForecastMonthlyQty(qty, 0);
    const h1 = trendForecastMonthlyQty(qty, 1);
    assert.ok(h1 > h0);
    assert.ok(h0 >= 60);
  });

  it('median6 uses recent six months', () => {
    assert.equal(median6MonthlyQty([1, 2, 3, 4, 5, 6, 100]), 4.5);
  });

  it('converts monthly qty to daily avg by calendar days', () => {
    assert.equal(monthlyQtyToDailyAvg(31, 2026, 1), 1);
    assert.equal(monthlyQtyToDailyAvg(28, 2026, 2), 1);
  });

  it('A class uses near_anchor when daily anchors provided', () => {
    const qty = [900, 930, 960, 900, 930, 960, 900, 930, 960, 900, 930, 960];
    const result = computeMonthlyAbcdForecastDailyAvg({
      profileClass: 'A',
      monthlyQty: qty,
      horizonIndex: 0,
      forecastYear: 2026,
      forecastMonth: 1,
      recent30DailyAvg: 30,
      recent90DailyAvg: 28,
      lifecycle: 'mature',
      profileSegment: 'A:core',
      volumeTier: 'core',
    });
    assert.ok(result.forecastDailyAvg > 0);
    assert.equal(result.model, 'near_anchor');
  });

  it('D class returns zero when no recent sales', () => {
    const result = computeMonthlyAbcdForecastDailyAvg({
      profileClass: 'D',
      monthlyQty: [0, 0, 0, 0, 0, 0],
      horizonIndex: 0,
      forecastYear: 2026,
      forecastMonth: 1,
      recent30DailyAvg: 0,
      recent90DailyAvg: 0,
    });
    assert.equal(result.forecastDailyAvg, 0);
    assert.equal(result.model, 'zero_sales');
  });

  it('D class returns zero by default (ghost 防控)', () => {
    const result = computeMonthlyAbcdForecastDailyAvg({
      profileClass: 'D',
      monthlyQty: [50, 40, 30, 20, 25, 22, 18, 15, 12, 10, 8, 6],
      horizonIndex: 0,
      forecastYear: 2026,
      forecastMonth: 1,
      recent30DailyAvg: 2,
      recent90DailyAvg: 1,
    });
    assert.equal(result.forecastDailyAvg, 0);
    assert.equal(result.model, 'zero_sales');
  });

  it('D class uses floor when forceForecast', () => {
    const result = computeMonthlyAbcdForecastDailyAvg({
      profileClass: 'D',
      monthlyQty: [50, 40, 30, 20, 25, 22, 18, 15, 12, 10, 8, 6],
      horizonIndex: 0,
      forecastYear: 2026,
      forecastMonth: 1,
      recent30DailyAvg: 2,
      recent90DailyAvg: 1,
      forceForecast: true,
    });
    assert.ok(result.forecastDailyAvg > 0);
    assert.equal(result.model, 'floor_only');
  });

  it('C class splits pool weighted forecast by share', () => {
    const poolQty = [60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60];
    const result = computeMonthlyAbcdForecastDailyAvg({
      profileClass: 'C',
      monthlyQty: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
      horizonIndex: 0,
      forecastYear: 2026,
      forecastMonth: 3,
      poolMonthlyQty: poolQty,
      poolShare: 0.1,
      recent30DailyAvg: 0.2,
      recent90DailyAvg: 0.2,
    });
    assert.ok(result.forecastDailyAvg > 0);
    assert.equal(result.model, 'aggregate_decompose');
  });

  it('C class returns zero when no recent sales (ghost 防控)', () => {
    const poolQty = [60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60];
    const result = computeMonthlyAbcdForecastDailyAvg({
      profileClass: 'C',
      monthlyQty: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      horizonIndex: 0,
      forecastYear: 2026,
      forecastMonth: 3,
      poolMonthlyQty: poolQty,
      poolShare: 0.1,
      recent30DailyAvg: 0,
      recent90DailyAvg: 0,
    });
    assert.equal(result.forecastDailyAvg, 0);
    assert.equal(result.model, 'zero_sales');
  });

  it('infers decline when last 3 months drop vs prior 3', () => {
    const qty = [100, 100, 100, 100, 100, 100, 80, 70, 60];
    assert.equal(inferLifecycleFromMonthly(qty), 'decline');
  });

  it('A class decline uses near/yoy blend for k=1~3', () => {
    const qty = [100, 100, 100, 100, 100, 100, 90, 80, 70, 60, 50, 40];
    const recent90DailyAvg = 2;
    const decline = computeMonthlyAbcdForecastDailyAvg({
      profileClass: 'A',
      monthlyQty: qty,
      horizonIndex: 1,
      forecastYear: 2026,
      forecastMonth: 2,
      recent30DailyAvg: 1.3,
      recent90DailyAvg,
      lastYearSameMonthDailyAvg: 3,
      lifecycle: 'decline',
      profileSegment: 'A:core',
      volumeTier: 'core',
    });
    assert.ok(decline.forecastDailyAvg > 0);
    assert.ok(decline.forecastDailyAvg < recent90DailyAvg);
  });

  it('pool weighted forecast stays near recent average', () => {
    const pool = [40, 42, 41, 39, 40, 41];
    const trend = trendForecastMonthlyQty(pool, 0);
    const weighted = poolWeightedMonthlyQty(pool, 0);
    assert.ok(Math.abs(weighted - 40) < Math.abs(trend - 40) + 5);
  });

  it('dynamic share blends 3m and 6m', () => {
    const share = computeDynamicSkuShare([0, 0, 30, 0, 0, 10]);
    assert.ok(share > 10 && share < 30);
  });

  it('builds C pool shares that sum to ~1 per pool', () => {
    const ctx = buildMonthlyAbcdCPoolContext([
      {
        skuId: 'a',
        skuCode: 'A',
        category: 'Outdoor/Patio',
        station: 'US',
        platform: 'ALL',
        monthlyQty: [10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0],
        recent90DailyAvg: 1,
      },
      {
        skuId: 'b',
        skuCode: 'B',
        category: 'Outdoor/Patio',
        station: 'US',
        platform: 'ALL',
        monthlyQty: [20, 0, 20, 0, 20, 0, 20, 0, 20, 0, 20, 0],
        recent90DailyAvg: 2,
      },
    ]);
    const shareSum = (ctx.poolShareBySkuId.get('a') ?? 0) + (ctx.poolShareBySkuId.get('b') ?? 0);
    assert.ok(Math.abs(shareSum - 1) < 0.001);
    assert.equal(ctx.poolMonthlyQtyByKey.size, 1);
  });
});

describe('forecast-algo-mode', () => {
  it('defaults to legacy', () => {
    const prev = process.env.FORECAST_ALGO_MODE;
    delete process.env.FORECAST_ALGO_MODE;
    assert.equal(resolveForecastAlgoMode(), 'legacy');
    if (prev) process.env.FORECAST_ALGO_MODE = prev;
  });

  it('accepts monthly_abcd override', () => {
    assert.equal(resolveForecastAlgoMode('monthly_abcd'), 'monthly_abcd');
  });
});
