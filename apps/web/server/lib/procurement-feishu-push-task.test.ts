import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProcurementFeishuPushTaskResult,
  procurementPushTaskName,
} from './procurement-feishu-push-task.js';

describe('procurement-feishu-push-task', () => {
  it('maps list types to distinct task names', () => {
    assert.equal(procurementPushTaskName('bulk_stock_request'), 'procurement_bulk_stock_push');
    assert.equal(procurementPushTaskName('purchase_follow_up'), 'procurement_follow_up_push');
  });

  it('parses successful push task result JSON', () => {
    const result = parseProcurementFeishuPushTaskResult(
      JSON.stringify({
        direction: 'to_feishu',
        mode: 'full_replace',
        listType: 'bulk_stock_request',
        pushed: 10,
        deleted: 3,
        created: 10,
        fieldsCreated: 0,
      }),
    );
    assert.equal(result?.created, 10);
    assert.equal(result?.listType, 'bulk_stock_request');
    assert.equal(parseProcurementFeishuPushTaskResult('not-json'), null);
  });
});
