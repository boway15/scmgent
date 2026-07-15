/**
 * A 类需求风险：识别断销/间歇/下滑，用于 ghost 防控与预测折扣。
 */

function median6(monthlyQty: number[]): number {
  const recent = monthlyQty.slice(-6).map((q) => Math.max(0, Number(q) || 0));
  if (recent.length === 0) return 0;
  const sorted = [...recent].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export type AClassDemandRisk = 'stable' | 'decline' | 'intermittent' | 'stale' | 'spike';

export type AClassDemandRiskResult = {
  tier: AClassDemandRisk;
  forceZero: boolean;
  /** 0~1，乘到点预测上 */
  demandDiscount: number;
  last3ToPrior3Ratio: number | null;
};

export function evaluateAClassDemandRisk(monthlyQty: number[]): AClassDemandRiskResult {
  const ts = monthlyQty.map((q) => Math.max(0, Number(q) || 0));
  if (ts.length === 0) {
    return { tier: 'stale', forceZero: true, demandDiscount: 0, last3ToPrior3Ratio: null };
  }

  const last2 = ts.slice(-2);
  const last3 = ts.slice(-3);
  const prior3 = ts.slice(-6, -3);
  const last6 = ts.slice(-6);
  const last2Sum = last2.reduce((a, b) => a + b, 0);
  const last3Sum = last3.reduce((a, b) => a + b, 0);
  const prior3Sum = prior3.reduce((a, b) => a + b, 0);
  const activeLast6 = last6.filter((q) => q > 0).length;
  const ratio = prior3Sum > 0 ? last3Sum / prior3Sum : null;

  if (activeLast6 <= 1) {
    return { tier: 'intermittent', forceZero: true, demandDiscount: 0, last3ToPrior3Ratio: ratio };
  }
  if (activeLast6 === 2) {
    return {
      tier: 'intermittent',
      forceZero: false,
      demandDiscount: 0.55,
      last3ToPrior3Ratio: ratio,
    };
  }
  if (last2Sum === 0) {
    return { tier: 'stale', forceZero: true, demandDiscount: 0, last3ToPrior3Ratio: ratio };
  }
  const lastMonth = ts[ts.length - 1] ?? 0;
  const prevMonth = ts[ts.length - 2] ?? 0;
  if (lastMonth === 0 && prevMonth > 0) {
    return {
      tier: 'stale',
      forceZero: false,
      demandDiscount: 1,
      last3ToPrior3Ratio: ratio,
    };
  }
  if (last3Sum === 0) {
    return { tier: 'stale', forceZero: true, demandDiscount: 0, last3ToPrior3Ratio: ratio };
  }
  if (ratio != null && ratio < 0.35) {
    return { tier: 'stale', forceZero: true, demandDiscount: 0, last3ToPrior3Ratio: ratio };
  }
  if (ratio != null && ratio < 0.65) {
    return {
      tier: 'decline',
      forceZero: false,
      demandDiscount: Math.max(0.4, ratio),
      last3ToPrior3Ratio: ratio,
    };
  }
  if (ratio != null && ratio < 0.85) {
    return {
      tier: 'decline',
      forceZero: false,
      demandDiscount: Math.max(0.65, ratio * 0.95),
      last3ToPrior3Ratio: ratio,
    };
  }

  const last = ts[ts.length - 1] ?? 0;
  const med6 = median6(ts);
  if (med6 > 0 && last > med6 * 1.25) {
    return { tier: 'spike', forceZero: false, demandDiscount: 0.88, last3ToPrior3Ratio: ratio };
  }

  if (med6 > 0 && med6 < 80 && activeLast6 <= 4) {
    return {
      tier: 'intermittent',
      forceZero: false,
      demandDiscount: 0.62,
      last3ToPrior3Ratio: ratio,
    };
  }

  return { tier: 'stable', forceZero: false, demandDiscount: 1, last3ToPrior3Ratio: ratio };
}
