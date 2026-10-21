import { pullSalesDailyFromFeishu, getFeishuSalesDailyBitableConfig } from './feishu-sales-daily-pull.js';
import { countRunningTaskRuns, failStaleRunningTaskRuns, finishTaskRun } from './task-runs.js';

export const SALES_DAILY_FEISHU_PULL_TASK = 'sales_daily_feishu_pull' as const;

export async function runSalesDailyFeishuPullTask(runId: string) {
  try {
    await failStaleRunningTaskRuns({
      taskName: SALES_DAILY_FEISHU_PULL_TASK,
      maxAgeMs: 20 * 60 * 1000,
      errorMessage: '销量飞书拉取超时或进程中断，已自动标记失败',
    });
    const running = await countRunningTaskRuns(SALES_DAILY_FEISHU_PULL_TASK);
    if (running > 1) {
      const reason = '销量飞书同步正在进行，跳过本次定时拉取。';
      await finishTaskRun(runId, { success: false, errorMessage: reason });
      return { skipped: true as const, reason };
    }

    const config = getFeishuSalesDailyBitableConfig();
    if (!config.configured) {
      const reason =
        '销量长表飞书多维表格未配置（需 FEISHU_BITABLE_PROCUREMENT_APP_TOKEN 或 FEISHU_BITABLE_APP_TOKEN），跳过拉取。';
      await finishTaskRun(runId, { success: false, errorMessage: reason });
      return { skipped: true as const, reason };
    }

    const result = await pullSalesDailyFromFeishu();
    await finishTaskRun(runId, {
      success: true,
      resultSummary: `inserted=${result.insertedSalesRows}; updated=${result.updatedSalesRows}; dates=${result.dates.join(',')}; skipped=${result.skippedInvalid}`,
    });
    console.info(
      `[sales-daily-feishu-pull] inserted=${result.insertedSalesRows}; updated=${result.updatedSalesRows}; dates=${result.dates.join(',')}`,
    );
    return { skipped: false as const, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sales daily feishu pull failed';
    console.error('[sales-daily-feishu-pull] failed:', message, err);
    await finishTaskRun(runId, { success: false, errorMessage: message });
    return { skipped: true as const, reason: message };
  }
}
