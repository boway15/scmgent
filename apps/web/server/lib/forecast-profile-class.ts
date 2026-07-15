import { classifyVolumeTier, type VolumeTier } from './forecast-eligibility.js';
import type { ForecastProfileConfig } from './forecast-profile-config.js';
import { DEFAULT_FORECAST_PROFILE_CONFIG } from './forecast-profile-config.js';

export type ProfileClass = 'A' | 'B' | 'C' | 'D';

export type ProfileSegment =
  | 'A:core'
  | 'A:mid'
  | 'A:tail'
  | 'B:core'
  | 'B:mid'
  | 'B:tail'
  | 'C:pool'
  | 'C:sku-core'
  | 'C:sku-mid'
  | 'C:sku-tail'
  | 'D:floor'
  | 'D:skipped';

export type ProfileClassMeta = {
  code: ProfileClass;
  label: string;
  fullName: string;
  description: string;
  forecastModel: string;
  kpiMode: 'wmape' | 'interval' | 'pool' | 'risk';
};

export type ProfileSegmentMeta = {
  segment: ProfileSegment;
  label: string;
  parentClass: ProfileClass;
  parentLabel: string;
  subTierKind: 'volume' | 'pool' | 'sku_split' | 'risk';
  kpiMode: 'wmape' | 'interval' | 'pool' | 'risk' | 'display_only';
  measurable: boolean;
};

export const PROFILE_CLASS_META: Record<ProfileClass, ProfileClassMeta> = {
  A: {
    code: 'A',
    label: 'A·常青款',
    fullName: 'Evergreen 连续稳定款',
    description: '近12月多数月份有销且波动小，是精准备货与追货的核心对象',
    forecastModel: 'near_anchor | sarima',
    kpiMode: 'wmape',
  },
  B: {
    code: 'B',
    label: 'B·爆款趋势款',
    fullName: 'Trend 高波动连续款',
    description: '有销月份多但月销起伏大，需大促日历与概率区间指导备料',
    forecastModel: 'prophet_events | residual_band',
    kpiMode: 'interval',
  },
  C: {
    code: 'C',
    label: 'C·长尾款',
    fullName: 'Long-tail 间歇低波动款',
    description: '卖得断断续续但波动不大，按品类池预测后按占比分解到 SKU',
    forecastModel: 'aggregate_split',
    kpiMode: 'pool',
  },
  D: {
    code: 'D',
    label: 'D·问题款',
    fullName: 'Problem 高波动间歇款',
    description: '零销与脉冲交替，只做保底销量与风险管控，不追预测准确率',
    forecastModel: 'floor_only',
    kpiMode: 'risk',
  },
};

export const SEGMENT_MATRIX_ROWS: ProfileSegment[] = [
  'A:core',
  'A:mid',
  'A:tail',
  'B:core',
  'B:mid',
  'B:tail',
  'C:pool',
  'C:sku-core',
  'C:sku-mid',
  'C:sku-tail',
  'D:floor',
  'D:skipped',
];

export const PROFILE_SEGMENT_META: Record<ProfileSegment, ProfileSegmentMeta> = {
  'A:core': {
    segment: 'A:core',
    label: 'A·常青款·主力',
    parentClass: 'A',
    parentLabel: 'A·常青款',
    subTierKind: 'volume',
    kpiMode: 'wmape',
    measurable: true,
  },
  'A:mid': {
    segment: 'A:mid',
    label: 'A·常青款·腰部',
    parentClass: 'A',
    parentLabel: 'A·常青款',
    subTierKind: 'volume',
    kpiMode: 'wmape',
    measurable: true,
  },
  'A:tail': {
    segment: 'A:tail',
    label: 'A·常青款·长尾',
    parentClass: 'A',
    parentLabel: 'A·常青款',
    subTierKind: 'volume',
    kpiMode: 'wmape',
    measurable: true,
  },
  'B:core': {
    segment: 'B:core',
    label: 'B·爆款趋势款·主力',
    parentClass: 'B',
    parentLabel: 'B·爆款趋势款',
    subTierKind: 'volume',
    kpiMode: 'interval',
    measurable: true,
  },
  'B:mid': {
    segment: 'B:mid',
    label: 'B·爆款趋势款·腰部',
    parentClass: 'B',
    parentLabel: 'B·爆款趋势款',
    subTierKind: 'volume',
    kpiMode: 'interval',
    measurable: true,
  },
  'B:tail': {
    segment: 'B:tail',
    label: 'B·爆款趋势款·长尾',
    parentClass: 'B',
    parentLabel: 'B·爆款趋势款',
    subTierKind: 'volume',
    kpiMode: 'interval',
    measurable: true,
  },
  'C:pool': {
    segment: 'C:pool',
    label: 'C·长尾款·品类池',
    parentClass: 'C',
    parentLabel: 'C·长尾款',
    subTierKind: 'pool',
    kpiMode: 'pool',
    measurable: true,
  },
  'C:sku-core': {
    segment: 'C:sku-core',
    label: 'C·长尾款·分解·主力',
    parentClass: 'C',
    parentLabel: 'C·长尾款',
    subTierKind: 'sku_split',
    kpiMode: 'display_only',
    measurable: false,
  },
  'C:sku-mid': {
    segment: 'C:sku-mid',
    label: 'C·长尾款·分解·腰部',
    parentClass: 'C',
    parentLabel: 'C·长尾款',
    subTierKind: 'sku_split',
    kpiMode: 'display_only',
    measurable: false,
  },
  'C:sku-tail': {
    segment: 'C:sku-tail',
    label: 'C·长尾款·分解·长尾',
    parentClass: 'C',
    parentLabel: 'C·长尾款',
    subTierKind: 'sku_split',
    kpiMode: 'display_only',
    measurable: false,
  },
  'D:floor': {
    segment: 'D:floor',
    label: 'D·问题款·下限管理',
    parentClass: 'D',
    parentLabel: 'D·问题款',
    subTierKind: 'risk',
    kpiMode: 'risk',
    measurable: false,
  },
  'D:skipped': {
    segment: 'D:skipped',
    label: 'D·问题款·已跳过',
    parentClass: 'D',
    parentLabel: 'D·问题款',
    subTierKind: 'risk',
    kpiMode: 'risk',
    measurable: false,
  },
};

