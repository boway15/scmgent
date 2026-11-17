import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterDailySalesByResolvedRegion } from './sales-history-query.js';
import type { RegionMappingTables } from './region-mapping.js';

const tables: RegionMappingTables = {
  stations: new Map([['Amazon德国', 'EU']]),
  warehouses: new Map(),
};

describe('forecast region load', () => {
  it('keeps row-level US out of EU filter', () => {
    const rows = [
      {
        skuId: '1',
        qtySold: 1,
        saleDate: '2026-01-01',
        station: 'Amazon德国',
        warehouseCode: null,
        salesRegion: 'US',
      },
      {
        skuId: '1',
        qtySold: 2,
        saleDate: '2026-01-02',
        station: 'Amazon德国',
        warehouseCode: null,
        salesRegion: null,
      },
    ];
    const us = filterDailySalesByResolvedRegion(rows, 'US', tables);
    const eu = filterDailySalesByResolvedRegion(rows, 'EU', tables);
    assert.equal(us.length, 1);
    assert.equal(eu.length, 1);
    assert.equal(us[0]!.qtySold, 1);
    assert.equal(eu[0]!.qtySold, 2);
  });
});
