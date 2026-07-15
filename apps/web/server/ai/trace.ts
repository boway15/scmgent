import { eq } from 'drizzle-orm';
import { db, aiRuns, aiRunSteps, aiToolCalls } from '@scm/db';
import type { GraphName } from './types.js';

export type StartRunParams = {
  graphName: GraphName;
  userId?: string;
  conversationId?: string;
  triggeredBy?: string;
  input?: unknown;
};

export async function startAiRun(params: StartRunParams) {
  const [run] = await db
    .insert(aiRuns)
    .values({
      graphName: params.graphName,
      userId: params.userId ?? null,
      conversationId: params.conversationId ?? null,
      triggeredBy: params.triggeredBy ?? null,
      input: params.input ?? null,
      status: 'running',
    })
    .returning();
  return run;
}

export async function finishAiRun(
  runId: string,
  params: { success: boolean; output?: unknown; errorMessage?: string },
) {
  await db
    .update(aiRuns)
    .set({
      status: params.success ? 'success' : 'failed',
      output: params.output ?? null,
      errorMessage: params.errorMessage ?? null,
      finishedAt: new Date(),
    })
    .where(eq(aiRuns.id, runId));
}

export async function recordAiStep(
  runId: string,
  nodeName: string,
  handler: () => Promise<unknown>,
  input?: unknown,
) {
  const started = Date.now();
  const [step] = await db
    .insert(aiRunSteps)
    .values({
      runId,
      nodeName,
      status: 'running',
      input: input ?? null,
    })
    .returning();

  try {
    const output = await handler();
    const durationMs = Date.now() - started;
    await db
      .update(aiRunSteps)
      .set({
        status: 'success',
        output: output ?? null,
        durationMs,
        finishedAt: new Date(),
      })
      .where(eq(aiRunSteps.id, step.id));
    return { stepId: step.id, output, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    const errorMessage = err instanceof Error ? err.message : 'step failed';
    await db
      .update(aiRunSteps)
      .set({
        status: 'failed',
        errorMessage,
        durationMs,
        finishedAt: new Date(),
      })
      .where(eq(aiRunSteps.id, step.id));
    throw err;
  }
}

export async function recordToolCall(
  runId: string,
  toolName: string,
  handler: () => Promise<unknown>,
  input?: unknown,
  stepId?: string,
) {
  const started = Date.now();
  try {
    const output = await handler();
    const durationMs = Date.now() - started;
    await db.insert(aiToolCalls).values({
      runId,
      stepId: stepId ?? null,
      toolName,
      input: input ?? null,
      output: output ?? null,
      durationMs,
    });
    return output;
  } catch (err) {
    const durationMs = Date.now() - started;
    const errorMessage = err instanceof Error ? err.message : 'tool failed';
    await db.insert(aiToolCalls).values({
      runId,
      stepId: stepId ?? null,
      toolName,
      input: input ?? null,
      errorMessage,
      durationMs,
    });
    throw err;
  }
}
