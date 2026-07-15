/** V4.1「系统」列计算拆解（与 server/lib/forecast-allcat-v41.ts 对齐，仅供前端展示） */

export const V41_GROWTH_RECENT_RATIO_MIN = 1.15;
export const V41_CORE_COLLAPSE_THRESHOLD = 0.7;
export const V41_CORE_NEAR_BLEND_FLOOR = 0.78;

export function v41TrendDecayFactor(trendRatio: number): number {
  const t = Number.isFinite(trendRatio) ? trendRatio : 1;
  if (t < 0.45) return 0.4;
  if (t < 0.65) return 0.62;
  if (t < 0.85) return 0.85;
  if (t > 2.0) return 1.12;
  if (t > 1.35) return 1.06;
  return 1.0;
}

export function v41ResolveEffectiveTrendDecay(input: {
  tier: string;
  trendRatio: number;
  recent30DailyAvg?: number | null;
  recent90DailyAvg?: number | null;
}): { factor: number; growthSignal: boolean; rollingRatio: number } {
  const recent30 = nonNegative(input.recent30DailyAvg);
  const recent90 = nonNegative(input.recent90DailyAvg);
  const rollingRatio = recent90 > 0 ? recent30 / recent90 : 1;
  const coreTier = input.tier === 'T1' || input.tier === 'T2';
  const calendarSoft = input.trendRatio < 0.85;
  const growthSignal = rollingRatio >= V41_GROWTH_RECENT_RATIO_MIN && !(coreTier && calendarSoft);
  if (growthSignal) {
    return {
      factor: Math.max(1.0, v41TrendDecayFactor(rollingRatio)),
      growthSignal: true,
      rollingRatio,
    };
  }
  return {
    factor: v41TrendDecayFactor(input.trendRatio),
    growthSignal: false,
    rollingRatio,
  };
}

export function v41ResolveMonthFactor(
  forecastMonth: number,
  horizonIndex: number,
  tier?: string,
): number {
  if (forecastMonth < 4) return 1.0;
  const k = Math.max(0, Math.floor(horizonIndex));
  const coreTier = tier === 'T1' || tier === 'T2';
  if (k <= 0) return coreTier ? 0.98 : 1.0;
  if (k === 1) return 0.98;
  if (k === 2) return 0.96;
  if (k <= 4) return 0.95;
  return 0.94;
}

export function v41TierConservativeFactor(tier: string, productCategory: string): number {
  if (productCategory === 'C' && tier === 'T2') return 0.88;
  if (productCategory === 'B' && tier === 'T1') return 0.86;
  switch (tier) {
    case 'T1':
      return 0.88;
    case 'T2':
      return 0.94;
    case 'T3':
      return 0.97;
    case 'T4B':
      return 0.9;
    default:
      return 1.0;
  }
}

function v41TierFloorDaily(tier: string, d6: number): number {
  switch (tier) {
    case 'T1':
      return d6 * 0.55;
    case 'T2':
      return d6 * 0.5;
    case 'T3':
      return d6 * 0.4;
    case 'T3P':
      return d6 * 0.35;
    case 'T4A':
      return 0.12;
    case 'T4B':
      return Math.max(0.08, d6 * 0.25);
    default:
      return 0;
  }
}

function v41TierCeilingDaily(
  tier: string,
  d6: number,
  d3: number,
  recent30DailyAvg?: number | null,
  recent90DailyAvg?: number | null,
): number {
  let ceiling: number;
  switch (tier) {
    case 'T1':
      ceiling = Math.max(d6 * 1.05, d3 * 1.02);
      break;
    case 'T2':
      ceiling = Math.max(d6 * 1.1, d3 * 1.06);
      break;
    case 'T3':
      ceiling = Math.max(d6 * 1.15, d3 * 1.1);
      break;
    case 'T3P':
      ceiling = Math.max(d6 * 1.1, d3 * 1.05);
      break;
    case 'T4A':
      ceiling = Math.max(d6 * 1.12, d3 * 1.08);
      break;
    case 'T4B':
      ceiling = Math.max(d6 * 1.08, d3 * 1.05);
      break;
    default:
      return 0;
  }
  if (tier === 'T4A' || tier === 'T4B') {
    const recent90 = nonNegative(recent90DailyAvg);
    const recent30 = nonNegative(recent30DailyAvg);
    const recentAnchor = Math.max(
      recent90 > 0 ? recent90 * 1.05 : 0,
      recent30 > 0 ? recent30 * 0.95 : 0,
    );
    if (recentAnchor > 0) {
      ceiling = Math.max(ceiling, recentAnchor);
    }
  }
  return ceiling;
}

