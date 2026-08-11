import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_ASSIST_BLEND_BAND_EPSILON,
  AI_ASSIST_BLEND_BAND_EPSILON_EXOGENOUS,
  buildAiAssistSystemReference,
  computeRecentLevelDaily,
  resolveAiAssistBandEpsilon,
  resolveAiAssistMonthDaily,
  suggestBlendDaily,
  yoySameMonthDaily,
} from './forecast-ai-assist-reference.js';

describe('forecast-ai-assist-reference', () => {
  it('computes recent level as median of last positive months', () => {
    const recent = computeRecentLevelDaily(
      [
        { monthLabel: '2025-08', forecastYear: 2025, month: 8, actualDailyAvg: 10 },
        { monthLabel: '2025-09', forecastYear: 2025, month: 9, actualDailyAvg: 12 },
        { monthLabel: '2025-10', forecastYear: 2025, month: 10, actualDailyAvg: 14 },
        { monthLabel: '2025-11', forecastYear: 2025, month: 11, actualDailyAvg: 0 },
        { monthLabel: '2025-12', forecastYear: 2025, month: 12, actualDailyAvg: 40 },
        { monthLabel: '2026-01', forecastYear: 2026, month: 1, actualDailyAvg: 30 },
      ],
      5,
    );
    assert.equal(recent, 14);
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

  it('anchors to system and does not raise hi with recent spikes', () => {
    const blend = suggestBlendDaily({
      recentLevelDaily: 40,
      yoySameMonthDaily: 35,
      systemDailyAvg: 28,
    });
    assert.equal(blend.blendMode, 'system_primary');
    assert.ok(blend.suggestedDaily <= 28 * 1.15);
    assert.ok(blend.suggestedDaily <= 30);
  });

  it('caps with yoy pull when recent much higher than yoy', () => {
    const blend = suggestBlendDaily({
      recentLevelDaily: 40,
      yoySameMonthDaily: 20,
      systemDailyAvg: 30,
    });
    assert.ok(blend.blendMode === 'system_yoy_cap' || blend.blendMode === 'yoy_pull');
    assert.ok(blend.suggestedDaily <= 30);
    assert.ok(blend.suggestedDaily < 35);
  });

  it('lifts when system is far below reliable yoy', () => {
    const blend = suggestBlendDaily({
      recentLevelDaily: 30,
      yoySameMonthDaily: 20,
      systemDailyAvg: 9,
    });
    assert.equal(blend.blendMode, 'system_low_yoy_lift');
    assert.ok(blend.suggestedDaily > 12);
    assert.ok(blend.suggestedDaily < 22);
  });

  it('soft-pulls when yoy looks like stockout anomaly', () => {
    const blend = suggestBlendDaily({
      recentLevelDaily: 40,
      yoySameMonthDaily: 6,
      systemDailyAvg: 22,
    });
    assert.equal(blend.blendMode, 'yoy_anomaly_soft');
    assert.ok(blend.suggestedDaily >= 16);
    assert.ok(blend.suggestedDaily <= 22);
  });

  it('resolves band epsilon 10% default and 12% with exogenous', () => {
    assert.equal(resolveAiAssistBandEpsilon(false), AI_ASSIST_BLEND_BAND_EPSILON);
    assert.equal(resolveAiAssistBandEpsilon(true), AI_ASSIST_BLEND_BAND_EPSILON_EXOGENOUS);
  });

  it('clamps dify into suggested ±10% band', () => {
    const ref = { suggestedBlendDaily: 20, blendMode: 'system_primary' };
    const high = resolveAiAssistMonthDaily({ difyDaily: 37.4, ref, epsilon: 0.1 });
    assert.equal(high.forecastDailyAvg, 22);
    assert.equal(high.clamped, true);
    assert.equal(high.usedFallback, false);

    const low = resolveAiAssistMonthDaily({ difyDaily: 10, ref, epsilon: 0.1 });
    assert.equal(low.forecastDailyAvg, 18);
    assert.equal(low.clamped, true);

    const mid = resolveAiAssistMonthDaily({ difyDaily: 20.5, ref, epsilon: 0.1 });
    assert.equal(mid.forecastDailyAvg, 20.5);
    assert.equal(mid.clamped, false);
  });

  it('uses 12% band when exogenous epsilon passed', () => {
    const ref = { suggestedBlendDaily: 20, blendMode: 'system_primary' };
    const high = resolveAiAssistMonthDaily({ difyDaily: 37.4, ref, epsilon: 0.12 });
    assert.equal(high.forecastDailyAvg, 22.4);
  });

  it('falls back to suggestedBlend when Dify month is missing', () => {
    const fallback = resolveAiAssistMonthDaily({
      difyDaily: 0,
      ref: { suggestedBlendDaily: 28.13, blendMode: 'system_primary' },
    });
    assert.equal(fallback.usedFallback, true);
    assert.equal(fallback.forecastDailyAvg, 28.13);
    assert.equal(fallback.clamped, false);
  });

  it('builds monthly system reference with suggested blends', () => {
    const historyCapEnd = new Date(Date.UTC(2026, 1, 0));
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
    assert.equal(ref.months[0]?.yoySameMonthDaily, 10);
    assert.ok(ref.months[0]!.suggestedBlendDaily > 0);
  });
});
