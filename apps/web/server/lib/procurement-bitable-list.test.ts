import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getProcurementListConfig,
  isProcurementListType,
  parseProcurementUploadBuffer,
  buildFeishuPushPlan,
} from './procurement-bitable-list.js';

describe('procurement-bitable-list', () => {
  it('recognizes procurement list types', () => {
    assert.equal(isProcurementListType('bulk_stock_request'), true);
    assert.equal(isProcurementListType('purchase_follow_up'), true);
    assert.equal(isProcurementListType('skus'), false);
  });

  it('reads table env keys in config', () => {
    const prevBulk = process.env.FEISHU_BITABLE_TABLE_BULK_STOCK_REQUEST;
    const prevFollow = process.env.FEISHU_BITABLE_TABLE_PURCHASE_FOLLOW_UP;
    const prevApp = process.env.FEISHU_BITABLE_APP_TOKEN;

    process.env.FEISHU_BITABLE_APP_TOKEN = 'HPJzbHdPea7elSs92T8c31BTnxe';
    process.env.FEISHU_BITABLE_TABLE_BULK_STOCK_REQUEST = 'tbl7H8F6rc2xeFGf';
    process.env.FEISHU_BITABLE_TABLE_PURCHASE_FOLLOW_UP = 'tbl3m7FqgPVr4kmY';

    const config = getProcurementListConfig();
    assert.equal(config.bulk_stock_request.configured, true);
    assert.equal(config.bulk_stock_request.tableId, 'tbl7H8F6rc2xeFGf');
    assert.equal(config.purchase_follow_up.tableId, 'tbl3m7FqgPVr4kmY');

    process.env.FEISHU_BITABLE_TABLE_BULK_STOCK_REQUEST = prevBulk;
    process.env.FEISHU_BITABLE_TABLE_PURCHASE_FOLLOW_UP = prevFollow;
    process.env.FEISHU_BITABLE_APP_TOKEN = prevApp;
  });

  it('parses csv upload preserving column headers', async () => {
    const csv = 'RequestNo,SKU,Qty\nPO-001,DJ001,10\nPO-002,DJ002,5';
    const buffer = new TextEncoder().encode(csv).buffer;
    const rows = await parseProcurementUploadBuffer(buffer, 'bulk-stock.csv');
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.RequestNo, 'PO-001');
    assert.equal(rows[0]?.SKU, 'DJ001');
    assert.equal(rows[1]?.Qty, '5');
  });

  it('builds feishu push plan with update/create/delete counts', () => {
    const plan = buildFeishuPushPlan(
      [
        {
          id: 'local-1',
          rowIndex: 0,
          bitableRecordId: 'rec-1',
          rowData: { SKU: 'A', Qty: '1' },
        },
        {
          id: 'local-2',
          rowIndex: 1,
          bitableRecordId: null,
          rowData: { SKU: 'B', Qty: '2' },
        },
      ],
      ['rec-1', 'rec-old'],
    );

    assert.equal(plan.toUpdate, 1);
    assert.equal(plan.toCreate, 1);
    assert.equal(plan.toDelete, 1);
    assert.deepEqual(plan.deleteRecordIds, ['rec-old']);
  });
});
