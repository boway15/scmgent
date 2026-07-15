import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSkuAccuracySampleReport, summarizeAccuracyBySku } from './forecast-sku-accuracy-sample.js';
import { exogenousSkuCodesFromFlags, loadExogenousFlagsFromCsv } from './forecast-exogenous-flags.js';
import { resolveExogenousSkuSet } from './forecast-accuracy-outlier.js';

describe('forecast-sku-accuracy-sample', () => {
  it('builds top and random samples', () => {
    const rows = [
      { skuCode: 'A', predictedDaily: 10, actualDaily: 8, kpiCore: true },
      { skuCode: 'B', predictedDaily: 20, actualDaily: 5, kpiCore: true },
      { skuCode: 'C', predictedDaily: 5, actualDaily: 5, kpiCore: true },
    ];
    const r = buildSkuAccuracySampleReport(rows, { topN: 2, randomSampleN: 1, goodSampleN: 1 });
    assert.equal(r.topErrors.length, 2);
    assert.equal(r.topErrors[0]!.skuCode, 'B');
    assert.ok(r.randomCoreSample.length <= 1);
  });

  it('WMAPE stays high when monthly sums offset across months', () => {
    const rows = [
      { skuCode: 'X', predictedDaily: 100, actualDaily: 10, kpiCore: true },
      { skuCode: 'X', predictedDaily: 10, actualDaily: 100, kpiCore: true },
    ];
    const [summary] = summarizeAccuracyBySku(rows);
    assert.ok(summary!.wmape != null && summary!.wmape > 0.5);
    assert.ok(summary!.sumDeviation != null && Math.abs(summary!.sumDeviation) < 0.05);
    assert.ok(summary!.bias != null && Math.abs(summary!.bias) < 0.05);
  });

  it('random sample excludes T4B and T99 SKUs', () => {
    const rows = [
      { skuCode: 'A', predictedDaily: 10, actualDaily: 8, kpiCore: true, profileSegment: 'T1' },
      { skuCode: 'B', predictedDaily: 5, actualDaily: 5, kpiCore: true, profileSegment: 'T4B' },
      { skuCode: 'C', predictedDaily: 6, actualDaily: 6, kpiCore: true, profileSegment: 'T2' },
    ];
    const r = buildSkuAccuracySampleReport(rows, { topN: 0, randomSampleN: 5, seed: 1 });
    assert.ok(r.randomCoreSample.every((s) => s.skuCode !== 'B'));
  });
});

describe('forecast-exogenous-flags', () => {
  it('loads manual flags from sample csv', () => {
    const flags = loadExogenousFlagsFromCsv();
    const skus = exogenousSkuCodesFromFlags(flags);
    assert.ok(skus.has('DJ502530_2'));
  });

  it('merges manual with auto outliers', () => {
    const rows = [
      { skuCode: 'A', actualDaily: 10, forecastDaily: 10 },
      { skuCode: 'B', actualDaily: 10, forecastDaily: 40 },
    ];
    const merged = resolveExogenousSkuSet(rows, { manualSkus: new Set(['A']) });
    assert.equal(merged.has('A'), true);
    assert.equal(merged.has('B'), true);
  });
});
