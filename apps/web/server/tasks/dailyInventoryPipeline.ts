import { runReplenishmentForecast } from './replenishmentForecast.js';
import { runStockAlert } from './stockAlert.js';
import { runPurchaseFollowUp } from './purchaseFollowUp.js';
import { runInventoryExceptionScan } from './inventoryExceptionScan.js';
import { sendFeishuGroupMessage } from '../integrations/feishu.js';
import { db, reorderSuggestions, stockAlerts, inventoryExceptions } from '@scm/db';
import { eq, and, sql } from 'drizzle-orm';

export type DailyPipelineStep = {
  name: string;
  success: boolean;
  summary?: string;
  error?: string;
};

export async function runDailyInventoryPipeline() {
  const steps: DailyPipelineStep[] = [];

  try {
    const forecast = await runReplenishmentForecast();
    steps.push({
      name: 'replenishment_forecast',
      success: true,
      summary: `suggestions=${forecast.suggestionCount}; snapshots=${forecast.snapshotCount}`,
    });
  } catch (err) {
    steps.push({
      name: 'replenishment_forecast',
      success: false,
      error: err instanceof Error ? err.message : 'failed',
    });
  }

  try {
    const alert = await runStockAlert();
    steps.push({
      name: 'stock_alert',
      success: true,
      summary: `alerts=${alert.alertCount}`,
    });
  } catch (err) {
    steps.push({
      name: 'stock_alert',
      success: false,
      error: err instanceof Error ? err.message : 'failed',
    });
  }

  try {
    const exceptions = await runInventoryExceptionScan();
    steps.push({
      name: 'inventory_exception_scan',
      success: true,
      summary: `new_exceptions=${exceptions.exceptionCount}`,
    });
  } catch (err) {
    steps.push({
      name: 'inventory_exception_scan',
      success: false,
      error: err instanceof Error ? err.message : 'failed',
    });
  }

  try {
    const followUp = await runPurchaseFollowUp();
    steps.push({
      name: 'purchase_follow_up',
      success: true,
      summary: `reminders=${followUp.reminderCount}`,
    });
  } catch (err) {
    steps.push({
      name: 'purchase_follow_up',
      success: false,
      error: err instanceof Error ? err.message : 'failed',
    });
  }

  const [pendingSuggestions] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reorderSuggestions)
    .where(
      and(eq(reorderSuggestions.status, 'pending'), sql`${reorderSuggestions.supersededAt} IS NULL`),
    );

  const [openAlerts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockAlerts)
    .where(eq(stockAlerts.isResolved, false));

  const [openExceptions] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryExceptions)
    .where(sql`${inventoryExceptions.status} IN ('open', 'in_progress')`);

  const digest = [
    '【供应链日 digest】',
    `待采纳补货建议：${pendingSuggestions?.count ?? 0}`,
    `未处理缺货预警：${openAlerts?.count ?? 0}`,
    `待处理库存异常：${openExceptions?.count ?? 0}`,
    '',
    '任务执行：',
    ...steps.map((s) => `- ${s.name}: ${s.success ? s.summary : `失败 ${s.error}`}`),
  ].join('\n');

  try {
    await sendFeishuGroupMessage(digest);
  } catch (err) {
    console.warn('[dailyPipeline] Feishu digest skipped:', err);
  }

  const allSuccess = steps.every((s) => s.success);
  return { success: allSuccess, steps, digest };
}
