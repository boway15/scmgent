import type { SalesLifecycle } from './forecast-baseline.js';

export type VolumeTier = 'core' | 'mid' | 'tail';

export type ForecastEligibilityInput = {
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  salesDays365: number;
  forceForecast?: boolean;
};

export type ForecastEligibilityResult =
  | { eligible: true; tier: VolumeTier }
  | { eligible: false; reason: 'no_recent_sales' | 'insufficient_history' };

export type EligibilityStats = {
  eligible: number;
  skipped: number;
  byTier: Record<VolumeTier, number>;
};

export function emptyEligibilityStats(): EligibilityStats {
  return { eligible: 0, skipped: 0, byTier: { core: 0, mid: 0, tail: 0 } };
}

export function classifyVolumeTier(avgActualDaily: number): VolumeTier {
  if (avgActualDaily >= 5) return 'core';
  if (avgActualDaily >= 1) return 'mid';
  return 'tail';
}

export function evaluateForecastEligibility(
  input: ForecastEligibilityInput,
): ForecastEligibilityResult {
  if (input.forceForecast) {
    const hint = Math.max(input.recent30DailyAvg, input.recent90DailyAvg);
    return { eligible: true, tier: classifyVolumeTier(hint) };
  }
  if (input.recent90DailyAvg > 0 || input.recent30DailyAvg > 0) {
    const hint = Math.max(input.recent30DailyAvg, input.recent90DailyAvg);
    return { eligible: true, tier: classifyVolumeTier(hint) };
  }
  return { eligible: false, reason: 'no_recent_sales' };
}

export function shouldUseCategoryReference(input: {
  lifecycle: SalesLifecycle;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
}): boolean {
  if (input.recent90DailyAvg <= 0) return false;
  if (input.lifecycle === 'intermittent') return false;
  if (input.lifecycle === 'new') return input.recent30DailyAvg > 0;
  return true;
}
