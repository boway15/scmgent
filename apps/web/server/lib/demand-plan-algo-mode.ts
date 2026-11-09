export type DemandPlanWeeklyAlgo = 'v41_inline' | 'v41_w';

/** 周度销量预测生成算法；默认 v41_inline（与现网一致） */
export function resolveDemandPlanWeeklyAlgo(
  override?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): DemandPlanWeeklyAlgo {
  const raw = (override ?? env.DEMAND_PLAN_WEEKLY_ALGO ?? 'v41_inline').trim().toLowerCase();
  if (raw === 'v41_w' || raw === 'v41-w' || raw === 'allcat_v41_w') return 'v41_w';
  return 'v41_inline';
}