function v41ResolveNearHorizonFloor(input: {
  tier: string;
  blendLevel: number;
  d6: number;
  recent90DailyAvg?: number | null;
  horizonIndex: number;
}): number {
  const k = Math.max(0, Math.floor(input.horizonIndex));
  if (k > 2) return 0;
  if (input.tier === 'T1' || input.tier === 'T2') {
    return input.blendLevel * V41_CORE_NEAR_BLEND_FLOOR;
  }
  if (input.tier === 'T3' || input.tier === 'T3P') {
    return Math.max(input.blendLevel * 0.82, input.d6 * 0.85);
  }
  const recent90 = nonNegative(input.recent90DailyAvg);
  return Math.max(
    input.blendLevel * 0.85,
    input.d6 * 0.9,
    recent90 > 0 ? recent90 * 0.85 : 0,
  );
}

function nonNegative(value: number | undefined | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '-');

function roundDaily(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10_000) / 10_000;
}

function hasBoundedSnapshot(
  snapshot?: AllCatV41BoundedSnapshot | null,
): snapshot is AllCatV41BoundedSnapshot {
  if (!snapshot) return false;
  return (
    snapshot.effectiveTrendDecay != null &&
    snapshot.monthFactor != null &&
    snapshot.conservativeFactor != null
  );
}

export type AllCatV41BoundedSnapshot = {
  productCategory?: string;
  effectiveTrendDecay?: number;
  monthFactor?: number;
  conservativeFactor?: number;
  tierCeiling?: number;
  nearHorizonFloor?: number | null;
  growthSignal?: boolean;
  rollingRatio?: number;
};

/** 生成「系统」列悬停拆解（多行，\n 分隔）；最终数值与 forecastDailyAvg 对齐 */
export function buildV41SystemBreakdown(input: {
  blendLevel: number;
  trendRatio: number;
  forecastMonth: number;
  horizonIndex?: number;
  tier: string;
  d6: number;
  d3?: number;
  productCategory?: string | null;
  recent30DailyAvg?: number | null;
  recent90DailyAvg?: number | null;
  /** 库内系统预测日均，与单元格展示一致 */
  actualForecastDailyAvg: number;
  /** 生成时持久化的套限幅因子（有则优先，避免前端重算偏差） */
  boundedSnapshot?: AllCatV41BoundedSnapshot | null;
}): string {
  const { blendLevel, trendRatio, forecastMonth, tier, d6, actualForecastDailyAvg } = input;
  const d3 = input.d3 ?? 0;
  const horizonIndex = input.horizonIndex ?? 0;
  const productCategory = input.boundedSnapshot?.productCategory ?? input.productCategory ?? '';

  const trend = hasBoundedSnapshot(input.boundedSnapshot)
    ? {
        factor: input.boundedSnapshot.effectiveTrendDecay!,
        growthSignal: input.boundedSnapshot.growthSignal ?? false,
        rollingRatio: input.boundedSnapshot.rollingRatio ?? 1,
      }
    : v41ResolveEffectiveTrendDecay({
        tier,
        trendRatio,
        recent30DailyAvg: input.recent30DailyAvg,
        recent90DailyAvg: input.recent90DailyAvg,
      });

  const monthFactor =
    input.boundedSnapshot?.monthFactor ??
    v41ResolveMonthFactor(forecastMonth, horizonIndex, tier);
  const conservative =
    input.boundedSnapshot?.conservativeFactor ??
    v41TierConservativeFactor(tier, productCategory);

  const adjusted = roundDaily(blendLevel * trend.factor * monthFactor * conservative);
  const floor = v41TierFloorDaily(tier, d6);
  const ceiling =
    input.boundedSnapshot?.tierCeiling ??
    v41TierCeilingDaily(tier, d6, d3, input.recent30DailyAvg, input.recent90DailyAvg);
  let pipelineResult = roundDaily(Math.min(Math.max(adjusted, floor), ceiling));

  if (horizonIndex <= 2) {
    if (tier === 'T1' || tier === 'T2') {
      const collapseThreshold = blendLevel * V41_CORE_COLLAPSE_THRESHOLD;
      if (pipelineResult < collapseThreshold) {
        const nearFloor = roundDaily(blendLevel * V41_CORE_NEAR_BLEND_FLOOR);
        if (nearFloor > pipelineResult) pipelineResult = nearFloor;
      }
    } else {
      const nearFloor = roundDaily(
        v41ResolveNearHorizonFloor({
          tier,
          blendLevel,
          d6,
          recent90DailyAvg: input.recent90DailyAvg,
          horizonIndex,
        }),
      );
      if (nearFloor > pipelineResult) pipelineResult = nearFloor;
    }
  }

  const lines = [
    '系统 = 混合水平 × 趋势衰减 × 月折减 × 分层保守，再夹在上下限内；近端月有地板：',
    `${fmt(blendLevel)} × ${fmt(trend.factor)} × ${fmt(monthFactor)} × ${fmt(conservative)} = ${fmt(adjusted)}`,
  ];

  if (trend.growthSignal) {
    lines.push(
      `growth 信号：recent30/recent90=${fmt(trend.rollingRatio)}，趋势衰减用滚动口径（≥1.0）`,
    );
  } else if (trend.factor !== 1) {
    lines.push(`趋势衰减：日历趋势比 ${fmt(trendRatio)} → ×${fmt(trend.factor)}`);
  } else {
    lines.push(`趋势衰减：日历趋势比 ${fmt(trendRatio)}，未触发折减（×1.00）`);
  }

  if (monthFactor < 1) {
    lines.push(`月折减：${forecastMonth} 月 horizon k=${horizonIndex} → ×${fmt(monthFactor)}`);
  } else {
    lines.push(`月折减：${forecastMonth} 月 k=${horizonIndex}，×1.00`);
  }

  if (productCategory) {
    lines.push(`${tier}（${productCategory}）保守系数 ×${fmt(conservative)}`);
  } else {
    lines.push(`${tier} 保守系数 ×${fmt(conservative)}`);
  }
  lines.push(`下限 ${fmt(floor)}，上限 ${fmt(ceiling)}`);

  const nearFloorApplied =
    input.boundedSnapshot?.nearHorizonFloor != null &&
    input.boundedSnapshot.nearHorizonFloor > adjusted + 0.005;

  if (horizonIndex <= 2 && (pipelineResult > adjusted + 0.005 || nearFloorApplied)) {
    if (tier === 'T1' || tier === 'T2') {
      lines.push(`T1/T2 近端防塌陷（仅当低于混合×${V41_CORE_COLLAPSE_THRESHOLD}）`);
    } else {
      lines.push('近端地板抬升（k≤2）');
    }
  }

  if (pipelineResult > adjusted + 0.005) {
    lines.push(`套限幅后 ${fmt(pipelineResult)}`);
  } else if (pipelineResult < adjusted - 0.005) {
    lines.push(`超过上限，压至 ${fmt(pipelineResult)}`);
  }

  const actual = roundDaily(actualForecastDailyAvg);
  if (Math.abs(actual - pipelineResult) > 0.005) {
    lines.push(`→ 系统 ${fmt(actual)}（与公式中间步四舍五入后一致）`);
  } else {
    lines.push(`→ 系统 ${fmt(actual)}`);
  }

  return lines.join('\n');
}

