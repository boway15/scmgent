import { runInventoryQueryPullTask } from '../lib/inventory-query-pull-task.js';

export async function runInventoryQueryPull(runId: string) {
  return runInventoryQueryPullTask(runId);
}
