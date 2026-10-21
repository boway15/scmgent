import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { runStockAlert } from '../tasks/stockAlert.js';
import { runReplenishmentForecast } from '../tasks/replenishmentForecast.js';
import { runPurchaseFollowUp } from '../tasks/purchaseFollowUp.js';
import { runInventoryExceptionScan } from '../tasks/inventoryExceptionScan.js';
import { runInventoryDataIssueScan } from '../tasks/inventoryDataIssueScan.js';
import { runDailyInventoryPipeline } from '../tasks/dailyInventoryPipeline.js';
import { runForecastAccuracy } from '../tasks/forecastAccuracy.js';
import { runNewsIngestTask } from '../tasks/newsIngest.js';
import { runSalesHistoryMaintenance } from '../tasks/salesHistoryMaintenance.js';
import {
  runProcurementBulkStockPull,
  runProcurementFollowUpPull,
} from '../tasks/procurementFeishuPull.js';
import { procurementPullTaskName } from '../lib/procurement-feishu-task-names.js';
import { resolveRequestUser } from '../lib/rbac.js';
import {
  countRunningTaskRuns,
  failStaleRunningTaskRuns,
  finishTaskRun,
  getLatestTaskRuns,
  getTaskRunById,
  startTaskRun,
} from '../lib/task-runs.js';
import { runInventoryQueryPull } from '../tasks/inventoryQueryPull.js';
import { runProcurementOpsPull } from '../tasks/procurementOpsPull.js';
import { PROCUREMENT_OPS_PULL_TASK } from '../lib/procurement-ops-pull-task.js';
import { runInventoryTurnoverPull } from '../tasks/inventoryTurnoverPull.js';
import { INVENTORY_QUERY_PULL_TASK } from '../lib/inventory-query-pull-task.js';
import { INVENTORY_TURNOVER_PULL_TASK } from '../lib/inventory-turnover-pull-task.js';
import { runCommercialStatusReconcile } from '../tasks/commercialStatusReconcile.js';
import { runSalesDailyFeishuPull } from '../tasks/salesDailyFeishuPull.js';
import { SALES_DAILY_FEISHU_PULL_TASK } from '../lib/feishu-sales-daily-pull-task.js';

export const taskRoutes = new Hono();

async function requireCronSecret(c: Context, next: Next) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = c.req.header('X-Cron-Secret');
  if (secret && header === secret) return next();

  const user = await resolveRequestUser(c);
  if (user?.role.code === 'super_admin') return next();

  if (!secret) {
    return c.json({ message: 'CRON_SECRET not configured' }, 503);
  }
  return c.json({ message: 'Unauthorized' }, 401);
}

function resolveTriggeredBy(c: Context): string {
  const header = c.req.header('X-Cron-Secret');
  if (header) return 'cron';
  return 'manual';
}

taskRoutes.get('/tasks/runs', requireCronSecret, async (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? 20)));
  const q = c.req.query('q')?.trim().toLowerCase();
  const fetchLimit = q ? 500 : pageSize * page;
  const runs = await getLatestTaskRuns(fetchLimit);
  const filtered = q
    ? runs.filter(
        (run) =>
          run.taskName.toLowerCase().includes(q) ||
          (run.status ?? '').toLowerCase().includes(q) ||
          (run.triggeredBy ?? '').toLowerCase().includes(q),
      )
    : runs;
  const total = filtered.length;
  const offset = (page - 1) * pageSize;
  return c.json({
    items: filtered.slice(offset, offset + pageSize),
    total,
    page,
    pageSize,
  });
});

taskRoutes.get('/tasks/runs/:id', requireCronSecret, async (c) => {
  const run = await getTaskRunById(c.req.param('id'));
  if (!run) return c.json({ message: 'Task run not found' }, 404);
  return c.json(run);
});

const STOCK_ALERT_STALE_MS = 45 * 60 * 1000;

