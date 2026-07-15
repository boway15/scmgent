import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { distributeAiForecastAcrossPlatforms, resolveAiAssistProfileSegment } from './forecast-dify-single.js';
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
