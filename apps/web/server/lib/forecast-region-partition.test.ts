import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectMappedRegions,
  deriveMonthlyQtyFromDaily,
  firstSaleDateFromRows,
  groupRowsBySalesRegion,
  type RegionPartitionableRow,
} from './forecast-region-partition.js';
import type { RegionMappingTables } from './region-mapping.js';

const tables: RegionMappingTables = {
  stations: new Map([
    ['Amazon德国', 'EU'],
    ['wayfair英国', 'UK'],
    ['Amazon美国', 'US'],
  ]),
  warehouses: new Map(),
};

describe('forecast-region-partition', () => {
  it('groups rows by mapped station region and sends unmapped to UNMAPPED', () => {
    const rows: Array<RegionPartitionableRow & { id: number; station: string }> = [
      { id: 1, station: 'Amazon德国' },
      { id: 2, station: 'wayfair英国' },
      { id: 3, station: 'Amazon美国' },
      { id: 4, station: 'Amazon比利时' },
      { id: 5, station: '' },
      { id: 6, station: '美国' },
    ];
    const groups = groupRowsBySalesRegion(rows, tables);
    assert.deepEqual([...groups.keys()].sort(), ['EU', 'UK', 'UNMAPPED', 'US']);
    assert.equal(groups.get('EU')!.length, 1);
    assert.equal(groups.get('UNMAPPED')!.length, 3);
    assert.equal(groups.get('US')!.length, 1);
    assert.equal(groups.get('UK')!.length, 1);
  });

  it('collectMappedRegions lists configured regions without UNMAPPED', () => {
    const regions = collectMappedRegions(tables);
    assert.deepEqual([...regions].sort(), ['EU', 'UK', 'US']);
  });

  it('derives monthly qty from daily rows aggregating same month', () => {
    const rows = [
      { saleDate: '2026-01-05', qtySold: 3 },
      { saleDate: '2026-01-31', qtySold: 7 },
      { saleDate: '2026-02-01', qtySold: 4 },
      { saleDate: 'invalid', qtySold: 100 },
    ];
    const monthly = deriveMonthlyQtyFromDaily(rows).sort(
      (a, b) => a.saleYear - b.saleYear || a.month - b.month,
    );
    assert.deepEqual(monthly, [
      { saleYear: 2026, month: 1, qtySold: 10 },
      { saleYear: 2026, month: 2, qtySold: 4 },
    ]);
  });

  it('firstSaleDateFromRows returns earliest date and null for empty', () => {
    assert.equal(
      firstSaleDateFromRows([
        { saleDate: '2026-03-01' },
        { saleDate: '2025-12-31' },
        { saleDate: '2026-01-15' },
      ]),
      '2025-12-31',
    );
    assert.equal(firstSaleDateFromRows([]), null);
  });
});
