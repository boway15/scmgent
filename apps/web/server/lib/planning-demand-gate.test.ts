import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeRecentSkuWmape,
  evaluateDemandGate,
  summarizePrecisionWindow,
  isAutoAdoptableSuggestion,
  isDemandReconstructCapHit,
  stockoutDaysFromInStockRatio,
} from './planning-demand-gate.js';

describe('computeRecentSkuWmape', () => {
  const row = (
    station: string,
    month: number,
    forecast: number,
    actual: number,
    computedAt = '2026-09-01T00:00:00Z',
  ) => ({
    station,
    platform: 'ALL',
    forecastYear: 2026,
    month,
    forecastDailyAvg: String(forecast),
    actualDailyAvg: String(actual),
    computedAt,
  });

  it('weights stations by actual volume instead of taking an arbitrary row', () => {
    // US: |12-10|=2, UK: |3-1|=2 → WMAPE = 4/11；单行 UK MAPE 会是 200%
    const wmape = computeRecentSkuWmape([row('UK', 8, 3, 1), row('US', 8, 12, 10)]);
    assert.ok(wmape != null);
    assert.ok(Math.abs(wmape - 4 / 11) < 1e-9);
  });

  it('only uses the latest settled month', () => {
    const wmape = computeRecentSkuWmape([row('US', 7, 50, 10), row('US', 8, 11, 10)]);
    assert.ok(wmape != null);
    assert.ok(Math.abs(wmape - 0.1) < 1e-9);
  });

  it('keeps only the latest computed version per station/platform', () => {
    const wmape = computeRecentSkuWmape([
      row('US', 8, 20, 10, '2026-09-01T00:00:00Z'),
      row('US', 8, 10, 10, '2026-09-05T00:00:00Z'),
    ]);
    assert.equal(wmape, 0);
  });

  it('returns null when no comparable volume', () => {
    assert.equal(computeRecentSkuWmape([]), null);
    assert.equal(computeRecentSkuWmape([row('US', 8, 5, 0)]), null);
  });
});

describe('isDemandReconstructCapHit', () => {
  it('hits when reconstructed daily reaches the cap', () => {
    assert.equal(
      isDemandReconstructCapHit({ source: 'reconstructed_shape', unconstrainedDaily: 15, avgDaily: 10 }),
      true,
    );
  });

  it('ignores non-reconstructed sources and values below cap', () => {
    assert.equal(
      isDemandReconstructCapHit({ source: 'forecast', unconstrainedDaily: 15, avgDaily: 10 }),
      false,
    );
    assert.equal(
      isDemandReconstructCapHit({ source: 'reconstructed_shape', unconstrainedDaily: 12, avgDaily: 10 }),
      false,
    );
    assert.equal(
      isDemandReconstructCapHit({ source: 'reconstructed_shape', unconstrainedDaily: null, avgDaily: 10 }),
      false,
    );
  });

  it('converts in-stock ratio to stockout days over 90d', () => {
    assert.equal(stockoutDaysFromInStockRatio('0.8'), 18);
    assert.equal(stockoutDaysFromInStockRatio(null), null);
  });
});

describe('planning-demand-gate', () => {
  it('flags reconstruct cap for manual confirm', () => {
    const result = evaluateDemandGate({
      reconstructCapHit: true,
      unconstrainedDaily: 2.5,
      stockoutDays: 20,
    });
    assert.equal(result.needsManualConfirm, true);
    assert.ok(result.flags.includes('reconstruct_capped'));
    assert.equal(result.demandCapped, true);
  });

  it('flags wmape fail for manual confirm', () => {
    const result = evaluateDemandGate({
      recentWmape: 0.5,
      segment: 'A:core',
      band: 'precision',
    });
    assert.equal(result.needsManualConfirm, true);
    assert.ok(result.flags.includes('wmape_fail'));
  });

  it('uses the latest three settled months instead of only the last month', () => {
    const sample = (month: number, forecast: number, actual: number) => ({
      station: 'US',
      platform: 'ALL',
      forecastYear: 2026,
      month,
      forecastDailyAvg: String(forecast),
      actualDailyAvg: String(actual),
      computedAt: '2026-09-01T00:00:00Z',
    });
    const summary = summarizePrecisionWindow([
      sample(6, 10, 10),
      sample(7, 20, 10),
      sample(8, 12, 10),
      sample(5, 100, 10),
    ]);
    assert.ok(summary.wmape != null);
    assert.ok(Math.abs(summary.wmape - 12 / 30) < 1e-9);
    assert.ok(summary.errorStdDev != null && summary.errorStdDev > 0);
  });

  it('asks for manual confirm when the segment or accuracy sample is missing', () => {
    const missingSegment = evaluateDemandGate({ recentWmape: 0.1 });
    assert.equal(missingSegment.needsManualConfirm, true);
    assert.ok(missingSegment.flags.includes('segment_missing'));
    assert.equal(missingSegment.flags.includes('wmape_fail'), false);

    const missingAccuracy = evaluateDemandGate({
      recentWmape: null,
      segment: 'A:core',
      band: 'precision',
    });
    assert.equal(missingAccuracy.needsManualConfirm, true);
    assert.ok(missingAccuracy.flags.includes('accuracy_missing'));
  });

  it('passes when accuracy is under target and not capped', () => {
    const result = evaluateDemandGate({
      recentWmape: 0.1,
      segment: 'A:core',
      band: 'precision',
      reconstructCapHit: false,
    });
    assert.equal(result.needsManualConfirm, false);
    assert.deepEqual(result.flags, []);
  });

  it('isAutoAdoptableSuggestion reads metrics flag', () => {
    assert.equal(isAutoAdoptableSuggestion({ needsManualConfirm: true }), false);
    assert.equal(isAutoAdoptableSuggestion({}), true);
  });
});
