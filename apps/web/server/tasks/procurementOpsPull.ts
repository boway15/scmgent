import { runProcurementOpsPullTask } from '../lib/procurement-ops-pull-task.js';

export async function runProcurementOpsPull(runId: string) {
  return runProcurementOpsPullTask(runId);
}