taskRoutes.post('/tasks/stock-alert', requireCronSecret, async (c) => {
  await failStaleRunningTaskRuns({
    taskName: 'stock_alert',
    maxAgeMs: STOCK_ALERT_STALE_MS,
    errorMessage: '缺货预警超时或进程中断，已自动标记失败',
  });
  const running = await countRunningTaskRuns('stock_alert');
  if (running > 0) {
    return c.json(
      { message: '缺货预警正在运行，请到任务记录查看，不要重复触发', skipped: true },
      409,
    );
  }

  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun('stock_alert', triggeredBy);
  setImmediate(() => {
    void (async () => {
      try {
        const result = await runStockAlert();
        await finishTaskRun(run.id, {
          success: true,
          resultSummary: `alerts=${result.alertCount}; active=${result.activeCount}; resolved=${result.autoResolved}; engine=${result.engine}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'stock alert failed';
        console.error('[stockAlert] failed:', err);
        await finishTaskRun(run.id, { success: false, errorMessage: message });
      }
    })();
  });
  return c.json({ accepted: true, taskRunId: run.id, status: 'running' }, 202);
});

taskRoutes.post('/tasks/replenishment-forecast', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun('replenishment_forecast', triggeredBy);
  try {
    const result = await runReplenishmentForecast();
    await finishTaskRun(run.id, {
      success: true,
      resultSummary: `suggestions=${result.suggestionCount}; snapshots=${result.snapshotCount}; engine=${result.engine}`,
    });
    return c.json({ ...result, taskRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'replenishment forecast failed';
    await finishTaskRun(run.id, { success: false, errorMessage: message });
    return c.json({ message, taskRunId: run.id }, 500);
  }
});

taskRoutes.post('/tasks/purchase-follow-up', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun('purchase_follow_up', triggeredBy);
  try {
    const result = await runPurchaseFollowUp();
    await finishTaskRun(run.id, {
      success: true,
      resultSummary: `reminders=${result.reminderCount}`,
    });
    return c.json({ ...result, taskRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'purchase follow-up failed';
    await finishTaskRun(run.id, { success: false, errorMessage: message });
    return c.json({ message, taskRunId: run.id }, 500);
  }
});

taskRoutes.post('/tasks/inventory-exception-scan', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun('inventory_exception_scan', triggeredBy);
  try {
    const result = await runInventoryExceptionScan();
    await finishTaskRun(run.id, {
      success: true,
      resultSummary: `exceptions=${result.exceptionCount}; scanned=${result.scanned}`,
    });
    return c.json({ ...result, taskRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'exception scan failed';
    await finishTaskRun(run.id, { success: false, errorMessage: message });
    return c.json({ message, taskRunId: run.id }, 500);
  }
});

taskRoutes.post('/tasks/inventory-data-issue-scan', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun('inventory_data_issue_scan', triggeredBy);
  try {
    const result = await runInventoryDataIssueScan();
    await finishTaskRun(run.id, {
      success: true,
      resultSummary: `detected=${result.detected}; inserted=${result.inserted}; autoResolved=${result.autoResolved}`,
    });
    return c.json({ ...result, taskRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'data issue scan failed';
    await finishTaskRun(run.id, { success: false, errorMessage: message });
    return c.json({ message, taskRunId: run.id }, 500);
  }
});

taskRoutes.post('/tasks/daily-inventory-pipeline', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun('daily_inventory_pipeline', triggeredBy);
  try {
    const result = await runDailyInventoryPipeline();
    await finishTaskRun(run.id, {
      success: result.success,
      resultSummary: result.steps.map((s) => `${s.name}:${s.success ? 'ok' : 'fail'}`).join('; '),
      errorMessage: result.success ? undefined : 'one or more steps failed',
    });
    return c.json({ ...result, taskRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'daily pipeline failed';
    await finishTaskRun(run.id, { success: false, errorMessage: message });
    return c.json({ message, taskRunId: run.id }, 500);
  }
});

taskRoutes.post('/tasks/supply-lot-sync', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun('supply_lot_sync', triggeredBy);
  try {
    const { syncInventorySupplyLots } = await import('../lib/inventory-supply-lot-sync.js');
    const result = await syncInventorySupplyLots();
    await finishTaskRun(run.id, {
      success: true,
      resultSummary: `lots=${result.lotCount}; eligible=${result.eligibleCount}`,
    });
    return c.json({ ...result, taskRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'supply lot sync failed';
    await finishTaskRun(run.id, { success: false, errorMessage: message });
    return c.json({ message, taskRunId: run.id }, 500);
  }
});

taskRoutes.post('/tasks/forecast-accuracy', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun('forecast_accuracy', triggeredBy);
  try {
    const result = await runForecastAccuracy();
    await finishTaskRun(run.id, {
      success: true,
      resultSummary: `upserted=${result.upserted}; month=${result.targetMonth}`,
    });
    return c.json({ ...result, taskRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'forecast accuracy failed';
    await finishTaskRun(run.id, { success: false, errorMessage: message });
    return c.json({ message, taskRunId: run.id }, 500);
  }
});

taskRoutes.post('/tasks/sales-history-maintenance', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun('sales_history_maintenance', triggeredBy);
  try {
    const result = await runSalesHistoryMaintenance();
    await finishTaskRun(run.id, {
      success: true,
      resultSummary: `monthly=${result.monthlyUpserted}; pruned=${result.prunedDailyRows}; cutoff=${result.dailyRetentionCutoff}`,
    });
    return c.json({ ...result, taskRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sales history maintenance failed';
    await finishTaskRun(run.id, { success: false, errorMessage: message });
    return c.json({ message, taskRunId: run.id }, 500);
  }
});

taskRoutes.post('/tasks/news-ingest', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun('news_ingest', triggeredBy);
  try {
    const result = await runNewsIngestTask(run.id);
    await finishTaskRun(run.id, {
      success: true,
      resultSummary: `sources=${result.sourcesProcessed}; new=${result.totalNew}; dup=${result.totalSkippedDup}; filtered=${result.totalSkippedFiltered}; low=${result.totalSkippedLowRelevance}; bitable=${result.bitableSynced}`,
    });
    return c.json({ ...result, taskRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'news ingest failed';
    await finishTaskRun(run.id, { success: false, errorMessage: message });
    return c.json({ message, taskRunId: run.id }, 500);
  }
});

taskRoutes.post('/tasks/procurement-bulk-stock-pull', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun(procurementPullTaskName('bulk_stock_request'), triggeredBy);
  const result = await runProcurementBulkStockPull(run.id);
  if (result.skipped) {
    return c.json({ skipped: true, message: result.reason, taskRunId: run.id }, 409);
  }
  return c.json({ ...result, taskRunId: run.id });
});

taskRoutes.post('/tasks/procurement-follow-up-pull', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun(procurementPullTaskName('purchase_follow_up'), triggeredBy);
  const result = await runProcurementFollowUpPull(run.id);
  if (result.skipped) {
    return c.json({ skipped: true, message: result.reason, taskRunId: run.id }, 409);
  }
  return c.json({ ...result, taskRunId: run.id });
});

taskRoutes.post('/tasks/inventory-query-pull', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun(INVENTORY_QUERY_PULL_TASK, triggeredBy);
  const result = await runInventoryQueryPull(run.id);
  if (result.skipped) {
    return c.json({ skipped: true, message: result.reason, taskRunId: run.id }, 409);
  }
  return c.json({ ...result, taskRunId: run.id });
});

taskRoutes.post('/tasks/procurement-ops-pull', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun(PROCUREMENT_OPS_PULL_TASK, triggeredBy);
  const result = await runProcurementOpsPull(run.id);
  if (result.skipped) {
    return c.json({ skipped: true, message: result.reason, taskRunId: run.id }, 409);
  }
  return c.json({ ...result, taskRunId: run.id });
});

taskRoutes.post('/tasks/commercial-status-reconcile', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun('commercial_status_reconcile', triggeredBy);
  try {
    const result = await runCommercialStatusReconcile();
    await finishTaskRun(run.id, {
      success: true,
      resultSummary: JSON.stringify({
        updated: result.totals.updated,
        scanned: result.totals.scanned,
        distribution: result.distribution,
      }),
    });
    return c.json({ ...result, taskRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'commercial status reconcile failed';
    await finishTaskRun(run.id, { success: false, errorMessage: message });
    return c.json({ message, taskRunId: run.id }, 500);
  }
});

taskRoutes.post('/tasks/inventory-turnover-pull', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun(INVENTORY_TURNOVER_PULL_TASK, triggeredBy);
  const result = await runInventoryTurnoverPull(run.id);
  if (result.skipped) {
    return c.json({ skipped: true, message: result.reason, taskRunId: run.id }, 409);
  }
  return c.json({ ...result, taskRunId: run.id });
});

taskRoutes.post('/tasks/sales-daily-feishu-pull', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun(SALES_DAILY_FEISHU_PULL_TASK, triggeredBy);
  const result = await runSalesDailyFeishuPull(run.id);
  if (result.skipped) {
    return c.json({ skipped: true, message: result.reason, taskRunId: run.id }, 409);
  }
  return c.json({ ...result, taskRunId: run.id });
});
