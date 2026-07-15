import type { ProfileSegment } from './forecast-profile-class.js';

/** B 类残差分位 spread 比（相对 P50），按子档 × 日历月默认桶 */
const B_RESIDUAL_SPREAD: Partial<Record<ProfileSegment, number>> = {
  'B:core': 0.55,
  'B:mid': 0.65,
  'B:tail': 0.75,
};

const MONTH_SEASON_BUMP: Record<number, number> = {
  11: 1.15,
  12: 1.2,
  1: 1.05,
  7: 1.1,
};

export function resolveResidualSpreadRatio(input: {
  profileSegment?: ProfileSegment | string | null;
  calendarMonth?: number;
  cv12m?: number;
}): number {
  const seg = input.profileSegment as ProfileSegment | undefined;
  const base =
    (seg && B_RESIDUAL_SPREAD[seg]) ??
    Math.min(2, Math.max(0.25, (input.cv12m ?? 0.5) * 0.5));
  const month = input.calendarMonth;
  const bump = month != null ? (MONTH_SEASON_BUMP[month] ?? 1) : 1;
  return Math.min(2, base * bump);
}
