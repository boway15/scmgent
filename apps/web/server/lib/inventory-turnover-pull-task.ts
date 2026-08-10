import { executeBitableSync, getBitableSyncConfig } from './bitable-sync.js';
import { countRunningTaskRuns, finishTaskRun } from './task-runs.js';

export const INVENTORY_TURNOVER_PULL_TASK = 'inventory_turnover_pull' as const;
/** 定时任务不写 users.id；保留导出以免外部引用断裂 */
export const INVENTORY_TURNOVER_PULL_ACTOR = null;

export type InventoryTurnoverPullTaskResult = {
  direction: 'from_feishu';
  syncType: 'inventory_turnover';
  imported: number;
  mismatchCount?: number;
  skipped?: number;
  createdSkus?: number;
  updatedSkus?: number;
  snapshotDate?: string;
  snapshotRowCount?: number;
  snapshotRunId?: string;
  snapshotSkippedReason?: string;
};

/** 人工同步启动前：已有 running 则拒绝 */
export async function assertNoRunningInventoryTurnoverPull() {
  const running = await countRunningTaskRuns(INVENTORY_TURNOVER_PULL_TASK);
  if (running > 0) {
    throw new Error('库存周转正在从飞书同步，请稍后再试。');
  }
}

/**
 * 定时任务在 startTaskRun 之后调用：若已有其它 pull（含人工）在跑则跳过。
 */
export async function detectInventoryTurnoverPullConflict(): Promise<string | null> {
  const running = await countRunningTaskRuns(INVENTORY_TURNOVER_PULL_TASK);
  if (running > 1) {
    return '库存周转飞书同步正在进行，跳过本次定时拉取。';
  }
  return null;
}

export async function runInventoryTurnoverPullTask(
  runId: string,
  actorId?: string,
) {
  try {
    const conflict = await detectInventoryTurnoverPullConflict();
    if (conflict) {
      await finishTaskRun(runId, { success: false, errorMessage: conflict });
      console.warn(`[inventory-turnover-pull] skipped: ${conflict}`);
      return { skipped: true as const, reason: conflict };
    }

    const config = getBitableSyncConfig().inventory_turnover;
    if (!config.configured) {
      const message =
        '库存周转飞书多维表格未配置（需 FEISHU_BITABLE_TABLE_INVENTORY 与 app token），跳过拉取。';
      await finishTaskRun(runId, { success: false, errorMessage: message });
      return { skipped: true as const, reason: message };
    }

    const outcome = await executeBitableSync('inventory_turnover', actorId);
    if (!outcome.ok) {
      const message =
        typeof outcome.body.message === 'string'
          ? outcome.body.message
          : '库存周转飞书同步校验失败';
      await finishTaskRun(runId, { success: false, errorMessage: message });
      return { skipped: true as const, reason: message };
    }

    const body = outcome.body;
    const errorCount = body.errors?.length ?? 0;
    const payload: InventoryTurnoverPullTaskResult = {
      direction: 'from_feishu',
      syncType: 'inventory_turnover',
      imported: body.imported ?? 0,
      mismatchCount: body.mismatchCount,
      skipped: body.skipped,
      createdSkus: body.createdSkus,
      updatedSkus: body.updatedSkus,
      snapshotDate: body.snapshotDate,
      snapshotRowCount: body.snapshotRowCount,
      snapshotRunId: body.snapshotRunId,
      snapshotSkippedReason: body.snapshotSkippedReason,
    };

    if (errorCount > 0 || !body.snapshotDate) {
      const message =
        body.snapshotSkippedReason ??
        (errorCount > 0
          ? `飞书同步存在 ${errorCount} 条错误，每日快照未更新（imported=${payload.imported}）`
          : '飞书同步完成但每日快照未发布');
      await finishTaskRun(runId, {
        success: false,
        errorMessage: message,
        resultSummary: JSON.stringify(payload),
      });
      console.warn(`[inventory-turnover-pull] incomplete: ${message}`);
      return { skipped: true as const, reason: message, ...payload };
    }

    await finishTaskRun(runId, {
      success: true,
      resultSummary: JSON.stringify(payload),
    });
    console.info(
      `[inventory-turnover-pull] done: imported=${payload.imported}; snapshot=${payload.snapshotDate}; mismatch=${payload.mismatchCount ?? 0}`,
    );
    return { skipped: false as const, ...payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Feishu inventory turnover pull failed';
    console.error('[inventory-turnover-pull] failed:', message, err);
    await finishTaskRun(runId, { success: false, errorMessage: message });
    return { skipped: true as const, reason: message };
  }
}
