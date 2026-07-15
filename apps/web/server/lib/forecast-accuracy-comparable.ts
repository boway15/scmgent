import {
  isAllCatV41KpiComparableTier,
  isAllCatV41TierCode,
} from './forecast-allcat-v41.js';
import {
  isComparableForAccuracy,
  type ProfileClass,
} from './forecast-profile-class.js';

type KpiAccuracyRow = {
  profileSegment?: string | null;
  forecastProfileClass?: string | null;
  actualDaily: number;
  forecastDaily?: number;
};

/** 准确率统计纳入：全部预测日均 > 0 的行（含 T4B / ghost / D 等） */
export function isForecastRowIncludedInAccuracyStats(input: {
  forecastDaily: number;
}): boolean {
  return input.forecastDaily > 0;
}

/** 主 KPI 可比：T1–T4A 且实际 > 0（与 V4.1 excludedFromMainStats 对齐） */
export function isForecastRowComparableForAccuracy(input: {
  profileSegment?: string | null;
  forecastProfileClass?: string | null;
  actualDaily: number;
}): boolean {
  if (input.actualDaily <= 0) return false;

  const segment = input.profileSegment?.trim();
  if (segment && isAllCatV41TierCode(segment)) {
    return isAllCatV41KpiComparableTier(segment);
  }

  const profileClass = (input.forecastProfileClass as ProfileClass | null) ?? null;
  if (profileClass === 'D') return false;
  if (profileClass && !isComparableForAccuracy(profileClass, input.actualDaily)) return false;
  return true;
}

/** 主 KPI 行过滤（排除 T4B/T99/D 等） */
export function filterKpiComparableAccuracyRows<T extends KpiAccuracyRow>(rows: T[]): T[] {
  return rows.filter((row) =>
    isForecastRowComparableForAccuracy({
      profileSegment: row.profileSegment,
      forecastProfileClass: row.forecastProfileClass,
      actualDaily: row.actualDaily,
    }),
  );
}

/** 准确率统计行过滤（预测 > 0 即纳入，含 ghost） */
export function filterAccuracyStatsRows<T extends KpiAccuracyRow>(rows: T[]): T[] {
  return rows.filter((row) =>
    isForecastRowIncludedInAccuracyStats({
      forecastDaily: row.forecastDaily ?? 0,
    }),
  );
}

/** SQL 用：profile_segment 是否纳入主 KPI */
export function isKpiComparableProfileSegment(segment?: string | null): boolean {
  const value = segment?.trim() ?? '';
  if (!value) return true;
  if (value === 'T4B' || value === 'T99') return false;
  if (value.startsWith('D:')) return false;
  return true;
}

export function isAllCatV41CoreKpiTier(segment?: string | null): boolean {
  const tier = segment?.trim();
  return tier === 'T1' || tier === 'T2';
}
