import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  procurementFeishuIoTaskNames,
  procurementPullTaskName,
  procurementPushTaskName,
} from './procurement-feishu-task-names.js';
import { parseProcurementFeishuPullTaskResult } from './procurement-feishu-pull-task.js';

describe('procurement-feishu-pull-task', () => {
  it('maps list types to distinct pull task names', () => {
    assert.equal(procurementPullTaskName('bulk_stock_request'), 'procurement_bulk_stock_pull');
    assert.equal(procurementPullTaskName('purchase_follow_up'), 'procurement_follow_up_pull');
  });

  it('pairs push and pull names per list for IO lock', () => {
    assert.deepEqual(procurementFeishuIoTaskNames('bulk_stock_request'), [
      procurementPushTaskName('bulk_stock_request'),
      procurementPullTaskName('bulk_stock_request'),
    ]);
    assert.deepEqual(procurementFeishuIoTaskNames('purchase_follow_up'), [
      'procurement_follow_up_push',
      'procurement_follow_up_pull',
    ]);
  });

  it('parses successful pull task result JSON', () => {
    const result = parseProcurementFeishuPullTaskResult(
      JSON.stringify({
        direction: 'from_feishu',
        mode: 'full_replace',
        listType: 'purchase_follow_up',
        imported: 42,
      }),
    );
    assert.equal(result?.imported, 42);
    assert.equal(result?.listType, 'purchase_follow_up');
    assert.equal(parseProcurementFeishuPullTaskResult('not-json'), null);
  });
});
