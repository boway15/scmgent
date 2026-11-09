/**
 * 周预测近端混合：前 4 周把缺货还原近端日均按形状贴到 v41_inline 拆周曲线上，第 5 周起退回拆周。
 */
import { roundDaily } from './forecast-baseline.js';
import { clipDemandShape } from './demand-plan-reconstruct.js';

/** weekIndex 0..3；更远周 α=0 */
export const NEAR_BLEND_ALPHAS = [0.7, 0.5, 0.3, 0.15] as const;

const NEAR_LEVEL_FLOOR_RATIO = 0.4;
const NEAR_LEVEL_CAP_RATIO = 2.5;

export function nearBlendAlpha(weekIndex: number): number {
  if (!Number.isFinite(weekIndex) || weekIndex < 0) return NEAR_BLEND_ALPHAS[0];
  return NEAR_BLEND_ALPHAS[weekIndex] ?? 0;
}

/** L = winsorize(0.6*r14 + 0.4*U)，r90>0 时夹在 [0.4*r90, 2.5*r90] */
export function resolveNearBlendLevel(input: {
  r14: number;
  unconstrainedRecentDaily: number;
  r90: number;
}): number {
  const r14 = Number.isFinite(input.r14) ? Math.max(0, input.r14) : 0;
  const unconstrained = Number.isFinite(input.unconstrainedRecentDaily)
    ? Math.max(0, input.unconstrainedRecentDaily)
    : 0;
  const r90 = Number.isFinite(input.r90) ? Math.max(0, input.r90) : 0;
  let level = 0.6 * r14 + 0.4 * unconstrained;
  if (r90 > 0) {
    level = Math.min(r90 * NEAR_LEVEL_CAP_RATIO, Math.max(r90 * NEAR_LEVEL_FLOOR_RATIO, level));
  }
  return roundDaily(level);
}

/** F_0<=0 时形状为 1；否则 clip(F_k/F_0, 0.5, 2) */
export function resolveNearBlendShape(inlineDaily: number, anchorInlineDaily: number): number {
  if (!Number.isFinite(anchorInlineDaily) || anchorInlineDaily <= 0) return 1;
  const inline = Number.isFinite(inlineDaily) ? inlineDaily : 0;
  return clipDemandShape(inline / anchorInlineDaily);
}

export type InlineWeekBlend = {
  forecastDaily: number;
  alpha: number;
  shape: number;
  inlineDaily: number;
  nearLevel: number;
};

/** ŷ = α * L * S + (1-α) * F_k */
export function blendInlineWeekDaily(input: {
  weekIndex: number;
  inlineDaily: number;
  anchorInlineDaily: number;
  nearLevel: number;
}): InlineWeekBlend {
  const alpha = nearBlendAlpha(input.weekIndex);
  const inlineDaily = Number.isFinite(input.inlineDaily) ? Math.max(0, input.inlineDaily) : 0;
  const nearLevel = Number.isFinite(input.nearLevel) ? Math.max(0, input.nearLevel) : 0;
  const shape = resolveNearBlendShape(inlineDaily, input.anchorInlineDaily);
  const forecastDaily = roundDaily(alpha * nearLevel * shape + (1 - alpha) * inlineDaily);
  return { forecastDaily, alpha, shape, inlineDaily, nearLevel };
}
