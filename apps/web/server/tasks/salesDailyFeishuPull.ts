import { runSalesDailyFeishuPullTask } from '../lib/feishu-sales-daily-pull-task.js';

export async function runSalesDailyFeishuPull(runId: string) {
  return runSalesDailyFeishuPullTask(runId);
}
