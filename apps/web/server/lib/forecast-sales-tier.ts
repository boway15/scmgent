/**
 * 销量规律分层：从历史月销提炼特征，替代 ABCD 连续×CV 矩阵。
 * 主攻 T1（主力锚定）达标，其余层按可预测性设不同 KPI 或跳过。
 */
import { isLastMonthCollapsed, isTrainEndFading } from './forecast-monthly-abcd.js';

export type SalesTier =
  | 'T1_anchor'
  | 'T2_stable'
  | 'T3_seasonal'
  | 'T4_intermittent'
  | 'T5_new_or_dormant'
  | 'T6_zero';

/** 主攻验收段：T1 中连续高销、非新品爆发 */
export type SalesTierSegment =
  | 'T1:elite'
  | 'T1:anchor'
  | 'T2:stable'
  | 'T3:seasonal'
  | 'T4:intermittent'
  | 'T5:new_or_dormant'
  | 'T6:zero';

/** T1 子层：一层一层验收 */
export type T1SubSegment =
  | 'T1.1_elite_stable'
  | 'T1.2_elite_decline'
  | 'T1.3_anchor_stable'
  | 'T1.4_anchor_decline'
  | 'T1.5_train_collapse';

export const T1_SUB_SEGMENT_META: Record<
  T1SubSegment,
  {
    label: string;
    description: string;
    measurable: boolean;
    pointForecast: boolean;
    gateOrder: number;
  }
> = {
  'T1.1_elite_stable': {
    label: 'T1.1·核心稳定',
    description: 'elite + 近端未下滑 + 无训练塌陷；Gate-0 主攻',
    measurable: true,
    pointForecast: true,
    gateOrder: 0,
  },
  'T1.2_elite_decline': {
    label: 'T1.2·核心下滑',
    description: 'elite + 近3月相对前9月走弱；区间/折扣，点预测参考',
    measurable: true,
    pointForecast: false,
    gateOrder: 1,
  },
  'T1.3_anchor_stable': {
    label: 'T1.3·标准稳定',
    description: '标准主力 + 稳定；Gate-1',
    measurable: true,
    pointForecast: true,
    gateOrder: 2,
  },
  'T1.4_anchor_decline': {
    label: 'T1.4·标准下滑',
    description: '标准主力 + 近端下滑；点预测参考',
    measurable: true,
    pointForecast: false,
    gateOrder: 3,
  },
  'T1.5_train_collapse': {
    label: 'T1.5·训练塌陷',
    description: '训练末月异常低/断销；ghost 防控，不计点预测 KPI',
    measurable: false,
    pointForecast: false,
    gateOrder: 4,
  },
};

export const T1_DECLINE_Q4_BOOST_THRESHOLD = 0.85;

export type SalesTierMeta = {
  tier: SalesTier;
  label: string;
  description: string;
  forecastRoute: 'anchor' | 'stable' | 'seasonal' | 'pool' | 'zero';
  kpiMeasurable: boolean;
  primaryAttack: boolean;
};

export const SALES_TIER_META: Record<SalesTier, SalesTierMeta> = {
  T1_anchor: {
    tier: 'T1_anchor',
    label: 'T1·主力锚定',
    description: '训练窗高连续、中高销量、波动可控；近端 WMAPE 主攻层',
    forecastRoute: 'anchor',
    kpiMeasurable: true,
    primaryAttack: true,
  },
  T2_stable: {
    tier: 'T2_stable',
    label: 'T2·稳定腰部',
    description: '连续销售但量级中等；次优先 WMAPE 验收',
    forecastRoute: 'stable',
    kpiMeasurable: true,
    primaryAttack: false,
  },
  T3_seasonal: {
    tier: 'T3_seasonal',
    label: 'T3·季节波动',
    description: '有销月份多但 CV 高；区间/季节 naive，WMAPE 参考',
    forecastRoute: 'seasonal',
    kpiMeasurable: true,
    primaryAttack: false,
  },
  T4_intermittent: {
    tier: 'T4_intermittent',
    label: 'T4·间歇长尾',
    description: '断断续续；品类池分解，SKU 级 WMAPE 仅展示',
    forecastRoute: 'pool',
    kpiMeasurable: false,
    primaryAttack: false,
  },
  T5_new_or_dormant: {
    tier: 'T5_new_or_dormant',
    label: 'T5·新品/休眠爆发',
    description: '训练几乎无销、验证突然起量；不做点预测，需外生标记',
    forecastRoute: 'zero',
    kpiMeasurable: false,
    primaryAttack: false,
  },
  T6_zero: {
    tier: 'T6_zero',
    label: 'T6·训练无销',
    description: '训练窗零销；零预测，不计 WMAPE',
    forecastRoute: 'zero',
    kpiMeasurable: false,
    primaryAttack: false,
  },
};

