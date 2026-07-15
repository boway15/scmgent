import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAllCatV41BoundedDaily,
  computeAllCatV41ForecastForMonth,
  computeWalkForwardMetrics,
  isAllCatV41Forecastable,
  isAllCatV41RecentSalesAbsent,
  parseAllCatV41HorizonFactors,
  resolveAllCatProductCategory,
  resolveAllCatV41Tier,
  resolveEffectiveTrendDecay,
  resolveNewProductFloorTier,
  resolveStableFloorTier,
  resolveV41MonthFactor,
  resolveWalkForwardMetricsTarget,
  resolveSparseRecentSaleFloorTier,
  shouldBypassT99Classification,
  T99_RECENT_MONTH_DAILY_MIN,
  trendDecayFactor,
  applyV41CoreUpperBiasCap,
  applyV41MicroSalesUpperCap,
  applyV41TailUpperBiasCap,
} from './forecast-allcat-v41.js';

function buildSeasonalMonthlyRows(): Array<{ saleYear: number; month: number; qtySold: number }> {
  const qtyByMonth: Record<number, number> = {
    1: 600,
    2: 700,
    3: 800,
    4: 900,
    5: 1000,
    6: 1100,
    7: 1000,
    8: 2400,
    9: 900,
    10: 850,
    11: 1200,
    12: 1800,
  };
  return Array.from({ length: 12 }, (_, i) => ({
    saleYear: 2025 + Math.floor((6 + i) / 12),
    month: ((6 + i) % 12) + 1,
    qtySold: qtyByMonth[((6 + i) % 12) + 1] ?? 1000,
  }));
}

