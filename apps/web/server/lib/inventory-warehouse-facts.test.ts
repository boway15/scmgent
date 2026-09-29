import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateWarehouseFacts,
  exceedsPositionMismatchThreshold,
  extractWarehouseFactsFromPayload,
  parseWarehouseFactColumn,
  selectWarehouseFacts,
} from './inventory-warehouse-facts.js';

describe('parseWarehouseFactColumn', () => {
  it('maps known 8 regions to warehouse codes', () => {
    const parsed = parseWarehouseFactColumn('海外仓库存_美东');
    assert.deepEqual(parsed, {
      prefix: '海外仓库存_',
      bucket: 'on_hand',
      warehouseRaw: '美东',
      warehouseCode: 'US-EAST',
      mapped: true,
      bucketName: '海外仓库存',
    });
  });

  it('keeps unknown warehouse raw as code', () => {
    const parsed = parseWarehouseFactColumn('调拨在途_英国');
    assert.equal(parsed?.bucket, 'transfer_transit');
    assert.equal(parsed?.warehouseRaw, '英国');
    assert.equal(parsed?.warehouseCode, '英国');
    assert.equal(parsed?.mapped, false);
  });

  it('skips total columns', () => {
    assert.equal(parseWarehouseFactColumn('海外仓库存_合计'), null);
    assert.equal(parseWarehouseFactColumn('调拨在途_合计'), null);
  });

  it('parses allocated and eta prefixes', () => {
    assert.equal(parseWarehouseFactColumn('已调拨未在途_美西')?.bucket, 'allocated_not_shipped');
    assert.equal(parseWarehouseFactColumn('预计10天上架_美西')?.bucket, 'eta_bucket');
    assert.equal(parseWarehouseFactColumn('预计10-20天上架_美西')?.bucket, 'eta_bucket');
    assert.equal(parseWarehouseFactColumn('预计超20天上架_美西')?.bucket, 'eta_bucket');
  });
});

describe('extractWarehouseFactsFromPayload', () => {
  it('extracts warehouse facts and skips totals', () => {
    const { facts, unmatchedQtyColumns } = extractWarehouseFactsFromPayload({
      skuCode: 'SKU-A',
      skuId: 'id-a',
      source: 'inventory_query',
      payload: {
        海外仓库存_美东: '10',
        海外仓库存_合计: '10',
        调拨在途_美东: '3',
        已调拨未在途_英国: '2',
        全链条合计库存: '15',
      },
    });
    assert.equal(facts.length, 3);
    assert.equal(
      facts.find((f) => f.warehouseCode === 'US-EAST' && f.bucket === 'on_hand')?.qty,
      10,
    );
    assert.equal(
      facts.find((f) => f.warehouseCode === '英国' && f.bucket === 'allocated_not_shipped')?.mapped,
      false,
    );
    assert.ok(unmatchedQtyColumns.includes('全链条合计库存'));
  });
});

describe('aggregateWarehouseFacts', () => {
  it('sums multi-row same sku warehouse bucket before select', () => {
    const aggregated = aggregateWarehouseFacts([
      {
        skuCode: 'SKU-A',
        skuId: 'id-a',
        warehouseRaw: '美东',
        warehouseCode: 'US-EAST',
        mapped: true,
        bucket: 'on_hand',
        bucketName: '海外仓库存',
        qty: 4,
        source: 'inventory_query',
        selected: false,
        columnName: '海外仓库存_美东',
      },
      {
        skuCode: 'SKU-A',
        skuId: 'id-a',
        warehouseRaw: '美东',
        warehouseCode: 'US-EAST',
        mapped: true,
        bucket: 'on_hand',
        bucketName: '海外仓库存',
        qty: 6,
        source: 'inventory_query',
        selected: false,
        columnName: '海外仓库存_美东',
      },
    ]);
    assert.equal(aggregated.length, 1);
    assert.equal(aggregated[0]?.qty, 10);
  });
});

describe('selectWarehouseFacts', () => {
  it('prefers full_chain for on_hand and inventory_query for transit', () => {
    const { facts, sourceMismatches } = selectWarehouseFacts([
      {
        skuCode: 'SKU-A',
        skuId: 'id-a',
        warehouseRaw: '美东',
        warehouseCode: 'US-EAST',
        mapped: true,
        bucket: 'on_hand',
        bucketName: '海外仓库存',
        qty: 11,
        source: 'inventory_query',
        selected: false,
        columnName: '海外仓库存_美东',
      },
      {
        skuCode: 'SKU-A',
        skuId: 'id-a',
        warehouseRaw: '美东',
        warehouseCode: 'US-EAST',
        mapped: true,
        bucket: 'on_hand',
        bucketName: '海外仓库存',
        qty: 12,
        source: 'full_chain',
        selected: false,
        columnName: '海外仓库存_美东',
      },
      {
        skuCode: 'SKU-A',
        skuId: 'id-a',
        warehouseRaw: '美东',
        warehouseCode: 'US-EAST',
        mapped: true,
        bucket: 'transfer_transit',
        bucketName: '调拨在途',
        qty: 5,
        source: 'inventory_query',
        selected: false,
        columnName: '调拨在途_美东',
      },
      {
        skuCode: 'SKU-A',
        skuId: 'id-a',
        warehouseRaw: '美东',
        warehouseCode: 'US-EAST',
        mapped: true,
        bucket: 'transfer_transit',
        bucketName: '调拨在途',
        qty: 50,
        source: 'full_chain',
        selected: false,
        columnName: '调拨在途_美东',
      },
    ]);

    const selectedOnHand = facts.find((f) => f.bucket === 'on_hand' && f.selected);
    const selectedTransit = facts.find((f) => f.bucket === 'transfer_transit' && f.selected);
    assert.equal(selectedOnHand?.source, 'full_chain');
    assert.equal(selectedOnHand?.qty, 12);
    assert.equal(selectedTransit?.source, 'inventory_query');
    assert.equal(selectedTransit?.qty, 5);
    assert.equal(sourceMismatches.length, 1);
    assert.equal(sourceMismatches[0]?.bucket, 'transfer_transit');
  });

  it('keeps single-source rows selected without mismatch', () => {
    const { facts, sourceMismatches } = selectWarehouseFacts([
      {
        skuCode: 'SKU-B',
        skuId: null,
        warehouseRaw: '美西',
        warehouseCode: 'US-WEST',
        mapped: true,
        bucket: 'on_hand',
        bucketName: '海外仓库存',
        qty: 8,
        source: 'inventory_query',
        selected: false,
        columnName: '海外仓库存_美西',
      },
    ]);
    assert.equal(facts[0]?.selected, true);
    assert.equal(sourceMismatches.length, 0);
  });
});

describe('exceedsPositionMismatchThreshold', () => {
  it('flags large absolute or ratio gaps', () => {
    assert.equal(exceedsPositionMismatchThreshold(10, 10), false);
    assert.equal(exceedsPositionMismatchThreshold(100, 110), false);
    assert.equal(exceedsPositionMismatchThreshold(0, 21), true);
    assert.equal(exceedsPositionMismatchThreshold(100, 120), true);
  });
});
