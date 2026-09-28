import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTierHorizonAttribution,
  inferFlexBiasRecommendations,
  parseHorizonDiscountProduct,
} from './forecast-flex-bias-attribution.js';

describe('forecast-flex-bias-attribution', () => {
  it('parses horizon discount product from factors', () => {
    assert.equal(
      parseHorizonDiscountProduct({
        conservativeFactor: 0.66,
        monthFactor: 0.92,
        effectiveTrendDecay: 0.85,
      }),
      0.66 * 0.92 * 0.85,
    );
  });

  it('aggregates flex contribution by tier × k', () => {
    const summary = buildTierHorizonAttribution([
      {
        profileSegment: 'T4A',
        horizonIndex: 4,
        forecastDaily: 8,
        actualDaily: 10,
        horizonFactors: { conservativeFactor: 0.66, monthFactor: 0.9, effectiveTrendDecay: 1 },
      },
      {
        profileSegment: 'T4A',
        horizonIndex: 4,
        forecastDaily: 7,
        actualDaily: 10,
        horizonFactors: { conservativeFactor: 0.66, monthFactor: 0.9, effectiveTrendDecay: 1 },
      },
      {
        profileSegment: 'T1',
        horizonIndex: 1,
        forecastDaily: 10,
        actualDaily: 10,
      },
    ]);

    assert.equal(summary.flexWeightedBias != null && summary.flexWeightedBias < 0, true);
    const t4Cell = summary.cells.find((cell) => cell.tier === 'T4A' && cell.horizonIndex === 4);
    assert.ok(t4Cell);
    assert.equal(t4Cell?.weightedBias, -0.25);
    assert.equal(t4Cell?.flexContribution, -0.25);
  });

  it('recommends tail discount correction when tail dominates flex bias', () => {
    const cells = [
      {
        tier: 'T4B',
        tierLabel: 'T4B',
        horizonIndex: 4,
        horizonBand: 'flex' as const,
        comparableRows: 20,
        actualDailySum: 100,
        forecastDailySum: 70,
        weightedBias: -0.3,
        wmape: 0.3,
        flexContribution: -0.18,
        discountProductMedian: 0.68,
        discountProductP25: 0.6,
        discountProductP75: 0.72,
      },
    ];
    const recs = inferFlexBiasRecommendations(cells, 200);
    assert.ok(recs.some((line) => line.includes('影子偏差校正')));
  });
});
