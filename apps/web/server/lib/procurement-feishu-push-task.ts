import {
  executeProcurementFeishuPush,
  type ProcurementListKey,
} from './procurement-bitable-list.js';
import { assertNoRunningProcurementFeishuIo } from './procurement-feishu-sync-lock.js';
import { procurementPushTaskName } from './procurement-feishu-task-names.js';
import { finishTaskRun } from './task-runs.js';

export type ProcurementFeishuPushTaskResult = {
  direction: 'to_feishu';
  mode: 'full_replace';
  listType: ProcurementListKey;
  pushed: number;
  deleted: number;
  created: number;
  fieldsCreated: number;
};

export { procurementPushTaskName };

export function parseProcurementFeishuPushTaskResult(
  summary: string | null | undefined,
): ProcurementFeishuPushTaskResult | null {
  if (!summary) return null;
  try {
    return JSON.parse(summary) as ProcurementFeishuPushTaskResult;
  } catch {
    return null;
  }
}

/** @deprecated Prefer assertNoRunningProcurementFeishuIo; kept for route compatibility. */
export async function assertNoRunningProcurementPush(listType: ProcurementListKey) {
  await assertNoRunningProcurementFeishuIo(listType);
}

export async function runProcurementFeishuPushTask(
  runId: string,
  listType: ProcurementListKey,
  userId: string,
) {
  try {
    const result = await executeProcurementFeishuPush(listType, userId);
    const payload: ProcurementFeishuPushTaskResult = {
      direction: result.direction,
      mode: result.mode,
      listType,
      pushed: result.pushed,
      deleted: result.deleted,
      created: result.created,
      fieldsCreated: result.fieldsCreated,
    };
    await finishTaskRun(runId, {
      success: true,
      resultSummary: JSON.stringify(payload),
    });
    console.info(
      `[procurement-push] ${listType} done: created=${payload.created} deleted=${payload.deleted} fieldsCreated=${payload.fieldsCreated}`,
    );
    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Feishu push failed';
    console.error(`[procurement-push] ${listType} failed:`, message, err);
    await finishTaskRun(runId, { success: false, errorMessage: message });
  }
}
