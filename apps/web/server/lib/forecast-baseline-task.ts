import { finishTaskRun } from './task-runs.js';
import { generateBaselineForecastVersion } from './forecast-collaboration.js';
import { writeAuditLog } from './audit-log.js';

export type BaselineTaskInput = {
  station?: string;
  platform?: string;
  category?: string;
  skuCode?: string;
  versionName?: string;
  monthCount: number;
  createdBy?: string;
  existingVersionId?: string;
  forceNewVersion?: boolean;
};

import type { EligibilityStats } from './forecast-collaboration.js';

export type BaselineTaskResult = {
  version: {
    id: string;
    versionNo: string;
    versionName: string;
    station?: string | null;
    status: string;
  };
  forecastRows: number;
  reviewRows: number;
  eligibilityStats?: EligibilityStats;
  platformsGenerated?: string[];
};

export function parseBaselineTaskResult(summary: string | null | undefined): BaselineTaskResult | null {
  if (!summary) return null;
  try {
    return JSON.parse(summary) as BaselineTaskResult;
  } catch {
    return null;
  }
}

export async function runBaselineForecastTask(runId: string, input: BaselineTaskInput) {
  try {
    const result = await generateBaselineForecastVersion(input);
    const payload: BaselineTaskResult = {
      version: {
        id: result.version.id,
        versionNo: result.version.versionNo,
        versionName: result.version.versionName,
        station: result.version.station,
        status: result.version.status,
      },
      forecastRows: result.forecastRows,
      reviewRows: result.reviewRows,
      eligibilityStats: result.eligibilityStats,
      platformsGenerated: result.platformsGenerated,
    };
    await finishTaskRun(runId, {
      success: true,
      resultSummary: JSON.stringify(payload),
    });
    await writeAuditLog(null, {
      action: 'sales_forecast.generate_baseline',
      resourceType: 'sales_forecast_version',
      resourceId: result.version.id,
      detail: {
        forecastRows: result.forecastRows,
        reviewRows: result.reviewRows,
        background: true,
        taskRunId: runId,
        createdBy: input.createdBy,
      },
    });
    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'baseline forecast generation failed';
    console.error('[forecast] background baseline failed:', message, err);
    await finishTaskRun(runId, { success: false, errorMessage: message });
  }
}
