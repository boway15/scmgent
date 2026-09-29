import {
  getProcurementOpsBitableConfig,
  pullAndPublishProcurementOpsFromFeishu,
} from './procurement-ops-feishu-pull.js';
import { countRunningTaskRuns, failStaleRunningTaskRuns, finishTaskRun } from './task-runs.js';

export const PROCUREMENT_OPS_PULL_TASK = 'procurement_ops_pull' as const;

export type ProcurementOpsPullTaskResult = {
  direction: 'from_feishu';
  syncType: 'procurement_ops';
  imported: number;
  warningCount: number;
  skipped: number;
  snapshotDate: string;
  snapshotRowCount: number;
  snapshotRunId: string;
};

export async function detectProcurementOpsPullConflict(): Promise<string | null> {
  const running = await countRunningTaskRuns(PROCUREMENT_OPS_PULL_TASK);
  if (running > 1) {
    return '全链库存飞书同步正在进行，跳过本次定时拉取。';
  }
  return null;
}

export async function runProcurementOpsPullTask(runId: string) {
  try {
    await failStaleRunningTaskRuns({
      taskName: PROCUREMENT_OPS_PULL_TASK,
      maxAgeMs: 10 * 60 * 1000,
      errorMessage: '全链库存飞书拉取超时或进程中断，已自动标记失败',
    });
    const conflict = await detectProcurementOpsPullConflict();
    if (conflict) {
      await finishTaskRun(runId, { success: false, errorMessage: conflict });
      console.warn(`[procurement-ops-pull] skipped: ${conflict}`);
      return { skipped: true as const, reason: conflict };
    }

    const config = getProcurementOpsBitableConfig();
    if (!config.configured) {
      const message =
        '全链库存飞书多维表格未配置（需 FEISHU_BITABLE_PROCUREMENT_APP_TOKEN 或 FEISHU_BITABLE_APP_TOKEN，与库存周转相同），跳过拉取。';
      await finishTaskRun(runId, { success: false, errorMessage: message });
      return { skipped: true as const, reason: message };
    }

    const outcome = await pullAndPublishProcurementOpsFromFeishu();
    const payload: ProcurementOpsPullTaskResult = {
      direction: 'from_feishu',
      syncType: 'procurement_ops',
      imported: outcome.imported,
      warningCount: outcome.warningCount,
      skipped: outcome.skipped,
      snapshotDate: outcome.snapshotDate,
      snapshotRowCount: outcome.snapshotRowCount,
      snapshotRunId: outcome.snapshotRunId,
    };
    await finishTaskRun(runId, {
      success: true,
      resultSummary: JSON.stringify(payload),
    });
    console.info(
      `[procurement-ops-pull] done: imported=${payload.imported}; warnings=${payload.warningCount}`,
    );
    return { skipped: false as const, ...payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Feishu procurement ops pull failed';
    console.error('[procurement-ops-pull] failed:', message, err);
    await finishTaskRun(runId, { success: false, errorMessage: message });
    return { skipped: true as const, reason: message };
  }
}
