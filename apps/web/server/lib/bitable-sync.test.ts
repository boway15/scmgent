import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractFieldValue, normalizeBitableKey } from '../integrations/feishu-bitable.js';
import {
  BITABLE_FIELD_MAPS,
  isEmptyImportRow,
  mapBitableRecordToRow,
  mapBitableRecordsToRows,
} from './bitable-sync.js';

describe('normalizeBitableKey', () => {
  it('normalizes Chinese headers', () => {
    assert.equal(normalizeBitableKey('SKU编码'), 'sku编码');
    assert.equal(normalizeBitableKey('  Sale Date '), 'sale_date');
  });
});

describe('extractFieldValue', () => {
  it('formats millisecond timestamps as YYYY-MM-DD', () => {
    const value = extractFieldValue(1_704_067_200_000);
    assert.equal(value, '2024-01-01');
  });

  it('reads single-select objects', () => {
    assert.equal(extractFieldValue({ text: 'wayfair' }), 'wayfair');
  });

  it('joins person arrays', () => {
    assert.equal(extractFieldValue([{ name: 'Alice' }, { name: 'Bob' }]), 'Alice, Bob');
  });
});

describe('mapBitableRecordToRow', () => {
  it('maps SKU fields from Chinese column names', () => {
    const row = mapBitableRecordToRow(
      {
        record_id: 'rec1',
        fields: {
          SKU编码: 'SKU-HM-001',
          商品名称: '测试商品',
          单位: 'pcs',
          工厂编码: 'M-001',
        },
      },
      'skus',
    );
    assert.equal(row.sku_code, 'SKU-HM-001');
    assert.equal(row.name, '测试商品');
    assert.equal(row.unit, 'pcs');
    assert.equal(row.merchant_code, 'M-001');
  });

  it('maps inventory with date timestamp', () => {
    const row = mapBitableRecordToRow(
      {
        record_id: 'rec2',
        fields: {
          SKU编码: 'SKU-HM-001',
          仓库: 'US-WEST',
          可用库存: 120,
          盘点日期: 1_717_200_000_000,
        },
      },
      'inventory',
    );
    assert.equal(row.sku_code, 'SKU-HM-001');
    assert.equal(row.warehouse, 'US-WEST');
    assert.equal(row.qty_available, '120');
    assert.match(row.recorded_date, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('maps sales english aliases', () => {
    const row = mapBitableRecordToRow(
      {
        record_id: 'rec3',
        fields: {
          sku_code: 'SKU-HM-002',
          sale_date: '2026-05-01',
          qty_sold: '45',
          channel: 'amazon',
          warehouse_code: 'US-EAST',
        },
      },
      'sales',
    );
    assert.deepEqual(row, {
      sku_code: 'SKU-HM-002',
      sale_date: '2026-05-01',
      qty_sold: '45',
      channel: 'amazon',
      warehouse_code: 'US-EAST',
    });
  });
});

describe('mapBitableRecordsToRows', () => {
  it('filters empty rows', () => {
    const rows = mapBitableRecordsToRows(
      [
        { record_id: 'a', fields: { SKU编码: 'SKU-1', 商品名称: 'A' } },
        { record_id: 'b', fields: {} },
      ],
      'skus',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sku_code, 'SKU-1');
  });
});

describe('isEmptyImportRow', () => {
  it('detects blank rows', () => {
    assert.equal(isEmptyImportRow({}), true);
    assert.equal(isEmptyImportRow({ sku_code: '  ' }), true);
    assert.equal(isEmptyImportRow({ sku_code: 'X' }), false);
  });
});

describe('BITABLE_FIELD_MAPS', () => {
  it('defines maps for core bitable sync types', () => {
    assert.ok(BITABLE_FIELD_MAPS.skus.sku_code.includes('SKU编码'));
    assert.ok(BITABLE_FIELD_MAPS.inventory.warehouse.includes('仓库'));
    assert.ok(BITABLE_FIELD_MAPS.sales.qty_sold.includes('销量'));
    assert.ok(BITABLE_FIELD_MAPS.merchants.production_lead_days.includes('生产周期'));
    assert.ok(BITABLE_FIELD_MAPS.warehouse_leads.shipping_lead_days.includes('海运周期'));
    assert.ok(BITABLE_FIELD_MAPS.inventory_policy.safety_stock_days.includes('安全库存天数'));
  });
});