/** V4.1 KPI 分层中文名（profile_segment 可能存 T1/T4B 等，与 ABCD 子档并存） */
const ALLCAT_V41_TIER_LABEL: Record<string, string> = {
  T1: 'T1 主力稳定',
  T2: 'T2 核心高量',
  T3: 'T3 中量',
  T3P: 'T3P 非亚马逊稳定',
  T4A: 'T4A 亚马逊边界',
  T4B: 'T4B 稳定保底',
  T99: 'T99 不预测',
};

export function computeContinuity(monthlyQty: number[]): number {
  if (monthlyQty.length === 0) return 0;
  const active = monthlyQty.filter((q) => q > 0).length;
  return active / monthlyQty.length;
}

export function computeCv(monthlyQty: number[]): number {
  if (monthlyQty.length === 0) return 999;
  const mean = monthlyQty.reduce((s, x) => s + x, 0) / monthlyQty.length;
  if (mean <= 0) return 999;
  const variance =
    monthlyQty.reduce((s, x) => s + (x - mean) ** 2, 0) / monthlyQty.length;
  return Math.sqrt(variance) / mean;
}

export function classifyForecastProfile(
  monthlyQty: number[],
  config: ForecastProfileConfig = DEFAULT_FORECAST_PROFILE_CONFIG,
): ProfileClass {
  const continuity = computeContinuity(monthlyQty);
  const cv = computeCv(monthlyQty);
  if (continuity > config.continuityMinA && cv < config.cvMaxA) return 'A';
  if (continuity > config.continuityMinB && cv >= config.cvMaxA) return 'B';
  if (continuity < config.continuityMinA && cv < config.cvMaxC) return 'C';
  return 'D';
}

export function profileClassLabel(cls: ProfileClass): string {
  return PROFILE_CLASS_META[cls].label;
}

export function segmentLabel(segment: ProfileSegment | string): string {
  const meta = PROFILE_SEGMENT_META[segment as ProfileSegment];
  if (meta) return meta.label;
  return ALLCAT_V41_TIER_LABEL[segment] ?? segment;
}

export function resolveProfileSegment(
  profileClass: ProfileClass,
  opts: {
    volumeTier?: VolumeTier;
    layer?: 'pool' | 'sku' | 'floor' | 'skipped';
    skipped?: boolean;
  },
): ProfileSegment {
  if (profileClass === 'D') {
    if (opts.skipped || opts.layer === 'skipped') return 'D:skipped';
    return 'D:floor';
  }
  if (profileClass === 'C') {
    if (opts.layer === 'pool') return 'C:pool';
    const tier = opts.volumeTier ?? 'mid';
    if (tier === 'core') return 'C:sku-core';
    if (tier === 'tail') return 'C:sku-tail';
    return 'C:sku-mid';
  }
  const tier = opts.volumeTier ?? 'mid';
  return `${profileClass}:${tier}` as ProfileSegment;
}

export function resolveSkuProfileSegment(input: {
  monthlyQty: number[];
  profileClass?: ProfileClass;
  layer?: 'pool' | 'sku' | 'floor' | 'skipped';
  skipped?: boolean;
}): {
  profileClass: ProfileClass;
  volumeTier: VolumeTier;
  segment: ProfileSegment;
  continuity: number;
  cv: number;
} {
  const profileClass = input.profileClass ?? classifyForecastProfile(input.monthlyQty);
  const avgDaily =
    input.monthlyQty.length > 0
      ? input.monthlyQty.reduce((s, x) => s + x, 0) / input.monthlyQty.length
      : 0;
  const volumeTier = classifyVolumeTier(avgDaily);
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

export function isComparableForAccuracy(
  profileClass: ProfileClass,
  actualSum: number,
  opts?: { holdoutAllZero?: boolean },
): boolean {
  if (profileClass === 'D') return false;
  if (opts?.holdoutAllZero) return false;
  return actualSum > 0;
}
