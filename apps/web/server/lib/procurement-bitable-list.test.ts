import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearProcurementListData,
  fixedColumnsForProcurementList,
  getProcurementListConfig,
  isProcurementListType,
  normalizeInputRows,
  parseProcurementUploadBuffer,
  buildFeishuFullReplacePlan,
  writableProcurementFieldNames,
} from './procurement-bitable-list.js';
import {
  missingBitableFieldNames,
  pickExistingBitableFields,
} from '../integrations/feishu-bitable.js';

describe('procurement-bitable-list', () => {
  it('recognizes procurement list types', () => {
    assert.equal(isProcurementListType('bulk_stock_request'), true);
    assert.equal(isProcurementListType('purchase_follow_up'), true);
    assert.equal(isProcurementListType('skus'), false);
  });

  it('exports clearProcurementListData for local-only clear', () => {
    assert.equal(typeof clearProcurementListData, 'function');
  });

  it('locks fixed column schemas for both lists', () => {
    const followUp = fixedColumnsForProcurementList('purchase_follow_up');
    const bulk = fixedColumnsForProcurementList('bulk_stock_request');
    assert.equal(followUp[0], '需求单号');
    assert.equal(followUp.at(-1), '单据状态');
    assert.equal(followUp.length, 28);
    assert.equal(bulk[0], '需求单号');
    assert.equal(bulk.at(-1), '推送时间');
    assert.equal(bulk.length, 42);
    assert.ok(bulk.includes('确认交期'));
    assert.ok(followUp.includes('跟单说明'));
  });

  it('detects missing Feishu field names that cause FieldNameNotFound', () => {
    const required = fixedColumnsForProcurementList('bulk_stock_request');
    const missing = missingBitableFieldNames(required, ['需求单号']);
    assert.equal(missing.length, 41);
    assert.ok(missing.includes('SKU'));
    assert.ok(missing.includes('推送时间'));
    assert.equal(missingBitableFieldNames(required, required).length, 0);
  });

  it('maps import rows onto fixed columns and drops extras', () => {
    const columns = fixedColumnsForProcurementList('purchase_follow_up');
    const normalized = normalizeInputRows(
      [
        {
          rowData: {
            需求单号: 'SPO1',
            SKU: 'DJ1',
            单据状态: '待入库',
            飞书多余列: 'x',
          },
        },
      ],
      columns,
    );
    assert.deepEqual(normalized.columnOrder, columns);
    assert.equal(normalized.rows[0]?.rowData['飞书多余列'], undefined);
    assert.equal(normalized.rows[0]?.rowData['SKU'], 'DJ1');
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
    const bytes = new TextEncoder().encode(csv);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parsed = await parseProcurementUploadBuffer(buffer, 'bulk-stock.csv');
    assert.equal(parsed.rows.length, 2);
    assert.deepEqual(parsed.columnOrder, ['RequestNo', 'SKU', 'Qty']);
    assert.equal(parsed.rows[0]?.RequestNo, 'PO-001');
    assert.equal(parsed.rows[0]?.SKU, 'DJ001');
    assert.equal(parsed.rows[1]?.Qty, '5');
  });

  it('parses follow-up csv with multiline quoted 跟单说明', async () => {
    const csv = [
      '需求单号,SKU,跟单说明,单据状态',
      'SPO1,DJ1,"壁炉产前样寄到贝诺，7/3开发已看',
      '碳块需要开模,周期大概20-25天左右货好；",待入库',
      'SPO2,DJ2,,待入库',
    ].join('\n');
    const bytes = new TextEncoder().encode(csv);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parsed = await parseProcurementUploadBuffer(buffer, '采购跟单.csv');
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0]?.['需求单号'], 'SPO1');
    assert.match(parsed.rows[0]?.['跟单说明'] ?? '', /碳块需要开模/);
    assert.equal(parsed.rows[0]?.['单据状态'], '待入库');
    assert.equal(parsed.rows[1]?.['需求单号'], 'SPO2');
  });

  it('builds full-replace feishu push plan (delete all then recreate)', () => {
    const plan = buildFeishuFullReplacePlan(
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

    assert.equal(plan.mode, 'full_replace');
    assert.equal(plan.toWrite, 2);
    assert.equal(plan.toDelete, 2);
    assert.deepEqual(plan.deleteRecordIds, ['rec-1', 'rec-old']);
    assert.equal(plan.creates.length, 2);
  });

  it('drops unknown local fields on push to avoid FieldNameNotFound', () => {
    const allowed = writableProcurementFieldNames(
      ['需求单号', 'SKU', '推送时间'],
      ['需求单号', 'SKU', '推送时间', '推送日期（+2天）'],
    );
    assert.deepEqual(allowed, ['需求单号', 'SKU', '推送时间']);

    const plan = buildFeishuFullReplacePlan(
      [
        {
          id: 'local-1',
          rowIndex: 0,
          bitableRecordId: null,
          rowData: {
            需求单号: 'SPO1',
            SKU: 'DJ1',
            飞书没有的列: 'boom',
            '推送日期（+2天）': 'ignored-extra',
          },
        },
      ],
      [],
      allowed,
    );

    assert.equal(plan.toWrite, 1);
    assert.deepEqual(plan.creates[0]?.fields, {
      需求单号: 'SPO1',
      SKU: 'DJ1',
    });
    assert.equal(
      pickExistingBitableFields({ 需求单号: 'a', 幽灵列: 'b' }, ['需求单号'])['幽灵列'],
      undefined,
    );
  });

  it('applies the same writable-field intersection for purchase_follow_up', () => {
    const columns = fixedColumnsForProcurementList('purchase_follow_up');
    const feishuNames = [
      ...columns,
      '计算交期',
      '减10天-计算交期',
      '减15天计算交期',
      '减去7天计算交期',
    ];
    const allowed = writableProcurementFieldNames(columns, feishuNames);
    assert.deepEqual(allowed, columns);

    const plan = buildFeishuFullReplacePlan(
      [
        {
          id: 'fu-1',
          rowIndex: 0,
          bitableRecordId: null,
          rowData: {
            需求单号: 'SPO9',
            SKU: 'DJ9',
            单据状态: '待入库',
            计算交期: 'should-ignore',
            本地多余列: 'boom',
          },
        },
      ],
      ['rec-old'],
      allowed,
    );

    assert.equal(plan.mode, 'full_replace');
    assert.equal(plan.toDelete, 1);
    assert.deepEqual(plan.creates[0]?.fields, {
      需求单号: 'SPO9',
      SKU: 'DJ9',
      单据状态: '待入库',
    });
  });
});
