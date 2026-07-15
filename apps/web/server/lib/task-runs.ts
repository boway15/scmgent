import { eq, desc, and } from 'drizzle-orm';
import { db, taskRuns } from '@scm/db';

export type TaskName =
  | 'stock_alert'
  | 'replenishment_forecast'
  | 'purchase_follow_up'
  | 'inventory_exception_scan'
  | 'daily_inventory_pipeline'
  | 'forecast_accuracy'
  | 'forecast_baseline'
  | 'news_ingest';

export async function startTaskRun(taskName: TaskName, triggeredBy: string) {
  const [run] = await db
    .insert(taskRuns)
    .values({
      taskName,
      status: 'running',
      triggeredBy,
    })
    .returning();
  return run;
}

export async function failRunningTaskRuns(
  taskName: TaskName,
  errorMessage = '任务已被取消',
) {
  await db
    .update(taskRuns)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      errorMessage,
    })
    .where(and(eq(taskRuns.taskName, taskName), eq(taskRuns.status, 'running')));
}

export async function countRunningTaskRuns(taskName: TaskName) {
  const rows = await db
    .select({ id: taskRuns.id })
    .from(taskRuns)
    .where(and(eq(taskRuns.taskName, taskName), eq(taskRuns.status, 'running')));
  return rows.length;
}

export async function finishTaskRun(
  runId: string,
  params: { success: boolean; resultSummary?: string; errorMessage?: string },
) {
  await db
    .update(taskRuns)
    .set({
      status: params.success ? 'success' : 'failed',
      finishedAt: new Date(),
      resultSummary: params.resultSummary ?? null,
      errorMessage: params.errorMessage ?? null,
    })
    .where(eq(taskRuns.id, runId));
}

export async function getLatestTaskRuns(limit = 10) {
  return db
    .select({
      id: taskRuns.id,
      taskName: taskRuns.taskName,
      status: taskRuns.status,
      startedAt: taskRuns.startedAt,
      finishedAt: taskRuns.finishedAt,
      resultSummary: taskRuns.resultSummary,
      errorMessage: taskRuns.errorMessage,
      triggeredBy: taskRuns.triggeredBy,
    })
    .from(taskRuns)
    .orderBy(desc(taskRuns.startedAt))
    .limit(limit);
}

export async function getTaskRunById(runId: string) {
  const [row] = await db
    .select({
      id: taskRuns.id,
      taskName: taskRuns.taskName,
      status: taskRuns.status,
      startedAt: taskRuns.startedAt,
      finishedAt: taskRuns.finishedAt,
      resultSummary: taskRuns.resultSummary,
      errorMessage: taskRuns.errorMessage,
      triggeredBy: taskRuns.triggeredBy,
    })
    .from(taskRuns)
    .where(eq(taskRuns.id, runId))
    .limit(1);
  return row ?? null;
}

export async function getLatestTaskRun(taskName: TaskName) {
  try {
    const [row] = await db
      .select({
        id: taskRuns.id,
        taskName: taskRuns.taskName,
        status: taskRuns.status,
        startedAt: taskRuns.startedAt,
        finishedAt: taskRuns.finishedAt,
        resultSummary: taskRuns.resultSummary,
        errorMessage: taskRuns.errorMessage,
        triggeredBy: taskRuns.triggeredBy,
      })
      .from(taskRuns)
      .where(eq(taskRuns.taskName, taskName))
      .orderBy(desc(taskRuns.startedAt))
      .limit(1);
    return row ?? null;
  } catch (err) {
    console.error(`[task-runs] getLatestTaskRun(${taskName}) failed:`, err);
    return null;
  }
}
