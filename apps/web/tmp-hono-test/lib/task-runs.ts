import { eq, desc } from 'drizzle-orm';
import { db, taskRuns } from '@scm/db';

export type TaskName = 'stock_alert' | 'replenishment_forecast';

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

export async function getLatestTaskRun(taskName: TaskName) {
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
}
