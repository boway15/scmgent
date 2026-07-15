/** 预测主算法：legacy=horizon v2；monthly_abcd=月级 ABCD；allcat_v41=全品类 V4.1 KPI + T99 */
export type ForecastAlgoMode = 'legacy' | 'monthly_abcd' | 'allcat_v41';

const VALID: ForecastAlgoMode[] = ['legacy', 'monthly_abcd', 'allcat_v41'];

export function resolveForecastAlgoMode(override?: string | null): ForecastAlgoMode {
  const raw = (override ?? process.env.FORECAST_ALGO_MODE ?? 'allcat_v41').trim().toLowerCase();
  if (VALID.includes(raw as ForecastAlgoMode)) {
    return raw as ForecastAlgoMode;
  }
  return 'allcat_v41';
}

export function isMonthlyAbcdAlgoMode(mode?: ForecastAlgoMode): boolean {
  return (mode ?? resolveForecastAlgoMode()) === 'monthly_abcd';
}

export function isAllCatV41AlgoMode(mode?: ForecastAlgoMode): boolean {
  return (mode ?? resolveForecastAlgoMode()) === 'allcat_v41';
}
