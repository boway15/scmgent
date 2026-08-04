import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FEISHU_SYNC_PRESERVED_SKU_COLUMN_KEYS,
  FEISHU_SYNC_SKU_COLUMN_KEYS,
  INVENTORY_PRODUCT_FIELD_OWNERSHIP,
  ownershipByField,
} from './inventory-product-ownership.js';
import { inventoryMasterToSkuColumns } from './inventory-sku-master.js';
import {
  mapInventoryTurnoverBitableFields,
} from './inventory-turnover-bitable-mapper.js';
import { expandFobInventoryRows } from './fob-inventory-import.js';
import {
  inferTurnoverHeaderGroup,
  readSkuPackagingFromEncodingMeta,
  extractTurnoverSnapshot,
} from './inventory-turnover-snapshot.js';
import { FEISHU_INVENTORY_TURNOVER_HEADERS } from './inventory-turnover-feishu-headers.js';

describe('inventory × product master boundary', () => {
  it('documents product-master owned operational fields', () => {
    for (const key of ['moq', 'unit', 'replenishLight', 'isActive'] as const) {
      assert.ok(FEISHU_SYNC_PRESERVED_SKU_COLUMN_KEYS.includes(key));
    }
    const row = ownershipByField('moq / unit / replenishLight / isActive');
    assert.equal(row?.owner, 'product_master');
  });

  it('documents lifecycle as system-owned from sales', () => {
    const row = ownershipByField('lifecycle');
    assert.ok(row);
    assert.equal(row.owner, 'system');
    assert.ok(FEISHU_SYNC_PRESERVED_SKU_COLUMN_KEYS.includes('lifecycle'));
    assert.ok(!FEISHU_SYNC_SKU_COLUMN_KEYS.includes('lifecycle' as never));
  });

  it('keeps ownership catalog non-empty and unique by field', () => {
    const fields = INVENTORY_PRODUCT_FIELD_OWNERSHIP.map((r) => r.field);
    assert.equal(new Set(fields).size, fields.length);
    assert.ok(fields.length >= 8);
  });

  it('feishu mapper does not emit 生命周期', () => {
    const mapped = mapInventoryTurnoverBitableFields({
      SKU: 'DJ503970_2',
      SKU名称: '测试',
      品类: '床',
      生命周期: '不应被采用',
      海外仓在库: '1',
      德国: '1',
      调拨在途合计: '0',
      供应商订单: '0',
      预下单: '0',
    });
    assert.ok(mapped);
    assert.equal(mapped.row['生命周期'], undefined);
    assert.ok(!('生命周期' in mapped.row));
  });

  it('expand path leaves lifecycle undefined when feishu row has no such column', () => {
    const mapped = mapInventoryTurnoverBitableFields({
      SKU: 'DJ503970_2',
      SKU名称: '测试床',
      品类: '床',
      销售国家: '德国',
      产品分类: 'C',
      供应商编码: 'S1',
      采购周期: '50',
      采购价: '100',
      美东: '0',
      德国: '2',
      海外仓在库: '2',
      调拨在途合计: '0',
      供应商订单: '3',
      预下单: '1',
    });
    assert.ok(mapped);
    const expanded = expandFobInventoryRows([mapped.row], '2026-07-24');
    assert.equal(expanded.length, 1);
    assert.equal(expanded[0]?.lifecycle, undefined);
  });

  it('omitting lifecycle in inventory master mapping yields undefined (preserve existing via ??)', () => {
    const cols = inventoryMasterToSkuColumns({
      skuCode: 'DJ503970_2',
      name: '测试床',
      category: '床',
      salesCountry: '德国',
    });
    assert.equal(cols.lifecycle, undefined);
    assert.equal(cols.category, '床');
  });

  it('product master packaging reads feishu snapshot keys', () => {
    const snapshot = extractTurnoverSnapshot({
      SKU: 'X',
      '包装长宽高cm': '10*20*30',
      '体积(m3)': '0.2',
      '毛重(Kg)': '12.5',
    });
    const pack = readSkuPackagingFromEncodingMeta({ turnoverSnapshot: snapshot });
    assert.equal(pack.packDimensionsCm, '10*20*30');
    assert.equal(pack.volumeM3, '0.2');
    assert.equal(pack.grossWeightKg, '12.5');
  });

  it('feishu headers classify into exactly three overview groups', () => {
    const allowed = new Set(['主数据', '库存数据', '销售与预测']);
    for (const header of FEISHU_INVENTORY_TURNOVER_HEADERS) {
      const group = inferTurnoverHeaderGroup(header);
      assert.ok(allowed.has(group), `${header} → ${group}`);
    }
    assert.equal(inferTurnoverHeaderGroup('包装长宽高cm'), '主数据');
    assert.equal(inferTurnoverHeaderGroup('近30天毛利率'), '主数据');
    assert.equal(inferTurnoverHeaderGroup('美东'), '销售与预测');
    assert.equal(inferTurnoverHeaderGroup('德国'), '销售与预测');
    assert.equal(inferTurnoverHeaderGroup('预计海外周转天数'), '库存数据');
    assert.equal(inferTurnoverHeaderGroup('30天销量'), '销售与预测');
  });
});
