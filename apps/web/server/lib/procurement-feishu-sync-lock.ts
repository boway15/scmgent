import {
  labelForProcurementList,
  type ProcurementListKey,
} from './procurement-bitable-list.js';
import { countRunningTaskRuns, type TaskName } from './task-runs.js';
import {
  procurementFeishuIoTaskNames,
  procurementPushTaskName,
} from './procurement-feishu-task-names.js';

/**
 * Refuse starting another Feishu push/pull when one is already running for the same list.
 * Call before `startTaskRun` for a new push/pull.
 */
export async function assertNoRunningProcurementFeishuIo(listType: ProcurementListKey) {
  const label = labelForProcurementList(listType);
  for (const taskName of procurementFeishuIoTaskNames(listType)) {
    const running = await countRunningTaskRuns(taskName);
    if (running > 0) {
      const kind = taskName.endsWith('_push') ? '同步到飞书' : '从飞书同步';
      throw new Error(`${label} 正在${kind}，请稍后再试。`);
    }
  }
}

/**
 * After a pull task_run is already started, detect conflicting concurrent I/O
 * (push running, or another pull already running).
 */
export async function detectProcurementFeishuPullConflict(
  listType: ProcurementListKey,
  currentPullTaskName: TaskName,
): Promise<string | null> {
  const label = labelForProcurementList(listType);
  const pushRunning = await countRunningTaskRuns(procurementPushTaskName(listType));
  if (pushRunning > 0) {
    return `${label} 正在同步到飞书，跳过本次定时拉取。`;
  }
  const pullRunning = await countRunningTaskRuns(currentPullTaskName);
  if (pullRunning > 1) {
    return `${label} 正在从飞书同步，跳过本次定时拉取。`;
  }
  return null;
}