export const SALES_TIER_SEGMENT_META: Record<
  SalesTierSegment,
  { label: string; tier: SalesTier; measurable: boolean; primaryAttack: boolean }
> = {
  'T1:elite': {
    label: 'T1·主力·核心',
    tier: 'T1_anchor',
    measurable: true,
    primaryAttack: true,
  },
  'T1:anchor': {
    label: 'T1·主力·标准',
    tier: 'T1_anchor',
    measurable: true,
    primaryAttack: true,
  },
  'T2:stable': {
    label: 'T2·稳定腰部',
    tier: 'T2_stable',
    measurable: true,
    primaryAttack: false,
  },
  'T3:seasonal': {
    label: 'T3·季节波动',
    tier: 'T3_seasonal',
    measurable: true,
    primaryAttack: false,
  },
  'T4:intermittent': {
    label: 'T4·间歇长尾',
    tier: 'T4_intermittent',
    measurable: false,
    primaryAttack: false,
  },
  'T5:new_or_dormant': {
    label: 'T5·新品/休眠爆发',
    tier: 'T5_new_or_dormant',
    measurable: false,
    primaryAttack: false,
  },
  'T6:zero': {
    label: 'T6·训练无销',
    tier: 'T6_zero',
    measurable: false,
    primaryAttack: false,
  },
};

export type SalesHistoryFeatures = {
  trainSum: number;
  trainAvg: number;
  activeMonths: number;
  continuity: number;
  cv: number;
  last3Avg: number;
  prior9Avg: number;
  q4Boost: number;
  collapsed: boolean;
  isNewBurst: boolean;
};

export function extractSalesHistoryFeatures(monthlyQty: number[]): SalesHistoryFeatures {
  const ts = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  const trainSum = ts.reduce((a, b) => a + b, 0);
  const trainAvg = ts.length ? trainSum / ts.length : 0;
  const activeMonths = ts.filter((q) => q > 0).length;
  const continuity = ts.length ? activeMonths / ts.length : 0;
  const mean = trainAvg;
  const cv =
    mean > 0
      ? Math.sqrt(ts.reduce((s, x) => s + (x - mean) ** 2, 0) / ts.length) / mean
      : 999;
  const last3 = ts.slice(-3);
  const prior9 = ts.slice(-12, -3);
  const last3Avg = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : 0;
  const prior9Avg = prior9.length ? prior9.reduce((a, b) => a + b, 0) / prior9.length : 0;
  const q4Boost = prior9Avg > 0 ? last3Avg / prior9Avg : 1;
  const isNewBurst = trainSum > 0 && trainSum <= trainAvg * 2;
  return {
    trainSum,
    trainAvg,
    activeMonths,
    continuity,
    cv,
    last3Avg,
    prior9Avg,
    q4Boost,
    collapsed: isLastMonthCollapsed(ts) || isTrainEndFading(ts),
    isNewBurst,
  };
}

/** 分层规则（阈值来自 discover-sales-tiers 回测提炼） */
export function classifySalesTier(
  monthlyQty: number[],
  opts?: { holdoutSum?: number },
): SalesTier {
  const f = extractSalesHistoryFeatures(monthlyQty);
  const holdoutSum = opts?.holdoutSum ?? 0;

  if (f.trainSum === 0) return 'T6_zero';
  if (f.activeMonths <= 2 || (f.isNewBurst && f.trainSum < 400)) {
    return 'T5_new_or_dormant';
  }
  if (opts?.holdoutSum != null && opts.holdoutSum > 500 && f.trainSum < 300) {
    return 'T5_new_or_dormant';
  }
  if (f.continuity >= 0.75 && f.trainAvg >= 150 && f.cv < 1.0) return 'T1_anchor';
  if (f.continuity >= 0.6 && f.trainAvg >= 50 && f.cv < 1.2) return 'T2_stable';
  if (f.continuity >= 0.5 && f.cv >= 1.0) return 'T3_seasonal';
  if (f.continuity < 0.5 || f.activeMonths <= 8) return 'T4_intermittent';
  return 'T2_stable';
}

export function isT1Elite(features: SalesHistoryFeatures): boolean {
  return (
    features.trainSum > 0 &&
    !features.isNewBurst &&
    features.continuity >= 0.85 &&
    features.trainAvg >= 200 &&
    features.cv < 0.9
  );
}

export function isT1Decline(features: SalesHistoryFeatures): boolean {
  return features.q4Boost < T1_DECLINE_Q4_BOOST_THRESHOLD;
}

