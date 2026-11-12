import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withoutPreservedFingerprints } from './inventory-data-issues.js';
import {
  UNMAPPED_STATION_FP_PREFIX,
  UNMAPPED_WAREHOUSE_FP_PREFIX,
  buildUnmappedRegionCandidates,
} from './region-unmapped-scan.js';
import type { RegionMappingTables } from './region-mapping.js';

const tables: RegionMappingTables = {
  stations: new Map([['Amazon德国', 'EU']]),
  warehouses: new Map([['US-EAST', 'US']]),
};

describe('unmapped region candidates', () => {
  it('flags only stations and warehouses that resolve to UNMAPPED', () => {
    const issues = buildUnmappedRegionCandidates({
      stations: [
        { key: 'Amazon德国', skuId: 'sku-eu', qty: 10 },
        { key: ' Amazon比利时 ', skuId: 'sku-be', qty: 4 },
        { key: '', skuId: 'sku-blank', qty: 9 },
      ],
      warehouses: [
        { key: 'US-EAST', skuId: 'sku-us', qty: 3 },
        { key: 'CA-TORONTO', skuId: 'sku-ca', qty: 8 },
        { key: 'NO-SKU', skuId: '', qty: 1 },
      ],
      tables,
    });

    assert.deepEqual(
      issues.map((row) => [row.issueType, row.fingerprint, row.warehouseCode, row.qty, row.skuId]),
      [
        [
          'unmapped_station',
          `${UNMAPPED_STATION_FP_PREFIX}Amazon比利时`,
          'Amazon比利时',
          4,
          'sku-be',
        ],
        [
          'unmapped_warehouse',
          `${UNMAPPED_WAREHOUSE_FP_PREFIX}CA-TORONTO`,
          'CA-TORONTO',
          8,
          'sku-ca',
        ],
      ],
    );
  });

  it('keeps region fingerprints out of the main scan auto-resolve set', () => {
    const existing = [
      { id: 'a', fingerprint: `${UNMAPPED_STATION_FP_PREFIX}Amazon比利时` },
      { id: 'b', fingerprint: 'missing_available_at:sku:US-WEST:snapshot:none' },
      { id: 'c', fingerprint: `${UNMAPPED_WAREHOUSE_FP_PREFIX}CA-TORONTO` },
    ];
    const kept = withoutPreservedFingerprints(
      existing.map((row) => ({ id: row.id })),
      existing,
      [UNMAPPED_STATION_FP_PREFIX, UNMAPPED_WAREHOUSE_FP_PREFIX],
    );
    assert.deepEqual(kept, [{ id: 'b' }]);
  });
});
