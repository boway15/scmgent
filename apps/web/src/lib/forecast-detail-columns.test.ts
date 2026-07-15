import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hasAnyLegacyHorizonColumn,
  isAiAssistForecastDetail,
  resolveAiAssistModeFromMonths,
  resolveLegacyHorizonColumnVisibility,
  resolveV41AnchoredSnapshot,
  resolveV41DetailColumnVisibility,
} from './forecast-detail-columns.js';
import { formatTierDisplayLabel } from './forecast-labels.js';

describe('forecast-detail-columns', () => {
  it('resolveV41AnchoredSnapshot returns uniform walk-forward features', () => {
    const months = [
      { allCatV41Factors: { d6: 12, d3: 10, trendRatio: 0.9, anchorDaily: 8.5, formula: 'f1' } },
      { allCatV41Factors: { d6: 12, d3: 10, trendRatio: 0.9, anchorDaily: 8.5, formula: 'f1' } },
    ];
    const snap = resolveV41AnchoredSnapshot(months);
    assert.equal(snap?.d6, 12);
    assert.equal(snap?.anchorDaily, 8.5);
    const vis = resolveV41DetailColumnVisibility(months);
    assert.equal(vis.d6, false);
    assert.equal(vis.trendRatio, false);
    assert.equal(vis.anchor, false);
  });

  it('resolveV41DetailColumnVisibility keeps varying seasonal in table', () => {
    const months = [
      { allCatV41Factors: { d6: 12, d3: 10, trendRatio: 0.9, anchorDaily: 8.5, seasonalDaily: 7, levelDaily: 8, formula: 'f' } },
      { allCatV41Factors: { d6: 12, d3: 10, trendRatio: 0.9, anchorDaily: 8.5, seasonalDaily: 9, levelDaily: 8.2, formula: 'f' } },
    ];
    const vis = resolveV41DetailColumnVisibility(months);
    assert.equal(vis.seasonal, true);
    assert.equal(vis.blendLevel, true);
    assert.equal(vis.d6, false);
  });

  it('hides legacy horizon columns for AI assist rows', () => {
    const months = [
      { aiAssistRationale: '促销', forecastModel: 'dify_single_sku', horizonFactors: null },
    ];
    assert.equal(isAiAssistForecastDetail(months), true);
    const vis = resolveLegacyHorizonColumnVisibility(months);
    assert.equal(hasAnyLegacyHorizonColumn(vis), false);
  });

  it('shows legacy horizon columns when horizonFactors exist', () => {
    const months = [
      {
        horizonFactors: {
          wNear: 0.6,
          wYoy: 0.4,
          nearLevel: 10,
          structuralLevel: 9,
          growthFactor: 1.1,
          yoyMonthLevel: 8,
        },
      },
    ];
    const vis = resolveLegacyHorizonColumnVisibility(months);
    assert.equal(vis.wNear, true);
    assert.equal(vis.nearLevel, true);
  });

  it('resolveAiAssistModeFromMonths prefers human over auto', () => {
    const months = [
      { aiAssistMode: 'auto', forecastModel: 'dify_single_sku' },
      { aiAssistMode: 'human', aiAssistRationale: '促销' },
    ];
    assert.equal(resolveAiAssistModeFromMonths(months), 'human');
    assert.equal(
      formatTierDisplayLabel('T1', resolveAiAssistModeFromMonths(months)),
      'T1 主力稳定 · AI+',
    );
    assert.equal(formatTierDisplayLabel('T1', 'auto'), 'T1 主力稳定 · AI');
    assert.equal(formatTierDisplayLabel('T1', null), 'T1 主力稳定');
  });
});
