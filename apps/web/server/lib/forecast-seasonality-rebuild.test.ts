import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthlyTrendRowsFromSkuMonthly } from './forecast-seasonality-rebuild.js';

describe('forecast-seasonality-rebuild', () => {
  it('aggregates sku monthly rows into category and project_group trend rows', () => {
    const rows = buildMonthlyTrendRowsFromSkuMonthly([
      { category: 'Outdoor|Patio', saleYear: 2025, month: 7, qtySold: 100 },
      { category: 'Outdoor|Patio', saleYear: 2025, month: 8, qtySold: 120 },
      { category: 'Outdoor|Desk', saleYear: 2025, month: 7, qtySold: 50 },
    ]);

    const categoryOutdoorPatio = rows.filter(
      (r) => r.dimensionType === 'category' && r.dimensionValue === 'Outdoor|Patio',
    );
    assert.equal(categoryOutdoorPatio.length, 2);
    assert.equal(categoryOutdoorPatio.find((r) => r.month === '2025-07')?.qtySold, 100);

    const projectPatio = rows.filter(
      (r) => r.dimensionType === 'project_group' && r.dimensionValue === 'Patio',
    );
    assert.ok(projectPatio.some((r) => r.month === '2025-07' && r.qtySold === 100));
  });
});
