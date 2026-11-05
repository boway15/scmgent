import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDemandPlanAccuracyExportCsv } from './demand-plan-accuracy-export.js';

describe('demand-plan-accuracy-export', () => {
  it('returns empty csv when no plan rows', async () => {
    const result = await buildDemandPlanAccuracyExportCsv({ planRows: [] });
    assert.equal(result.rowCount, 0);
    assert.equal(result.skuCount, 0);
    assert.match(result.csv, /SKU/);
    assert.match(result.csv, /绝对误差/);
  });
});
