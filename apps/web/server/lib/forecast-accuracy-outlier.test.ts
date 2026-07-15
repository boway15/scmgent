import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectOutlierSkus,
  filterRowsForCoreKpi,
  isOutlierRow,
  summarizeWmapeWithOutlierExclusion,
} from './forecast-accuracy-outlier.js';

describe('forecast-accuracy-outlier', () => {
  it('flags row with APE > 150%', () => {
    assert.equal(isOutlierRow(10, 30), true);
    assert.equal(isOutlierRow(100, 120), false);
  });

  it('excludes whole SKU when any month is outlier', () => {
    const rows = [
      { skuCode: 'A', actualDaily: 10, forecastDaily: 10 },
      { skuCode: 'B', actualDaily: 10, forecastDaily: 35 },
      { skuCode: 'B', actualDaily: 10, forecastDaily: 10 },
    ];
    const outliers = detectOutlierSkus(rows);
    assert.equal(outliers.has('B'), true);
    assert.equal(outliers.has('A'), false);
    const core = filterRowsForCoreKpi(
      rows.map((r) => ({ ...r, actualMonthly: 300 })),
      { outlierSkuSet: outliers, minActualMonthly: 50 },
    );
    assert.equal(core.length, 1);
    assert.equal(core[0]!.skuCode, 'A');
  });

  it('summarizes core WMAPE lower than all', () => {
    const rows = [
      { skuCode: 'A', actualDaily: 100, forecastDaily: 110, actualMonthly: 3000 },
      { skuCode: 'B', actualDaily: 100, forecastDaily: 400, actualMonthly: 3000 },
    ];
    const s = summarizeWmapeWithOutlierExclusion(rows);
    assert.ok(s.wmapeAll != null && s.wmapeCore != null);
    assert.ok(s.wmapeCore < s.wmapeAll);
    assert.equal(s.outlierSkuCount, 1);
  });
});
