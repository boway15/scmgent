import {
  db,
  forecastAccuracyMonthly,
  salesForecastMonthly,
  salesForecastReviewItems,
  salesForecastSeasonality,
  salesForecastSourceBatches,
  salesForecastVersions,
} from '@scm/db';
import { failRunningTaskRuns } from './task-runs.js';

export type ForecastResetResult = {
  deleted: {
    forecastMonthly: number;
    forecastAccuracy: number;
    reviewItems: number;
    seasonality: number;
    sourceBatches: number;
    versions: number;
  };
};

let forecastResetInProgress = false;

/** 基线生成写入前检查，避免与「清空预测数据」并发导致 FK 冲突 */
export function isForecastResetInProgress() {
  return forecastResetInProgress;
}

export function assertForecastWriteAllowed() {
  if (forecastResetInProgress) {
    throw new Error('预测数据正在清空，已中止写入');
  }
}

export async function clearAllForecastData(): Promise<ForecastResetResult> {
  await failRunningTaskRuns('forecast_baseline', '任务已被取消（预测数据清空）');

  forecastResetInProgress = true;
  try {
    return await db.transaction(async (tx) => {
      // 子表先于版本删除，避免 FK 竞态（monthly / accuracy 引用 version_id）
      const forecastMonthly = await tx
        .delete(salesForecastMonthly)
        .returning({ id: salesForecastMonthly.id });
      const forecastAccuracy = await tx
        .delete(forecastAccuracyMonthly)
        .returning({ id: forecastAccuracyMonthly.id });
      const reviewItems = await tx
        .delete(salesForecastReviewItems)
        .returning({ id: salesForecastReviewItems.id });
      const seasonality = await tx
        .delete(salesForecastSeasonality)
        .returning({ id: salesForecastSeasonality.id });
      const sourceBatches = await tx
        .delete(salesForecastSourceBatches)
        .returning({ id: salesForecastSourceBatches.id });
      const versions = await tx
        .delete(salesForecastVersions)
        .returning({ id: salesForecastVersions.id });

      return {
        deleted: {
          forecastMonthly: forecastMonthly.length,
          forecastAccuracy: forecastAccuracy.length,
          reviewItems: reviewItems.length,
          seasonality: seasonality.length,
          sourceBatches: sourceBatches.length,
          versions: versions.length,
        },
      };
    });
  } finally {
    forecastResetInProgress = false;
  }
}
