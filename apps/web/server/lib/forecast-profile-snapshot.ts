import { daysInCalendarMonth } from './forecast-baseline.js';
import { classifyVolumeTier, type VolumeTier } from './forecast-eligibility.js';
import {
  classifyForecastProfile,
  computeContinuity,
  computeCv,
  resolveProfileSegment,
  type ProfileClass,
  type ProfileSegment,
} from './forecast-profile-class.js';
import type { ForecastProfileConfig } from './forecast-profile-config.js';
import { DEFAULT_FORECAST_PROFILE_CONFIG } from './forecast-profile-config.js';

export type MonthlyQtyRow = { saleYear: number; month: number; qtySold: number };

/** 构建 asOf 前连续 12 个自然月的月销量总量（升序） */
export function buildLast12MonthlyQty(
  monthlyRows: MonthlyQtyRow[],
  asOf: Date,
): number[] {
  const qty: number[] = [];
  let y = asOf.getUTCFullYear();
  let m = asOf.getUTCMonth() + 1;
  for (let i = 0; i < 12; i++) {
    const total = monthlyRows
      .filter((row) => row.saleYear === y && row.month === m)
      .reduce((sum, row) => sum + Number(row.qtySold), 0);
    qty.unshift(total);
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return qty;
}

/** 月销总量序列 → 月均日均（用于 volumeTier） */
export function monthlyQtyToAvgDaily(monthlyQty: number[], asOf: Date): number {
  if (monthlyQty.length === 0) return 0;
  const dailies: number[] = [];
  let y = asOf.getUTCFullYear();
  let m = asOf.getUTCMonth() + 1;
  for (let i = monthlyQty.length - 1; i >= 0; i--) {
    const q = monthlyQty[i] ?? 0;
    if (q > 0) {
      dailies.push(q / daysInCalendarMonth(y, m));
    }
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  if (!dailies.length) {
    const sum = monthlyQty.reduce((s, x) => s + x, 0);
    const avgMonth = sum / monthlyQty.length;
    return avgMonth / 30;
  }
  return dailies.reduce((s, x) => s + x, 0) / dailies.length;
}

export function resolveSkuProfileSnapshot(input: {
  monthlyQty: number[];
  asOf?: Date;
  profileClass?: ProfileClass;
  layer?: 'pool' | 'sku' | 'floor' | 'skipped';
  skipped?: boolean;
  recent90DailyAvg?: number;
  config?: ForecastProfileConfig;
}): {
  profileClass: ProfileClass;
  volumeTier: VolumeTier;
  segment: ProfileSegment;
  continuity: number;
  cv: number;
} {
  const config = input.config ?? DEFAULT_FORECAST_PROFILE_CONFIG;
  const asOf = input.asOf ?? new Date();
  const profileClass =
    input.profileClass ?? classifyForecastProfile(input.monthlyQty, config);
  const continuity = computeContinuity(input.monthlyQty);
  const avgDailyFromMonths = monthlyQtyToAvgDaily(input.monthlyQty, asOf);
  const recent90 = input.recent90DailyAvg ?? 0;
  let volumeTier = classifyVolumeTier(
    recent90 > 0 ? recent90 : avgDailyFromMonths,
  );
  if (profileClass === 'A') {
    const qualifiesCore =
      recent90 >= config.coreRecent90Min && continuity >= config.coreContinuityMin;
    if (volumeTier === 'core' && !qualifiesCore) {
      volumeTier = 'mid';
    } else if (recent90 > 0 && recent90 < config.coreRecent90Min) {
      volumeTier = 'mid';
    }
  }
  const segment = resolveProfileSegment(profileClass, {
    volumeTier,
    layer: input.layer ?? (profileClass === 'C' ? 'sku' : undefined),
    skipped: input.skipped,
  });
  return {
    profileClass,
    volumeTier,
    segment,
    continuity: computeContinuity(input.monthlyQty),
    cv: computeCv(input.monthlyQty),
  };
}