describe('forecast-allcat-v41', () => {
  it('parseAllCatV41HorizonFactors reads V41 JSON', () => {
    const parsed = parseAllCatV41HorizonFactors({
      tierSystem: 'AllCategory-KPI-CoreFirst-T99-V41',
      tier: 'T3',
      d6: 12.5,
      trendRatio: 0.92,
      anchorDaily: 8.1,
      seasonalDaily: 9.2,
      formula: '0.35*d3 + 0.50*d6 + 0.15*d12',
      algorithm: 'mid_volume_blend',
      productCategory: 'B',
      effectiveTrendDecay: 0.85,
      monthFactor: 0.98,
      conservativeFactor: 0.97,
      tierCeiling: 14.2,
      growthSignal: false,
      rollingRatio: 1.05,
    });
    assert.ok(parsed);
    assert.equal(parsed?.tier, 'T3');
    assert.equal(parsed?.d6, 12.5);
    assert.equal(parsed?.seasonalDaily, 9.2);
    assert.equal(parsed?.productCategory, 'B');
    assert.equal(parsed?.effectiveTrendDecay, 0.85);
    assert.equal(parsed?.conservativeFactor, 0.97);
  });

  it('resolveAllCatProductCategory maps A/B/C/D/U', () => {
    assert.equal(resolveAllCatProductCategory('A'), 'A');
    assert.equal(resolveAllCatProductCategory('D|sub'), 'D');
    assert.equal(resolveAllCatProductCategory(''), 'U');
    assert.equal(resolveAllCatProductCategory(null), 'U');
    assert.equal(resolveAllCatProductCategory('卧室'), 'U');
  });

  it('classifies A AMAZON high volume as T1', () => {
    const tier = resolveAllCatV41Tier({
      productCategory: 'A',
      platform: 'AMAZON',
      d2: 25,
      d3: 24,
      d6: 22,
      d12: 20,
      active2: 2,
      active6: 6,
      active12: 12,
      cv6: 0.5,
      q1: 0,
      q3: 0,
      q6: 0,
      q12: 0,
      trendRatio: 1,
    });
    assert.equal(tier, 'T1');
    assert.equal(isAllCatV41Forecastable(tier), true);
  });

  it('classifies unclassified as T99', () => {
    const tier = resolveAllCatV41Tier({
      productCategory: 'U',
      platform: 'AMAZON',
      d2: 1,
      d3: 1,
      d6: 1,
      d12: 1,
      active2: 1,
      active6: 2,
      active12: 3,
      cv6: 2,
      q1: 0,
      q3: 0,
      q6: 0,
      q12: 0,
      trendRatio: 1,
    });
    assert.equal(tier, 'T99');
    assert.equal(isAllCatV41Forecastable(tier), false);
  });

  it('avoids T99 when recent 30-day daily avg exceeds floor', () => {
    const metrics = {
      q1: 0,
      q3: 0,
      q6: 0,
      q12: 0,
      d2: 0,
      d3: 0,
      d6: 0,
      d12: 0,
      active2: 2,
      active6: 2,
      active12: 3,
      cv6: 2,
      trendRatio: 1,
    };
    assert.equal(shouldBypassT99Classification(metrics, 0.25, 0.5), true);
    const tier = resolveAllCatV41Tier({
      productCategory: 'U',
      platform: 'AMAZON',
      recent30DailyAvg: 0.25,
      d2: 1,
      d3: 1,
      d6: 1,
      d12: 1,
      active2: 2,
      active6: 2,
      active12: 3,
      cv6: 2,
      q1: 0,
      q3: 0,
      q6: 0,
      q12: 0,
      trendRatio: 1,
    });
    assert.equal(tier, 'T4B');
    assert.equal(T99_RECENT_MONTH_DAILY_MIN, 0.2);
  });

  it('does not bypass T99 when recent90 and active2 are both absent', () => {
    assert.equal(
      shouldBypassT99Classification(
        {
          q1: 0,
          q3: 0,
          q6: 0,
          q12: 0,
          d2: 0,
          d3: 0,
          d6: 0,
          d12: 0,
          active2: 1,
          active6: 2,
          active12: 3,
          cv6: 2,
          trendRatio: 1,
        },
        0.25,
        0,
      ),
      false,
    );
  });

  it('classifies B non-AMAZON stable as T3P', () => {
    const tier = resolveAllCatV41Tier({
      productCategory: 'B',
      platform: 'WALMART',
      d2: 8,
      d3: 7,
      d6: 7,
      d12: 6,
      active2: 2,
      active6: 6,
      active12: 10,
      cv6: 0.4,
      q1: 0,
      q3: 0,
      q6: 0,
      q12: 0,
      trendRatio: 1,
    });
    assert.equal(tier, 'T3P');
  });

  it('classifies last complete month with low but positive sales as T4B', () => {
    const monthlyRows = [
      { saleYear: 2026, month: 5, qtySold: 8 },
      { saleYear: 2026, month: 6, qtySold: 10 },
    ];
    const ghosted = computeAllCatV41ForecastForMonth({
      productCategory: 'U',
      platform: 'AMAZON',
      forecastYear: 2026,
      forecastMonth: 7,
      horizonIndex: 0,
      monthlyRows,
      recent30DailyAvg: 0.3,
      recent90DailyAvg: 0.28,
    });
    assert.equal(ghosted.tier, 'T4B');
    assert.equal(ghosted.forecastDaily, 0);

    const result = computeAllCatV41ForecastForMonth({
      productCategory: 'U',
      platform: 'AMAZON',
      forecastYear: 2026,
      forecastMonth: 7,
      horizonIndex: 0,
      monthlyRows,
      recent30DailyAvg: 0.45,
      recent90DailyAvg: 0.6,
    });
    assert.equal(result.tier, 'T4B');
    assert.ok(result.forecastDaily > 0);
    assert.equal(resolveSparseRecentSaleFloorTier(result.metrics), 'T4B');
  });

  it('T99 when no sales in recent complete month', () => {
    const monthlyRows = [
      { saleYear: 2026, month: 4, qtySold: 12 },
      { saleYear: 2026, month: 5, qtySold: 0 },
    ];
    const result = computeAllCatV41ForecastForMonth({
      productCategory: 'U',
      platform: 'AMAZON',
      forecastYear: 2026,
      forecastMonth: 7,
      horizonIndex: 0,
      monthlyRows,
    });
    assert.equal(result.tier, 'T99');
    assert.equal(result.forecastDaily, 0);
    assert.equal(result.horizonFactors.tierSystem, 'AllCategory-KPI-CoreFirst-T99-V41');
  });

  it('classifies stable unclassified SKU as T4B with positive forecast', () => {
    const monthlyRows = Array.from({ length: 12 }, (_, i) => ({
      saleYear: 2025 + Math.floor((6 + i) / 12),
      month: ((6 + i) % 12) + 1,
      qtySold: 35 + (i % 3) * 5,
    }));
    const result = computeAllCatV41ForecastForMonth({
      productCategory: '大件',
      platform: 'AMAZON',
      forecastYear: 2026,
      forecastMonth: 7,
      horizonIndex: 0,
      monthlyRows,
    });
    assert.equal(result.tier, 'T4B');
    assert.ok(result.forecastDaily > 0);
    assert.equal(isAllCatV41Forecastable(result.tier), true);
    assert.equal(result.horizonFactors.algorithm, 'stable_continuity_floor_blend');
    assert.equal(result.horizonFactors.excludedFromMainStats, true);
  });

  it('resolveStableFloorTier rejects high cv6', () => {
    assert.equal(
      resolveStableFloorTier({
        q1: 0,
        q3: 0,
        q6: 0,
        q12: 0,
        d2: 1,
        d3: 1,
        d6: 1,
        d12: 1,
        active2: 2,
        active6: 6,
        active12: 12,
        cv6: 1.5,
        trendRatio: 1,
      }),
      null,
    );
  });

  it('resolveStableFloorTier rejects zero recent month without active2', () => {
    assert.equal(
      resolveStableFloorTier({
        q1: 0,
        q3: 0,
        q6: 0,
        q12: 0,
        d2: 0.8,
        d3: 1,
        d6: 1.2,
        d12: 1.1,
        active2: 1,
        active6: 6,
        active12: 10,
        cv6: 0.6,
        trendRatio: 1,
      }),
      null,
    );
  });

  it('resolveStableFloorTier accepts continuous low-volume history', () => {
    assert.equal(
      resolveStableFloorTier({
        q1: 0,
        q3: 0,
        q6: 0,
        q12: 0,
        d2: 0.8,
        d3: 1,
        d6: 1.2,
        d12: 1.1,
        active2: 2,
        active6: 6,
        active12: 10,
        cv6: 0.6,
        trendRatio: 1,
      }),
      'T4B',
    );
  });

  it('classifies new product with two active months as T4B', () => {
    const monthlyRows = [
      { saleYear: 2026, month: 5, qtySold: 42 },
      { saleYear: 2026, month: 6, qtySold: 38 },
    ];
    const result = computeAllCatV41ForecastForMonth({
      productCategory: 'U',
      platform: 'AMAZON',
      forecastYear: 2026,
      forecastMonth: 7,
      horizonIndex: 0,
      monthlyRows,
    });
    assert.equal(result.tier, 'T4B');
    assert.ok(result.forecastDaily > 0);
    assert.equal(result.algorithm, 'new_product_short_history_floor_blend');
  });

  it('resolveNewProductFloorTier requires two active recent months', () => {
    assert.equal(
      resolveNewProductFloorTier({
        q1: 0,
        q3: 0,
        q6: 0,
        q12: 0,
        d2: 0.5,
        d3: 0.8,
        d6: 0.7,
        d12: 0.4,
        active2: 2,
        active6: 2,
        active12: 2,
        cv6: 0.3,
        trendRatio: 1,
      }),
      'T4B',
    );
    assert.equal(
      resolveNewProductFloorTier({
        q1: 0,
        q3: 0,
        q6: 0,
        q12: 0,
        d2: 0.5,
        d3: 0.8,
        d6: 0.7,
        d12: 0.4,
        active2: 1,
        active6: 2,
        active12: 2,
        cv6: 0.3,
        trendRatio: 1,
      }),
      null,
    );
  });

  it('computeWalkForwardMetrics uses only history before target month', () => {
    const rows = [
      { saleYear: 2026, month: 1, qtySold: 100 },
      { saleYear: 2026, month: 2, qtySold: 200 },
      { saleYear: 2026, month: 3, qtySold: 300 },
      { saleYear: 2026, month: 4, qtySold: 9999 },
    ];
    const m = computeWalkForwardMetrics(rows, 2026, 4);
    assert.equal(m.q3, 600);
    assert.ok(m.q6 >= 600);
    assert.equal(m.active2, 2);
  });

  it('resolveWalkForwardMetricsTarget caps forward months at first forecast month', () => {
    const capEnd = new Date(Date.UTC(2026, 5, 30));
    assert.deepEqual(resolveWalkForwardMetricsTarget(2026, 7, capEnd), { year: 2026, month: 7 });
    assert.deepEqual(resolveWalkForwardMetricsTarget(2026, 8, capEnd), { year: 2026, month: 7 });
    assert.deepEqual(resolveWalkForwardMetricsTarget(2026, 12, capEnd), { year: 2026, month: 7 });
    assert.deepEqual(resolveWalkForwardMetricsTarget(2026, 8), { year: 2026, month: 8 });
  });

  it('historyCapEnd keeps tier stable when current month has no sales', () => {
    const monthlyRows = buildSeasonalMonthlyRows();
    const capEnd = new Date(Date.UTC(2026, 5, 30));
    const july = computeAllCatV41ForecastForMonth({
      productCategory: 'A',
      platform: 'AMAZON',
      forecastYear: 2026,
      forecastMonth: 7,
      horizonIndex: 0,
      monthlyRows,
      historyCapEnd: capEnd,
    });
    const august = computeAllCatV41ForecastForMonth({
      productCategory: 'A',
      platform: 'AMAZON',
      forecastYear: 2026,
      forecastMonth: 8,
      horizonIndex: 1,
      monthlyRows,
      historyCapEnd: capEnd,
    });
    assert.notEqual(july.tier, 'T99');
    assert.equal(august.tier, july.tier);
    assert.ok(august.forecastDaily > 0);
    assert.notEqual(august.forecastDaily, july.forecastDaily);
    assert.equal(august.horizonFactors.forwardHistoryCap, true);
  });

  it('without historyCapEnd August downgrades tier when July is missing from history', () => {
    const monthlyRows = Array.from({ length: 12 }, (_, i) => ({
      saleYear: 2025 + Math.floor((6 + i) / 12),
      month: ((6 + i) % 12) + 1,
      qtySold: 1200 + i * 10,
    }));
    const july = computeAllCatV41ForecastForMonth({
      productCategory: 'A',
      platform: 'AMAZON',
      forecastYear: 2026,
      forecastMonth: 7,
      horizonIndex: 0,
      monthlyRows,
    });
    const august = computeAllCatV41ForecastForMonth({
      productCategory: 'A',
      platform: 'AMAZON',
      forecastYear: 2026,
      forecastMonth: 8,
      horizonIndex: 1,
      monthlyRows,
    });
    assert.ok(['T1', 'T2', 'T3'].includes(july.tier));
    assert.notEqual(august.tier, july.tier);
  });

  it('resolveEffectiveTrendDecay blocks growth signal for T4B', () => {
    const decay = resolveEffectiveTrendDecay({
      tier: 'T4B',
      metrics: {
        q1: 0,
        q3: 0,
        q6: 0,
        q12: 0,
        d2: 0,
        d3: 0,
        d6: 0,
        d12: 0,
        active2: 0,
        active6: 0,
        active12: 0,
        cv6: 0,
        trendRatio: 0.73,
      },
      recent30DailyAvg: 1.93,
      recent90DailyAvg: 1.36,
    });
    assert.equal(decay.growthSignal, false);
    assert.equal(decay.factor, trendDecayFactor(0.73));
  });

  it('resolveEffectiveTrendDecay uses rolling ratio for T3 growth SKUs', () => {
    const decay = resolveEffectiveTrendDecay({
      tier: 'T3',
      metrics: {
        q1: 0,
        q3: 0,
        q6: 0,
        q12: 0,
        d2: 0,
        d3: 0,
        d6: 0,
        d12: 0,
        active2: 0,
        active6: 0,
        active12: 0,
        cv6: 0.5,
        trendRatio: 1.0,
      },
      recent30DailyAvg: 1.93,
      recent90DailyAvg: 1.36,
    });
    assert.equal(decay.growthSignal, true);
    assert.ok(decay.factor >= 1.0);
  });

  it('resolveV41MonthFactor applies mild July haircut for T1 first horizon', () => {
    assert.equal(resolveV41MonthFactor(7, 0, 'T1'), 0.98);
    assert.ok(Math.abs(resolveV41MonthFactor(7, 0, 'T4B') - 0.8) < 0.0001);
    assert.equal(resolveV41MonthFactor(7, 1, 'T1'), 0.98);
    assert.equal(resolveV41MonthFactor(7, 5, 'T1'), 0.88);
    assert.equal(resolveV41MonthFactor(2, 0, 'T1'), 1.0);
  });

  it('resolveV41MonthFactor applies Q2 seasonal discount for core tiers', () => {
    assert.ok(Math.abs(resolveV41MonthFactor(4, 0, 'T1') - 0.98 * 0.92) < 0.0001);
    assert.ok(
      Math.abs(resolveV41MonthFactor(4, 0, 'T2') - 0.98 * 0.92 * 0.95) < 0.0001,
    );
    assert.equal(resolveV41MonthFactor(4, 0, 'T3P'), 1.0);
  });

  it('resolveEffectiveTrendDecay ignores growth bypass for T1 when calendar trend soft', () => {
    const decay = resolveEffectiveTrendDecay({
      tier: 'T1',
      metrics: {
        q1: 0,
        q3: 0,
        q6: 0,
        q12: 0,
        d2: 0,
        d3: 0,
        d6: 0,
        d12: 0,
        active2: 0,
        active6: 0,
        active12: 0,
        cv6: 0,
        trendRatio: 0.8,
      },
      recent30DailyAvg: 80,
      recent90DailyAvg: 60,
    });
    assert.equal(decay.growthSignal, false);
    assert.equal(decay.factor, 0.85);
  });

  it('computeAllCatV41BoundedDaily keeps T1 B-tier near AI for high blend July', () => {
    const metrics = {
      q1: 0,
      q3: 0,
      q6: 0,
      q12: 0,
      d2: 70,
      d3: 68,
      d6: 66.21,
      d12: 64,
      active2: 2,
      active6: 6,
      active12: 12,
      cv6: 0.5,
      trendRatio: 0.8,
    };
    const bounded = computeAllCatV41BoundedDaily({
      tier: 'T1',
      baseDaily: 77.47,
      productCategory: 'B',
      forecastMonth: 7,
      horizonIndex: 0,
      metrics,
      recent30DailyAvg: 80,
      recent90DailyAvg: 66,
    });
    assert.ok(bounded.forecastDaily >= 52 && bounded.forecastDaily <= 62);
    assert.ok(bounded.forecastDaily < 70);
    assert.equal(bounded.conservativeFactor, 0.82);
    assert.equal(bounded.monthFactor, 0.98);
  });

  it('computeAllCatV41BoundedDaily caps T4B with tail upper bias', () => {
    const metrics = {
      q1: 58,
      q3: 120,
      q6: 104,
      q12: 200,
      d2: 1.5,
      d3: 1.32,
      d6: 0.57,
      d12: 0.55,
      active2: 2,
      active6: 4,
      active12: 8,
      cv6: 0.8,
      trendRatio: 0.73,
    };
    const bounded = computeAllCatV41BoundedDaily({
      tier: 'T4B',
      baseDaily: 0.87,
      productCategory: 'U',
      forecastMonth: 7,
      horizonIndex: 0,
      metrics,
      recent30DailyAvg: 1.93,
      recent90DailyAvg: 1.36,
    });
    assert.equal(bounded.growthSignal, false);
    assert.ok(bounded.forecastDaily > 0);
    assert.ok(bounded.forecastDaily <= 1.36 * 0.9);
  });

  it('isAllCatV41RecentSalesAbsent detects weak and declining tail momentum', () => {
    assert.equal(
      isAllCatV41RecentSalesAbsent({
        recent30DailyAvg: 0,
        recent90DailyAvg: 0,
        metrics: { q1: 0, active2: 2 },
        tier: 'T4B',
      }),
      true,
    );
    assert.equal(
      isAllCatV41RecentSalesAbsent({
        recent30DailyAvg: 0.1,
        recent90DailyAvg: 0.3,
        metrics: { q1: 10, active2: 2, trendRatio: 1 },
        tier: 'T4A',
      }),
      true,
    );
    assert.equal(
      isAllCatV41RecentSalesAbsent({
        recent30DailyAvg: 1,
        recent90DailyAvg: 1,
        metrics: { q1: 10, active2: 2, trendRatio: 1 },
        tier: 'T4B',
      }),
      false,
    );
  });

  it('computeAllCatV41BoundedDaily zeroes T4A/T4B when recent sales absent', () => {
    const metrics = {
      q1: 0,
      q3: 30,
      q6: 60,
      q12: 120,
      d2: 1,
      d3: 1,
      d6: 3,
      d12: 3,
      active2: 1,
      active6: 5,
      active12: 10,
      cv6: 0.8,
      trendRatio: 1,
    };
    for (const tier of ['T4A', 'T4B'] as const) {
      const bounded = computeAllCatV41BoundedDaily({
        tier,
        baseDaily: 2,
        productCategory: 'A',
        forecastMonth: 7,
        horizonIndex: 0,
        metrics,
        recent30DailyAvg: 0,
        recent90DailyAvg: 0,
      });
      assert.equal(bounded.forecastDaily, 0);
      assert.equal(bounded.ghostGated, true);
    }
  });

  it('does not classify Amazon A T4A when active6 is only 4', () => {
    const tier = resolveAllCatV41Tier({
      productCategory: 'A',
      platform: 'AMAZON',
      d2: 3,
      d3: 3,
      d6: 3,
      d12: 3,
      active2: 2,
      active6: 4,
      active12: 8,
      cv6: 0.8,
      q1: 90,
      q3: 0,
      q6: 0,
      q12: 0,
      trendRatio: 1,
      recent30DailyAvg: 3,
    });
    assert.notEqual(tier, 'T4A');
  });

  it('applyV41TailUpperBiasCap limits T4A over-forecast', () => {
    const capped = applyV41TailUpperBiasCap({
      tier: 'T4A',
      forecastDaily: 5,
      anchorDaily: 3,
      recent90DailyAvg: 2,
      recent30DailyAvg: 2.2,
      d6: 4,
    });
    assert.equal(capped, 1.7);
  });

  it('declining trend prevents T4A classification', () => {
    const tier = resolveAllCatV41Tier({
      productCategory: 'A',
      platform: 'AMAZON',
      d2: 3,
      d3: 3,
      d6: 3,
      d12: 3,
      active2: 2,
      active6: 5,
      active12: 8,
      cv6: 0.8,
      q1: 90,
      q3: 0,
      q6: 0,
      q12: 0,
      trendRatio: 0.5,
      recent30DailyAvg: 3,
    });
    assert.notEqual(tier, 'T4A');
  });

  it('applyV41CoreUpperBiasCap limits T1 over-forecast in flex horizon', () => {
    const capped = applyV41CoreUpperBiasCap({
      tier: 'T1',
      forecastDaily: 120,
      anchorDaily: 100,
      horizonIndex: 4,
    });
    assert.equal(capped, 108);
  });

  it('applyV41CoreUpperBiasCap tightens T2/T3 right-tail over-forecast budget', () => {
    const near = applyV41CoreUpperBiasCap({
      tier: 'T2',
      forecastDaily: 120,
      anchorDaily: 100,
      horizonIndex: 1,
    });
    const flex = applyV41CoreUpperBiasCap({
      tier: 'T3',
      forecastDaily: 120,
      anchorDaily: 100,
      horizonIndex: 4,
    });
    assert.equal(near, 105);
    assert.equal(flex, 104);
  });

  it('resolveV41MonthFactor applies stronger Q2 right-tail discount for T2/T3', () => {
    const t2 = resolveV41MonthFactor(5, 1, 'T2');
    const t3 = resolveV41MonthFactor(5, 1, 'T3');
    const t1 = resolveV41MonthFactor(5, 1, 'T1');
    assert.ok(t2 < t1);
    assert.ok(t3 < t1);
    assert.ok(t2 <= 0.98 * 0.92 * 0.95 + 1e-9);
    assert.ok(t3 <= 0.98 * 0.92 * 0.95 + 1e-9);
  });

  it('applyV41TailUpperBiasCap further tightens T4A to recent90', () => {
    const capped = applyV41TailUpperBiasCap({
      tier: 'T4A',
      forecastDaily: 5,
      anchorDaily: 3,
      recent90DailyAvg: 2,
      recent30DailyAvg: 2.5,
      d6: 4,
    });
    assert.equal(capped, 1.7);
  });

  it('isAllCatV41RecentSalesAbsent expands T4B weak-sales gate', () => {
    assert.equal(
      isAllCatV41RecentSalesAbsent({
        recent30DailyAvg: 0.3,
        recent90DailyAvg: 0.5,
        metrics: { q1: 12, active2: 2, trendRatio: 1 },
        tier: 'T4B',
      }),
      true,
    );
    assert.equal(
      isAllCatV41RecentSalesAbsent({
        recent30DailyAvg: 0.8,
        recent90DailyAvg: 1.4,
        metrics: { q1: 30, active2: 2, trendRatio: 0.6 },
        tier: 'T4B',
      }),
      true,
    );
  });

  it('applyV41MicroSalesUpperCap limits low-volume T3 over-forecast', () => {
    const capped = applyV41MicroSalesUpperCap({
      tier: 'T3',
      forecastDaily: 2.5,
      d6: 0.3,
      recent30DailyAvg: 0.2,
      recent90DailyAvg: 0.35,
    });
    assert.equal(capped, 0.21);
  });

  it('computeAllCatV41BoundedDaily zeroes weak T3 micro-sales', () => {
    const bounded = computeAllCatV41BoundedDaily({
      tier: 'T3',
      baseDaily: 1.2,
      productCategory: 'B',
      forecastMonth: 7,
      horizonIndex: 0,
      metrics: {
        q1: 6,
        q3: 20,
        q6: 40,
        q12: 80,
        d2: 0.2,
        d3: 0.2,
        d6: 0.3,
        d12: 0.3,
        active2: 1,
        active6: 4,
        active12: 8,
        cv6: 0.9,
        trendRatio: 0.5,
      },
      recent30DailyAvg: 0.1,
      recent90DailyAvg: 0.2,
    });
    assert.equal(bounded.forecastDaily, 0);
    assert.equal(bounded.ghostGated, true);
  });
});