/** T1 子层路由（训练特征） */
export function resolveT1SubSegment(features: SalesHistoryFeatures): T1SubSegment {
  if (features.collapsed) return 'T1.5_train_collapse';
  const elite = isT1Elite(features);
  const decline = isT1Decline(features);
  if (elite && decline && features.q4Boost < 0.78) return 'T1.5_train_collapse';
  if (!elite && decline && features.q4Boost < 0.82) return 'T1.5_train_collapse';
  if (elite && !decline) return 'T1.1_elite_stable';
  if (elite && decline) return 'T1.2_elite_decline';
  if (!elite && !decline) return 'T1.3_anchor_stable';
  return 'T1.4_anchor_decline';
}

export function t1SubSegmentLabel(sub: T1SubSegment): string {
  return T1_SUB_SEGMENT_META[sub].label;
}

export function resolveSalesTierSegment(
  monthlyQty: number[],
  opts?: { holdoutSum?: number },
): {
  tier: SalesTier;
  segment: SalesTierSegment;
  features: SalesHistoryFeatures;
} {
  const features = extractSalesHistoryFeatures(monthlyQty);
  const tier = classifySalesTier(monthlyQty, opts);
  let segment: SalesTierSegment;
  if (tier === 'T1_anchor') {
    segment = isT1Elite(features) ? 'T1:elite' : 'T1:anchor';
  } else if (tier === 'T2_stable') {
    segment = 'T2:stable';
  } else if (tier === 'T3_seasonal') {
    segment = 'T3:seasonal';
  } else if (tier === 'T4_intermittent') {
    segment = 'T4:intermittent';
  } else if (tier === 'T5_new_or_dormant') {
    segment = 'T5:new_or_dormant';
  } else {
    segment = 'T6:zero';
  }
  return { tier, segment, features };
}

/** 映射到现有 monthly_abcd 路由（渐进迁移，不重写预测核） */
export function salesTierToProfileClass(tier: SalesTier): 'A' | 'B' | 'C' | 'D' {
  switch (tier) {
    case 'T1_anchor':
    case 'T2_stable':
      return 'A';
    case 'T3_seasonal':
      return 'B';
    case 'T4_intermittent':
      return 'C';
    case 'T5_new_or_dormant':
    case 'T6_zero':
    default:
      return 'D';
  }
}

export function salesTierSkipsForecast(tier: SalesTier): boolean {
  return tier === 'T5_new_or_dormant' || tier === 'T6_zero';
}

export const ATTACK_PHASE_TIERS: SalesTier[] = ['T1_anchor'];

export function getForecastPhase(): 'attack' | 'full' {
  if (process.env.FORECAST_ATTACK_PHASE === 'full') return 'full';
  return 'attack';
}

/** 主攻阶段：仅 T1 出预测，其余层跳过 */
export function shouldForecastSalesTier(
  tier: SalesTier,
  phase?: 'attack' | 'full',
): boolean {
  const p = phase ?? getForecastPhase();
  if (salesTierSkipsForecast(tier)) return false;
  if (p === 'attack') return tier === 'T1_anchor';
  return tier === 'T4_intermittent' || tier === 'T1_anchor' || tier === 'T2_stable' || tier === 'T3_seasonal';
}

export const SALES_TIER_KPI_TARGETS: Partial<Record<string, number>> = {
  'T1:elite:precision': 0.2,
  'T1:elite:flex': 0.28,
  'T1:anchor:precision': 0.25,
  'T1:anchor:flex': 0.32,
  'T1.1_elite_stable:precision': 0.2,
  'T1.1_elite_stable:flex': 0.28,
  'T1.2_elite_decline:precision': 0.32,
  'T1.3_anchor_stable:precision': 0.25,
  'T1.3_anchor_stable:flex': 0.32,
  'T1.4_anchor_decline:precision': 0.39,
  'T2:stable:precision': 0.3,
  'T2:stable:flex': 0.38,
  'T3:seasonal:precision': 0.35,
  'T3:seasonal:flex': 0.42,
};

export function getT1SubKpiTarget(
  sub: T1SubSegment,
  band: 'precision' | 'flex',
): number | null {
  return SALES_TIER_KPI_TARGETS[`${sub}:${band}`] ?? null;
}

export function getSalesTierKpiTarget(segment: SalesTierSegment, band: 'precision' | 'flex'): number | null {
  return SALES_TIER_KPI_TARGETS[`${segment}:${band}`] ?? null;
}

export function salesTierLabel(tier: SalesTier): string {
  return SALES_TIER_META[tier].label;
}

export function salesTierSegmentLabel(segment: SalesTierSegment): string {
  return SALES_TIER_SEGMENT_META[segment].label;
}
