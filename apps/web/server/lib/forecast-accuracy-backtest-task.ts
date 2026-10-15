import { finishTaskRun } from './task-runs.js';
import { computeForecastAccuracyBacktest } from './forecast-accuracy.js';
import { writeAuditLog } from './audit-log.js';

export type AccuracyBacktestTaskInput = {
  monthCount?: number;
  versionId?: string;
  createReviewItems?: boolean;
  triggeredByUserId?: string;
};

export type AccuracyBacktestTaskResult = {
  monthCount: number;
  monthResults: Array<{
    year: number;
    month: number;
    upserted: number;
    highMapeCount: number;
    skipped?: boolean;
  }>;
  totalUpserted: number;
  totalHighMapeCount: number;
  summary: string;
};

export function parseAccuracyBacktestTaskResult(
  summary: string | null | undefined,
): AccuracyBacktestTaskResult | null {
  if (!summary) return null;
  try {
    return JSON.parse(summary) as AccuracyBacktestTaskResult;
  } catch {
    return null;
  }
}

export async function runForecastAccuracyBacktestTask(
  runId: string,
  input: AccuracyBacktestTaskInput,
): Promise<AccuracyBacktestTaskResult | undefined> {
  try {
    const result = await computeForecastAccuracyBacktest({
      monthCount: input.monthCount,
      versionId: input.versionId,
      createReviewItems: input.createReviewItems,
    });

    await finishTaskRun(runId, {
      success: true,
      resultSummary: JSON.stringify(result),
    });

    await writeAuditLog(null, {
      action: 'sales_forecast.accuracy_backtest',
      resourceType: 'forecast_accuracy_monthly',
      resourceId: input.versionId,
      detail: {
        monthCount: result.monthCount,
        totalUpserted: result.totalUpserted,
        totalHighMapeCount: result.totalHighMapeCount,
        background: true,
        taskRunId: runId,
        triggeredBy: input.triggeredByUserId,
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'forecast accuracy backtest failed';
    console.error('[forecast] accuracy backtest task failed:', message, err);
    await finishTaskRun(runId, { success: false, errorMessage: message });
    return undefined;
  }
}
