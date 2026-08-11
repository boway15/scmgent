import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_ASSIST_START_MONTH_REQUIRED_MESSAGE,
  distributeAiForecastAcrossPlatforms,
  resolveAiAssistBacktestAsOf,
  resolveAiAssistHistoryCapEnd,
  resolveAiAssistHistoryMaxMonth,
  resolveAiAssistHistoryStartMonth,
  resolveAiAssistProfileSegment,
  resolveAiAssistVersionId,
} from './forecast-dify-single.js';
import { buildMonthlyForecastHorizon } from './forecast-baseline.js';
import { buildHistoryMonthLabels } from './forecast-horizon.js';
import { DRAWER_HISTORY_MONTH_COUNT } from './forecast-limits.js';
import { serializeExogenousJson } from './forecast-exogenous-input.js';

describe('forecast-dify-single', () => {
  it('puts full AI total on AMAZON when no per-platform rows exist', () => {
    const result = distributeAiForecastAcrossPlatforms(1.6, new Map());
    assert.equal(result.get('AMAZON'), 1.6);
    assert.equal(result.size, 1);
  });

  it('replaces single-platform forecast with AI total', () => {
    const result = distributeAiForecastAcrossPlatforms(1.6, new Map([['AMAZON', 0.15]]));
    assert.equal(result.get('AMAZON'), 1.6);
    assert.equal(result.size, 1);
  });

  it('scales multi-platform forecasts to match AI total', () => {
    const result = distributeAiForecastAcrossPlatforms(
      1.6,
      new Map([
        ['AMAZON', 0.1],
        ['WALMART', 0.05],
      ]),
    );
    assert.equal(result.get('AMAZON'), 1.0667);
    assert.equal(result.get('WALMART'), 0.5333);
  });

  it('puts full AI total on primary platform when existing rows are all zero', () => {
    const result = distributeAiForecastAcrossPlatforms(
      1.6,
      new Map([
        ['AMAZON', 0],
        ['WALMART', 0],
      ]),
    );
    assert.equal(result.get('AMAZON'), 1.6);
    assert.equal(result.get('WALMART'), 0);
  });

  it('serializes exogenous factors for dify workflow', () => {
    const json = serializeExogenousJson({
      factors: [{ monthLabel: '2026-08', reason: 'price_change', intensity: -5 }],
      operatorNote: '清仓',
    });
    const parsed = JSON.parse(json) as { factors: unknown[]; operatorNote: string };
    assert.equal(parsed.factors.length, 1);
    assert.equal(parsed.operatorNote, '清仓');
  });

  it('resolveAiAssistProfileSegment keeps existing tier and ignores AI marker', () => {
    const rows = [
      { forecastYear: 2026, month: 7, platform: 'AMAZON', profileSegment: 'AI' },
      { forecastYear: 2026, month: 7, platform: 'WALMART', profileSegment: 'T4A' },
    ];
    assert.equal(
      resolveAiAssistProfileSegment({
        existingRows: rows,
        reviewTier: null,
        computedTier: 'T2',
      }),
      'T4A',
    );
    assert.equal(
      resolveAiAssistProfileSegment({
        existingRows: rows,
        reviewTier: 'T99',
        computedTier: 'T99',
      }),
      'T4A',
    );
  });

  describe('AI assist start-month backtest helpers', () => {
    it('requires a non-empty versionId', () => {
      assert.equal(resolveAiAssistVersionId(' version-1 '), 'version-1');
      assert.throws(
        () => resolveAiAssistVersionId(undefined),
        (err: Error & { status?: number }) =>
          err.message === 'versionId is required for AI assist forecast' && err.status === 400,
      );
      assert.throws(() => resolveAiAssistVersionId('  '));
    });

    it('rejects missing startMonth', () => {
      assert.throws(
        () => resolveAiAssistBacktestAsOf(null),
        (err: Error) => err.message === AI_ASSIST_START_MONTH_REQUIRED_MESSAGE,
      );
      assert.throws(() => resolveAiAssistBacktestAsOf('  '));
    });

    it('resolves asOf to UTC month start', () => {
      const asOf = resolveAiAssistBacktestAsOf('2026-02');
      assert.equal(asOf.toISOString(), '2026-02-01T00:00:00.000Z');
    });

    it('history max is month before start', () => {
      const asOf = resolveAiAssistBacktestAsOf('2026-02');
      assert.deepEqual(resolveAiAssistHistoryMaxMonth(asOf), { year: 2026, month: 1 });
      const asOfJan = resolveAiAssistBacktestAsOf('2026-01');
      assert.deepEqual(resolveAiAssistHistoryMaxMonth(asOfJan), { year: 2025, month: 12 });
    });

    it('historyCapEnd is last day of prior month', () => {
      const asOf = resolveAiAssistBacktestAsOf('2026-02');
      const cap = resolveAiAssistHistoryCapEnd(asOf);
      assert.equal(cap.toISOString().slice(0, 10), '2026-01-31');
    });

    it('aligns horizon and history labels to startMonth asOf', () => {
      const asOf = resolveAiAssistBacktestAsOf('2026-02');
      const horizon = buildMonthlyForecastHorizon(asOf, 3);
      assert.deepEqual(
        horizon.map((h) => `${h.forecastYear}-${String(h.month).padStart(2, '0')}`),
        ['2026-02', '2026-03', '2026-04'],
      );
      const history = buildHistoryMonthLabels(3, asOf);
      assert.ok(!history.some((h) => h.monthLabel === '2026-02'));
      assert.equal(history.at(-1)?.monthLabel, '2026-01');
    });

    it('history query min matches earliest history label month', () => {
      const asOf = resolveAiAssistBacktestAsOf('2026-02');
      const earliest = buildHistoryMonthLabels(DRAWER_HISTORY_MONTH_COUNT, asOf)[0];
      const queryMin = resolveAiAssistHistoryStartMonth(asOf);
      assert.equal(queryMin.year, earliest.forecastYear);
      assert.equal(queryMin.month, earliest.month);
      assert.equal(earliest.monthLabel, '2024-02');
    });
  });

  it('resolveAiAssistProfileSegment falls back to computed tier when no persisted segment', () => {
    assert.equal(
      resolveAiAssistProfileSegment({
        existingRows: [
          { forecastYear: 2026, month: 7, platform: 'AMAZON', profileSegment: 'AI' },
        ],
        reviewTier: null,
        computedTier: 'T3',
      }),
      'T3',
    );
    assert.equal(
      resolveAiAssistProfileSegment({
        existingRows: [],
        reviewTier: 'T99',
        computedTier: 'T99',
      }),
      'T99',
    );
  });
});
