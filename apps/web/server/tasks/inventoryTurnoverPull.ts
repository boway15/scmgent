import { runInventoryTurnoverPullTask } from '../lib/inventory-turnover-pull-task.js';

export async function runInventoryTurnoverPull(runId: string) {
  return runInventoryTurnoverPullTask(runId);
}
