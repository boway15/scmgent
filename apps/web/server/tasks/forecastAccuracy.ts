import { computeForecastAccuracyForMonth } from '../lib/forecast-accuracy.js';

/** 每月初计算上月预测准确率 */
export async function runForecastAccuracy() {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const targetYear = target.getFullYear();
  const targetMonth = target.getMonth() + 1;

  const result = await computeForecastAccuracyForMonth(targetYear, targetMonth);
  return {
    engine: 'forecast_accuracy_v1',
    targetYear,
    targetMonth,
    ...result,
  };
}
