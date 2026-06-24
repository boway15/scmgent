import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { runStockAlert } from '../tasks/stockAlert.js';
import { runReplenishmentForecast } from '../tasks/replenishmentForecast.js';
import { runPurchaseFollowUp } from '../tasks/purchaseFollowUp.js';
import { runInventoryExceptionScan } from '../tasks/inventoryExceptionScan.js';
import { runDailyInventoryPipeline } from '../tasks/dailyInventoryPipeline.js';
import { isAuthBypassLogin } from '../lib/auth-policy.js';
import { resolveRequestUser } from '../lib/rbac.js';
import { finishTaskRun, getLatestTaskRuns, startTaskRun } from '../lib/task-runs.js';

export const taskRoutes = new Hono();

async function requireCronSecret(c: Context, next: Next) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = c.req.header('X-Cron-Secret');
  if (secret && header === secret) return next();

  if (isAuthBypassLogin()) {
    const user = await resolveRequestUser(c);
    if (user?.role.code === 'super_admin') return next();
  }

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
  const runs = await getLatestTaskRuns(20);
  return c.json(runs);
});

taskRoutes.post('/tasks/stock-alert', requireCronSecret, async (c) => {
  const triggeredBy = resolveTriggeredBy(c);
  const run = await startTaskRun('stock_alert', triggeredBy);
  try {
    const result = await runStockAlert();
    await finishTaskRun(run.id, {
      success: true,
      resultSummary: `alerts=${result.alertCount}; engine=${result.engine}`,
    });
    return c.json({ ...result, taskRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'stock alert failed';
    await finishTaskRun(run.id, { success: false, errorMessage: message });
    return c.json({ message, taskRunId: run.id }, 500);
  }
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