/** 系统列悬停文案：AI 辅助与 V4.1 公式拆解 */
export function buildV41SystemCellTitle(input: {
  cell: {
    forecastDailyAvg: number;
    month: number;
    aiAssistRationale?: string | null;
  };
  v41: {
    levelDaily?: number | null;
    trendRatio: number;
    d6: number;
    d3: number;
    productCategory?: string;
    effectiveTrendDecay?: number;
    monthFactor?: number;
    conservativeFactor?: number;
    tierCeiling?: number;
    nearHorizonFloor?: number | null;
    growthSignal?: boolean;
    rollingRatio?: number;
  };
  monthIndex: number;
  tier: string;
  productCategory?: string | null;
  recent30DailyAvg?: number | null;
  recent90DailyAvg?: number | null;
}): string | undefined {
  const { cell, v41, monthIndex, tier } = input;
  if (v41.levelDaily == null) return undefined;

  if (cell.aiAssistRationale) {
    return [
      'AI 辅助预测写入系统列（非 V4.1 公式重算）',
      cell.aiAssistRationale,
      `系统列展示：${fmt(cell.forecastDailyAvg)}`,
    ].join('\n');
  }

  return buildV41SystemBreakdown({
    blendLevel: v41.levelDaily,
    trendRatio: v41.trendRatio,
    forecastMonth: cell.month,
    horizonIndex: monthIndex,
    tier,
    d6: v41.d6,
    d3: v41.d3,
    productCategory: input.productCategory,
    recent30DailyAvg: input.recent30DailyAvg,
    recent90DailyAvg: input.recent90DailyAvg,
    actualForecastDailyAvg: cell.forecastDailyAvg,
    boundedSnapshot: v41,
  });
}
