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
  peerPlatformFloor?: number | null;
  growthSignal?: boolean;
  rollingRatio?: number;
};

export type V41PlatformContribution = {
  platform: string;
  forecastDailyAvg: number;
  levelDaily?: number;
  seasonalDaily?: number;
  anchorDaily?: number;
  tier?: string;
};

/** 季节权重 w = min(0.62, 0.28 + k×0.07) */
export function v41SeasonBlendWeight(horizonIndex: number): number {
  const k = Math.max(0, Math.floor(horizonIndex));
  return Math.min(0.62, 0.28 + k * 0.07);
}

/** 全渠道合计时的系统列悬停文案（含各渠道贡献） */
export function buildV41MultiPlatformSystemTitle(input: {
  forecastDailyAvg: number;
  levelDaily?: number | null;
  seasonalDaily?: number | null;
  platformCount?: number;
  platformContributions?: V41PlatformContribution[] | null;
}): string {
  const count = input.platformCount ?? input.platformContributions?.length ?? 0;
  const lines = [
    '【全渠道合计 · 系统日均】',
    '口径：各渠道先独立走 V4.1（混合×趋势衰减×月折减×分层保守→套限幅），再对系统日均求和。',
    count > 1 ? `参与渠道：${count}` : '参与渠道：多渠道',
    '',
  ];

  const contributions = input.platformContributions ?? [];
  if (contributions.length > 0) {
    for (const row of contributions) {
      const tierPart = row.tier ? `  ${row.tier}` : '';
      const blendPart =
        row.levelDaily != null && Number.isFinite(row.levelDaily)
          ? `  混合 ${fmt(row.levelDaily)}`
          : '';
      const seasonalPart =
        row.seasonalDaily != null && Number.isFinite(row.seasonalDaily)
          ? `  季节 ${fmt(row.seasonalDaily)}`
          : '';
      lines.push(
        `${row.platform.padEnd(8)} 系统 ${fmt(row.forecastDailyAvg)}${blendPart}${seasonalPart}${tierPart}`,
      );
    }
    lines.push('────────');
  }

  const blendTotal =
    input.levelDaily != null && Number.isFinite(input.levelDaily)
      ? input.levelDaily
      : contributions.reduce((sum, row) => sum + (row.levelDaily ?? 0), 0);
  const seasonalTotal =
    input.seasonalDaily != null && Number.isFinite(input.seasonalDaily)
      ? input.seasonalDaily
      : contributions.reduce((sum, row) => sum + (row.seasonalDaily ?? 0), 0);

  lines.push(
    `合计      系统 ${fmt(input.forecastDailyAvg)}` +
      (blendTotal > 0 ? `  混合 ${fmt(blendTotal)}` : '') +
      (seasonalTotal > 0 ? `  季节 ${fmt(seasonalTotal)}` : ''),
  );
  lines.push('');
  lines.push('说明：合计行与表格「系统 / 混合水平」一致；不能把合计混合水平再套一遍单渠公式。');
  lines.push('切换筛选到单渠道后，悬停可查看该渠道逐步公式。');
  return lines.join('\n');
}

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
  const clamped = roundDaily(Math.min(Math.max(adjusted, floor), ceiling));
  let pipelineResult = clamped;

  let nearFloorNote: string | null = null;
  if (horizonIndex <= 2) {
    if (tier === 'T1' || tier === 'T2') {
      const collapseThreshold = roundDaily(blendLevel * V41_CORE_COLLAPSE_THRESHOLD);
      const nearFloor = roundDaily(blendLevel * V41_CORE_NEAR_BLEND_FLOOR);
      if (pipelineResult < collapseThreshold - 0.005 && nearFloor > pipelineResult + 0.005) {
        pipelineResult = nearFloor;
        nearFloorNote = `触发近端防塌陷：结果 ${fmt(clamped)} < 混合×${V41_CORE_COLLAPSE_THRESHOLD}=${fmt(collapseThreshold)}，抬至混合×${V41_CORE_NEAR_BLEND_FLOOR}=${fmt(nearFloor)}`;
      } else {
        nearFloorNote = `近端防塌陷未触发（结果 ${fmt(clamped)} ≥ 混合×${V41_CORE_COLLAPSE_THRESHOLD}=${fmt(collapseThreshold)}）`;
      }
    } else {
      const nearFloor = roundDaily(
        input.boundedSnapshot?.nearHorizonFloor ??
          v41ResolveNearHorizonFloor({
            tier,
            blendLevel,
            d6,
            recent90DailyAvg: input.recent90DailyAvg,
            horizonIndex,
          }),
      );
      if (nearFloor > pipelineResult + 0.005) {
        pipelineResult = nearFloor;
        nearFloorNote = `近端地板抬升：max(混合/d6/recent90 比例) → ${fmt(nearFloor)}`;
      } else if (nearFloor > 0) {
        nearFloorNote = `近端地板 ${fmt(nearFloor)}，未高于当前结果`;
      }
    }
  }

  const peerFloor = input.boundedSnapshot?.peerPlatformFloor;
  let peerFloorApplied = false;
  if (peerFloor != null && Number.isFinite(peerFloor) && peerFloor > pipelineResult + 0.005) {
    pipelineResult = roundDaily(peerFloor);
    peerFloorApplied = true;
  }

  const lines = [
    '【V4.1 系统日均 · 逐步计算】',
    `① 混合水平（levelDaily）= ${fmt(blendLevel)}`,
    '   · 来源：锚定×(1−w)+季节朴素×w；详见悬停「基线 / 混合水平」列',
    `② 趋势衰减 = ×${fmt(trend.factor)}`,
  ];

  if (trend.growthSignal) {
    lines.push(
      `   · growth：recent30/recent90=${fmt(trend.rollingRatio)} ≥ ${V41_GROWTH_RECENT_RATIO_MIN}，改用滚动口径且不低于 1.0`,
    );
  } else if (trend.factor !== 1) {
    lines.push(`   · 日历趋势比 ${fmt(trendRatio)} → 衰减系数 ×${fmt(trend.factor)}`);
  } else {
    lines.push(`   · 日历趋势比 ${fmt(trendRatio)}，未触发折减`);
  }

  lines.push(`③ 月折减 = ×${fmt(monthFactor)}`);
  lines.push(`   · 目标月 ${forecastMonth} 月，地平线序号 k=${horizonIndex}`);

  lines.push(
    productCategory
      ? `④ 分层保守 = ×${fmt(conservative)}（${tier} / 品类 ${productCategory}）`
      : `④ 分层保守 = ×${fmt(conservative)}（${tier}）`,
  );

  lines.push(
    `⑤ 乘积 = ${fmt(blendLevel)} × ${fmt(trend.factor)} × ${fmt(monthFactor)} × ${fmt(conservative)} = ${fmt(adjusted)}`,
  );

  lines.push(`⑥ 分层上下限夹取`);
  lines.push(`   · 下限 ${fmt(floor)}（与 d6=${fmt(d6)} 相关），上限 ${fmt(ceiling)}`);
  if (Math.abs(clamped - adjusted) <= 0.005) {
    lines.push(`   · 乘积落在区间内 → ${fmt(clamped)}`);
  } else if (clamped > adjusted + 0.005) {
    lines.push(`   · 低于下限，抬至 ${fmt(clamped)}`);
  } else {
    lines.push(`   · 超过上限，压至 ${fmt(clamped)}`);
  }

  if (horizonIndex <= 2) {
    lines.push('⑦ 近端处理（k≤2）');
    lines.push(`   · ${nearFloorNote ?? '无额外地板'}`);
  } else {
    lines.push('⑦ 近端处理：远月（k>2）不套近端地板');
  }

  if (peerFloor != null && Number.isFinite(peerFloor)) {
    lines.push('⑧ 跨平台近端抬底');
    lines.push(
      peerFloorApplied
        ? `   · 同 SKU 其他渠道动销抬底 → ${fmt(roundDaily(peerFloor))}`
        : `   · 抬底阈值 ${fmt(roundDaily(peerFloor))}，未高于当前结果`,
    );
  }

  const actual = roundDaily(actualForecastDailyAvg);
  if (Math.abs(actual - pipelineResult) > 0.005) {
    lines.push(`→ 系统 ${fmt(actual)}（以库内系统值为准；与逐步结果 ${fmt(pipelineResult)} 略有差异）`);
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
    seasonalDaily?: number | null;
    trendRatio: number;
    d6: number;
    d3: number;
    productCategory?: string;
    effectiveTrendDecay?: number;
    monthFactor?: number;
    conservativeFactor?: number;
    tierCeiling?: number;
    nearHorizonFloor?: number | null;
    peerPlatformFloor?: number | null;
    growthSignal?: boolean;
    rollingRatio?: number;
    aggregatedPlatformCount?: number;
    platformContributions?: V41PlatformContribution[];
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
      '【AI 辅助 · 系统列】',
      '本月系统值由 AI 辅助写入，不走下方 V4.1 逐步公式重算。',
      cell.aiAssistRationale,
      `→ 系统 ${fmt(cell.forecastDailyAvg)}`,
    ].join('\n');
  }

  if ((v41.aggregatedPlatformCount ?? 0) > 1) {
    return buildV41MultiPlatformSystemTitle({
      forecastDailyAvg: cell.forecastDailyAvg,
      levelDaily: v41.levelDaily,
      seasonalDaily: v41.seasonalDaily,
      platformCount: v41.aggregatedPlatformCount,
      platformContributions: v41.platformContributions,
    });
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

function buildV41MultiPlatformLevelTitle(input: {
  kind: 'baseline' | 'blend' | 'seasonal';
  value: number;
  platformCount?: number;
  platformContributions?: V41PlatformContribution[] | null;
}): string {
  const count = input.platformCount ?? input.platformContributions?.length ?? 0;
  const label =
    input.kind === 'seasonal' ? '季节朴素' : input.kind === 'baseline' ? '基线' : '混合水平';
  const lines = [
    `【全渠道合计 · ${label}】`,
    `口径：各渠道「${label}」日均求和（与系统列相同的合计方式）。`,
    count > 1 ? `参与渠道：${count}` : '参与渠道：多渠道',
    '',
  ];

  const contributions = input.platformContributions ?? [];
  for (const row of contributions) {
    const tierPart = row.tier ? `  ${row.tier}` : '';
    if (input.kind === 'seasonal') {
      lines.push(
        `${row.platform.padEnd(8)} 季节 ${fmt(row.seasonalDaily ?? 0)}${tierPart}`,
      );
    } else {
      const anchorPart =
        row.anchorDaily != null ? `  锚定 ${fmt(row.anchorDaily)}` : '';
      const seasonalPart =
        row.seasonalDaily != null ? `  季节 ${fmt(row.seasonalDaily)}` : '';
      lines.push(
        `${row.platform.padEnd(8)} 混合 ${fmt(row.levelDaily ?? 0)}${anchorPart}${seasonalPart}${tierPart}`,
      );
    }
  }
  if (contributions.length > 0) lines.push('────────');
  lines.push(`合计      ${label} ${fmt(input.value)}`);
  lines.push('');
  lines.push('切换筛选到单渠道后，可悬停查看该渠道逐步公式。');
  return lines.join('\n');
}

/** 季节朴素列悬停：算法说明（与 computeForwardSeasonalDaily 对齐） */
export function buildV41SeasonalTitle(input: {
  seasonalDaily: number;
  forecastMonth: number;
  horizonIndex: number;
  aggregatedPlatformCount?: number;
  platformContributions?: V41PlatformContribution[] | null;
  diagnosticOnly?: boolean;
}): string {
  if ((input.aggregatedPlatformCount ?? 0) > 1) {
    return buildV41MultiPlatformLevelTitle({
      kind: 'seasonal',
      value: input.seasonalDaily,
      platformCount: input.aggregatedPlatformCount,
      platformContributions: input.platformContributions,
    });
  }

  const k = Math.max(0, Math.floor(input.horizonIndex));
  const lines = [
    '【季节朴素日均 · 算法】',
    '① 取截止上月末的近 12 个自然月销量序列 Q[-11…0]',
    '② 季节朴素月销量 = 该序列中与目标月同日历位的值',
    `   · 地平线序号 k=${k} → 取训练窗第 (k mod 12) 位（近端取最近同月位）`,
    '   · 历史不足 12 月时退化为线性趋势外推月销量',
    `③ 折算日均 = 季节朴素月销量 ÷ ${input.forecastMonth} 月天数`,
    `→ 季节朴素 ${fmt(input.seasonalDaily)}`,
  ];
  if (input.diagnosticOnly) {
    lines.push('（T99 诊断参考，不计入系统点预测）');
  }
  return lines.join('\n');
}

/** 混合水平 / 基线列悬停：锚定与季节混合逐步计算 */
export function buildV41BlendLevelTitle(input: {
  kind: 'baseline' | 'blend';
  levelDaily: number;
  anchorDaily?: number | null;
  seasonalDaily?: number | null;
  horizonIndex: number;
  tier?: string | null;
  formula?: string | null;
  d6?: number | null;
  d3?: number | null;
  aggregatedPlatformCount?: number;
  platformContributions?: V41PlatformContribution[] | null;
  diagnosticOnly?: boolean;
}): string {
  if ((input.aggregatedPlatformCount ?? 0) > 1) {
    return buildV41MultiPlatformLevelTitle({
      kind: input.kind,
      value: input.levelDaily,
      platformCount: input.aggregatedPlatformCount,
      platformContributions: input.platformContributions,
    });
  }

  const k = Math.max(0, Math.floor(input.horizonIndex));
  const wSeason = v41SeasonBlendWeight(k);
  const wAnchor = 1 - wSeason;
  const title =
    input.kind === 'baseline' ? '【基线日均 · 逐步计算】' : '【混合水平 · 逐步计算】';
  const lines = [title];

  if (input.kind === 'baseline') {
    lines.push('说明：V4.1「基线」= 混合水平 levelDaily（套限幅前中间量，持久化为 baseline_daily_avg）。');
  }

  const anchor = input.anchorDaily;
  const seasonal = input.seasonalDaily;
  lines.push(
    `① 锚定日均 = ${anchor != null && Number.isFinite(anchor) ? fmt(anchor) : '—'}`,
  );
  if (input.formula?.trim()) {
    lines.push(`   · 分层加权：${input.formula.replace(/\*/g, '×')}`);
  } else if (input.tier) {
    lines.push(`   · 按 ${input.tier} 层对 d2/d3/d6/d12 加权（见基线因子区公式）`);
  }
  if (input.d6 != null && Number.isFinite(input.d6)) {
    const d3Part =
      input.d3 != null && Number.isFinite(input.d3) ? `，d3=${fmt(input.d3)}` : '';
    lines.push(`   · 走步特征 d6=${fmt(input.d6)}${d3Part}（触发时锚定，全周期一致）`);
  }

  lines.push(
    `② 季节朴素日均 = ${seasonal != null && Number.isFinite(seasonal) ? fmt(seasonal) : '—'}`,
  );
  lines.push('   · 近 12 月序列按目标月日历位取值后再 ÷ 当月天数（悬停「季节朴素」列可看细节）');

  lines.push(`③ 季节权重 w = min(0.62, 0.28 + k×0.07)`);
  lines.push(`   · k=${k} → w=${fmt(wSeason)}，锚定权重 (1−w)=${fmt(wAnchor)}`);
  lines.push('   · 近端偏锚定，远端偏季节（w 上限 0.62）');

  if (
    anchor != null &&
    seasonal != null &&
    Number.isFinite(anchor) &&
    Number.isFinite(seasonal) &&
    seasonal > 0 &&
    anchor > 0
  ) {
    const recomputed = roundDaily(anchor * wAnchor + seasonal * wSeason);
    lines.push('④ 混合水平 = 锚定×(1−w) + 季节朴素×w');
    lines.push(
      `   = ${fmt(anchor)} × ${fmt(wAnchor)} + ${fmt(seasonal)} × ${fmt(wSeason)} = ${fmt(recomputed)}`,
    );
    if (Math.abs(recomputed - input.levelDaily) > 0.005) {
      lines.push(`→ ${input.kind === 'baseline' ? '基线' : '混合水平'} ${fmt(input.levelDaily)}（以库内值为准）`);
    } else {
      lines.push(`→ ${input.kind === 'baseline' ? '基线' : '混合水平'} ${fmt(input.levelDaily)}`);
    }
  } else if (seasonal == null || seasonal <= 0) {
    lines.push('④ 季节朴素缺失或为 0 → 混合水平退化为锚定');
    lines.push(`→ ${input.kind === 'baseline' ? '基线' : '混合水平'} ${fmt(input.levelDaily)}`);
  } else if (anchor == null || anchor <= 0) {
    lines.push('④ 锚定缺失或为 0 → 混合水平退化为季节朴素');
    lines.push(`→ ${input.kind === 'baseline' ? '基线' : '混合水平'} ${fmt(input.levelDaily)}`);
  } else {
    lines.push('④ 混合水平 = 锚定×(1−w) + 季节朴素×w');
    lines.push(`→ ${input.kind === 'baseline' ? '基线' : '混合水平'} ${fmt(input.levelDaily)}`);
  }

  if (input.kind === 'blend') {
    lines.push('随后进入「系统」列：混合 × 趋势衰减 × 月折减 × 分层保守 → 套限幅。');
  } else {
    lines.push('与「混合水平」列同源；系统列在此基础上再套趋势/月折减/保守与上下限。');
  }
  if (input.diagnosticOnly) {
    lines.push('（T99 诊断参考，不计入系统点预测）');
  }
  return lines.join('\n');
}

/** 统一构建基线 / 季节 / 混合水平悬停文案 */
export function buildV41LevelCellTitle(input: {
  kind: 'baseline' | 'seasonal' | 'blend';
  cell: {
    baselineDailyAvg?: number | null;
    month: number;
  };
  v41: {
    levelDaily?: number | null;
    seasonalDaily?: number | null;
    anchorDaily?: number | null;
    formula?: string | null;
    d6?: number | null;
    d3?: number | null;
    aggregatedPlatformCount?: number;
    platformContributions?: V41PlatformContribution[];
  };
  monthIndex: number;
  tier?: string | null;
  diagnosticOnly?: boolean;
}): string | undefined {
  const { kind, v41, monthIndex } = input;

  if (kind === 'seasonal') {
    if (v41.seasonalDaily == null || !Number.isFinite(v41.seasonalDaily)) return undefined;
    return buildV41SeasonalTitle({
      seasonalDaily: v41.seasonalDaily,
      forecastMonth: input.cell.month,
      horizonIndex: monthIndex,
      aggregatedPlatformCount: v41.aggregatedPlatformCount,
      platformContributions: v41.platformContributions,
      diagnosticOnly: input.diagnosticOnly,
    });
  }

  const level =
    kind === 'baseline'
      ? (input.cell.baselineDailyAvg ?? v41.levelDaily)
      : v41.levelDaily;
  if (level == null || !Number.isFinite(level)) return undefined;

  return buildV41BlendLevelTitle({
    kind,
    levelDaily: level,
    anchorDaily: v41.anchorDaily,
    seasonalDaily: v41.seasonalDaily,
    horizonIndex: monthIndex,
    tier: input.tier,
    formula: v41.formula,
    d6: v41.d6,
    d3: v41.d3,
    aggregatedPlatformCount: v41.aggregatedPlatformCount,
    platformContributions: v41.platformContributions,
    diagnosticOnly: input.diagnosticOnly,
  });
}
