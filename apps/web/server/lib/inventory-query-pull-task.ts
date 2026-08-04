import { pullAndPublishInventoryQueryFromFeishu, getInventoryQueryBitableConfig } from './inventory-query-feishu-pull.js';
import { countRunningTaskRuns, failStaleRunningTaskRuns, finishTaskRun } from './task-runs.js';

export const INVENTORY_QUERY_PULL_TASK = 'inventory_query_pull' as const;

export type InventoryQueryPullTaskResult = {
  direction: 'from_feishu';
  syncType: 'inventory_query';
  imported: number;
  warningCount: number;
  skipped: number;
  snapshotDate: string;
  snapshotRowCount: number;
  snapshotRunId: string;
};

export async function detectInventoryQueryPullConflict(): Promise<string | null> {
  const running = await countRunningTaskRuns(INVENTORY_QUERY_PULL_TASK);
  if (running > 1) {
    return '库存查询飞书同步正在进行，跳过本次定时拉取。';
  }
  return null;
}

export async function runInventoryQueryPullTask(runId: string) {
  try {
    await failStaleRunningTaskRuns({
      taskName: INVENTORY_QUERY_PULL_TASK,
      maxAgeMs: 10 * 60 * 1000,
      errorMessage: '库存查询飞书拉取超时或进程中断，已自动标记失败',
    });
    const conflict = await detectInventoryQueryPullConflict();
    if (conflict) {
      await finishTaskRun(runId, { success: false, errorMessage: conflict });
      console.warn(`[inventory-query-pull] skipped: ${conflict}`);
      return { skipped: true as const, reason: conflict };
    }

    const config = getInventoryQueryBitableConfig();
    if (!config.configured) {
      const message =
        '库存查询飞书多维表格未配置（需 FEISHU_BITABLE_PROCUREMENT_APP_TOKEN 或 FEISHU_BITABLE_APP_TOKEN，与库存总览相同），跳过拉取。';
      await finishTaskRun(runId, { success: false, errorMessage: message });
      return { skipped: true as const, reason: message };
    }

    const outcome = await pullAndPublishInventoryQueryFromFeishu();
    const payload: InventoryQueryPullTaskResult = {
      direction: 'from_feishu',
      syncType: 'inventory_query',
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
      `[inventory-query-pull] done: imported=${payload.imported}; warnings=${payload.warningCount}`,
    );
    return { skipped: false as const, ...payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Feishu inventory query pull failed';
    console.error('[inventory-query-pull] failed:', message, err);
    await finishTaskRun(runId, { success: false, errorMessage: message });
    return { skipped: true as const, reason: message };
  }
}
