import { runProcurementFeishuPullTask } from '../lib/procurement-feishu-pull-task.js';
import type { ProcurementListKey } from '../lib/procurement-bitable-list.js';

export async function runProcurementBulkStockPull(runId: string) {
  return runProcurementFeishuPullTask(runId, 'bulk_stock_request');
}

export async function runProcurementFollowUpPull(runId: string) {
  return runProcurementFeishuPullTask(runId, 'purchase_follow_up');
}

export type { ProcurementListKey };
