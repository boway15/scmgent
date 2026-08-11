import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAiAssistSystemReference,
  computeRecentLevelDaily,
  suggestBlendDaily,
  yoySameMonthDaily,
} from './forecast-ai-assist-reference.js';

describe('forecast-ai-assist-reference', () => {
  it('computes recent level from last positive months', () => {
    const recent = computeRecentLevelDaily([
      { monthLabel: '2025-10', forecastYear: 2025, month: 10, actualDailyAvg: 10 },
      { monthLabel: '2025-11', forecastYear: 2025, month: 11, actualDailyAvg: 0 },
      { monthLabel: '2025-12', forecastYear: 2025, month: 12, actualDailyAvg: 20 },
      { monthLabel: '2026-01', forecastYear: 2026, month: 1, actualDailyAvg: 30 },
    ]);
    assert.equal(recent, 20);
  });

  it('reads yoy same-month daily from history', () => {
    const yoy = yoySameMonthDaily(
      [
        { monthLabel: '2025-02', forecastYear: 2025, month: 2, actualDailyAvg: 12.5 },
        { monthLabel: '2025-03', forecastYear: 2025, month: 3, actualDailyAvg: 9 },
      ],
      2026,
      2,
    );
    assert.equal(yoy, 12.5);
  });

  it('pulls toward yoy when recent is much higher', () => {
    const blend = suggestBlendDaily({
      recentLevelDaily: 40,
      yoySameMonthDaily: 20,
      systemDailyAvg: 22,
    });
    assert.equal(blend.blendMode, 'yoy_pull');
    assert.ok(blend.nearOverYoyRatio != null && blend.nearOverYoyRatio >= 1.35);
    // 0.35*40 + 0.65*20 = 27, then soft-clamped vs system
    assert.ok(blend.suggestedDaily < 40);
    assert.ok(blend.suggestedDaily >= 22 * 0.7);
  });

  it('balances near and yoy when gap is moderate', () => {
    const blend = suggestBlendDaily({
      recentLevelDaily: 24,
      yoySameMonthDaily: 20,
      systemDailyAvg: 22,
    });
    assert.equal(blend.blendMode, 'balanced');
    assert.equal(blend.suggestedDaily, 22.2);
  });

  it('builds monthly system reference with suggested blends', () => {
    const historyCapEnd = new Date(Date.UTC(2026, 1, 0)); // 2026-01-31
    const monthlyRows = [
      { saleYear: 2025, month: 2, qtySold: 310 },
      { saleYear: 2025, month: 11, qtySold: 900 },
      { saleYear: 2025, month: 12, qtySold: 950 },
      { saleYear: 2026, month: 1, qtySold: 1000 },
    ];
    const history = [
      { monthLabel: '2025-02', forecastYear: 2025, month: 2, actualDailyAvg: 10 },
      { monthLabel: '2025-11', forecastYear: 2025, month: 11, actualDailyAvg: 30 },
      { monthLabel: '2025-12', forecastYear: 2025, month: 12, actualDailyAvg: 30.6452 },
      { monthLabel: '2026-01', forecastYear: 2026, month: 1, actualDailyAvg: 32.2581 },
    ];
    const ref = buildAiAssistSystemReference({
      profileSegment: 'AI',
      productCategory: 'A',
      platform: 'AMAZON',
      monthlyRows,
      history,
      categoryTrend: [
        {
          monthLabel: '2026-02',
          seasonalityFactor: 1.1,
          trendFactor: 1,
          combinedFactor: 1.1,
        },
      ],
      forecastHorizon: [{ monthLabel: '2026-02', forecastYear: 2026, month: 2 }],
      historyCapEnd,
    });

    assert.equal(ref.profileSegment, 'AI');
    assert.equal(ref.productCategory, 'A');
    assert.equal(ref.months.length, 1);
    assert.equal(ref.months[0]?.monthLabel, '2026-02');
    assert.equal(ref.months[0]?.yoySameMonthDaily, 10);
    assert.ok(ref.months[0]!.systemDailyAvg >= 0);
    assert.ok(ref.months[0]!.suggestedBlendDaily > 0);
    assert.match(ref.guidance, /近端|suggestedBlendDaily/);
  });
});
