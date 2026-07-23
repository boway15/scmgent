import {
  executeProcurementFeishuSync,
  getProcurementListConfig,
  labelForProcurementList,
  type ProcurementListKey,
} from './procurement-bitable-list.js';
import {
  assertNoRunningProcurementFeishuIo,
  detectProcurementFeishuPullConflict,
} from './procurement-feishu-sync-lock.js';
import { procurementPullTaskName } from './procurement-feishu-task-names.js';
import { finishTaskRun } from './task-runs.js';

export const PROCUREMENT_FEISHU_PULL_ACTOR = 'cron';

export type ProcurementFeishuPullTaskResult = {
  direction: 'from_feishu';
  mode: 'full_replace';
  listType: ProcurementListKey;
  imported: number;
};

export { assertNoRunningProcurementFeishuIo, procurementPullTaskName };

export function parseProcurementFeishuPullTaskResult(
  summary: string | null | undefined,
): ProcurementFeishuPullTaskResult | null {
  if (!summary) return null;
  try {
    return JSON.parse(summary) as ProcurementFeishuPullTaskResult;
  } catch {
    return null;
  }
}

export async function runProcurementFeishuPullTask(
  runId: string,
  listType: ProcurementListKey,
  actorId: string = PROCUREMENT_FEISHU_PULL_ACTOR,
) {
  const taskName = procurementPullTaskName(listType);
  const label = labelForProcurementList(listType);

  try {
    const conflict = await detectProcurementFeishuPullConflict(listType, taskName);
    if (conflict) {
      await finishTaskRun(runId, { success: false, errorMessage: conflict });
      console.warn(`[procurement-pull] ${listType} skipped: ${conflict}`);
      return { skipped: true as const, reason: conflict };
    }

    const config = getProcurementListConfig()[listType];
    if (!config.configured) {
      const message = `${label} 飞书多维表格未配置，跳过拉取。`;
      await finishTaskRun(runId, { success: false, errorMessage: message });
      return { skipped: true as const, reason: message };
    }

    const result = await executeProcurementFeishuSync(listType, actorId);
    const payload: ProcurementFeishuPullTaskResult = {
      direction: 'from_feishu',
      mode: 'full_replace',
      listType,
      imported: result.imported,
    };
    await finishTaskRun(runId, {
      success: true,
      resultSummary: JSON.stringify(payload),
    });
    console.info(`[procurement-pull] ${listType} done: imported=${payload.imported}`);
    return { skipped: false as const, ...payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Feishu pull failed';
    console.error(`[procurement-pull] ${listType} failed:`, message, err);
    await finishTaskRun(runId, { success: false, errorMessage: message });
    return { skipped: true as const, reason: message };
  }
}
