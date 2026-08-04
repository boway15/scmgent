import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultVisibleInventoryQueryColumns,
  mapInventoryQueryBitableRecord,
  mapInventoryQueryBitableRecords,
} from './inventory-query-feishu-mapper.js';

describe('inventory-query-feishu-mapper', () => {
  it('flattens field values and extracts SKU', () => {
    const mapped = mapInventoryQueryBitableRecord({
      record_id: 'r1',
      fields: {
        SKU: 'ABC-1',
        海外仓库存_美东: 12,
        品类: { text: '家具' },
      },
    });
    assert.equal(mapped.skuCode, 'ABC-1');
    assert.equal(mapped.payload.SKU, 'ABC-1');
    assert.equal(mapped.payload.海外仓库存_美东, '12');
    assert.equal(mapped.payload.品类, '家具');
  });

  it('keeps Feishu field order and fills missing keys', () => {
    const mapped = mapInventoryQueryBitableRecord(
      {
        record_id: 'r1',
        fields: {
          SKU: 'A',
          海外仓库存_美东: { type: 2, ui_type: 'Number', value: 8 },
        },
      },
      ['品类', 'SKU', '海外仓库存_美东', '调拨在途_美东'],
    );
    assert.deepEqual(Object.keys(mapped.payload), [
      '品类',
      'SKU',
      '海外仓库存_美东',
      '调拨在途_美东',
    ]);
    assert.equal(mapped.payload.品类, '');
    assert.equal(mapped.payload.海外仓库存_美东, '8');
    assert.equal(mapped.payload.调拨在途_美东, '');
  });

  it('counts rows without SKU as warnings/skipped', () => {
    const result = mapInventoryQueryBitableRecords([
      { record_id: 'r1', fields: { SKU: 'A', 海外仓库存_合计: 1 } },
      { record_id: 'r2', fields: { 品类: 'X' } },
    ]);
    assert.equal(result.items.length, 1);
    assert.equal(result.warningCount, 1);
    assert.equal(result.skipped, 1);
  });

  it('defaults visible columns to all Feishu fields', () => {
    const all = [
      '品类',
      'SKU',
      '其它',
      '海外仓库存_美东',
      '调拨在途_合计',
    ];
    assert.deepEqual(defaultVisibleInventoryQueryColumns(all), all);
    assert.deepEqual(defaultVisibleInventoryQueryColumns([]), []);
  });
});
