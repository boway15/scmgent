/**
 * 影子落地 → 重塑 → 地平线衰减之后，再套一道近端乐观帽。
 * 默认按「当月影子 shadowDaily」相对限幅，避免各月被同一 recent/d6 绝对顶削平季节落差。
 */
import { eq } from 'drizzle-orm';
import { db, salesForecastMonthly } from '@scm/db';
import { buildHorizonIndexByMonthKey } from './forecast-seasonal-dampen.js';

/** 压近端三月（horizonIndex 0/1/2，避免 11/12 压平后把过冲挤到次月） */
export const POST_LANDING_MAX_HORIZON = 2;
/** 相对当月影子的抬升上限 */
export const POST_LANDING_SHADOW_UPLIFT = 1.16;
/** 无影子时回退：相对 recent/d6 的绝对顶 */
export const POST_LANDING_RUNRATE_UPLIFT = 1.1;
/** 有影子时 run-rate 第二顶 */
export const POST_LANDING_SHADOW_RUNRATE_UPLIFT = 1.32;
export const POST_LANDING_MIN_RECENT30 = 3;
/** 次通道弱开局：相对影子（或 recent30）×1.0 */
export const POST_LANDING_SECONDARY_RECENT30_MAX = 5;
export const POST_LANDING_SECONDARY_UPLIFT = 1.0;
export const POST_LANDING_SECONDARY_FLOOR = 0.5;

function nonNegative(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function roundDaily(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function unwrapFactors(value: unknown): Record<string, unknown> | null {
  let current = value;
  if (typeof current === 'string') {
    try {
      current = JSON.parse(current) as unknown;
    } catch {
      return null;
    }
  }
  if (!current || typeof current !== 'object') return null;
  return current as Record<string, unknown>;
}

function readShadowDaily(factors: Record<string, unknown>): number | null {
  const seasonal = factors.seasonalIndex;
  if (!seasonal || typeof seasonal !== 'object') return null;
  const daily = Number((seasonal as { shadowDaily?: unknown }).shadowDaily);
  return Number.isFinite(daily) && daily > 0 ? daily : null;
}

/**
 * 近端帽：优先 min(预测, 当月影子×1.10)；无影子时回退 max(recent30,d6)×1.10。
 */
export function applyPostLandingNearRunRateCap(input: {
  forecastDaily: number;
  horizonIndex: number;
  recent30DailyAvg?: number | null;
  d6?: number | null;
  shadowDaily?: number | null;
}): number {
  if (!(input.forecastDaily > 0)) return input.forecastDaily;
  const k = Math.max(0, Math.floor(input.horizonIndex));
  if (k > POST_LANDING_MAX_HORIZON) return input.forecastDaily;

  const recent30 = nonNegative(input.recent30DailyAvg);
  const d6 = nonNegative(input.d6);
  const runrate = Math.max(recent30, d6);
  const shadow = nonNegative(input.shadowDaily);
  if (shadow > 0) {
    let cap = shadow * POST_LANDING_SHADOW_UPLIFT;
    if (runrate >= POST_LANDING_MIN_RECENT30) {
      cap = Math.min(cap, runrate * POST_LANDING_SHADOW_RUNRATE_UPLIFT);
    }
    return roundDaily(Math.min(input.forecastDaily, cap));
  }

  if (recent30 < POST_LANDING_MIN_RECENT30) return input.forecastDaily;
  const cap = runrate * POST_LANDING_RUNRATE_UPLIFT;
  return roundDaily(Math.min(input.forecastDaily, cap));
}

/**
 * 次通道弱开局帽：基准取 min(shadow, recent30)（有影子时），禁止 shadow-alone 把崩塌渠道抬高。
 */
export function applyPostLandingSecondaryChannelCap(input: {
  forecastDaily: number;
  platform?: string | null;
  recent30DailyAvg?: number | null;
  shadowDaily?: number | null;
}): number {
  if (!(input.forecastDaily > 0)) return input.forecastDaily;
  const platform = (input.platform ?? '').trim().toUpperCase();
  if (!platform || platform === 'AMAZON' || platform === 'ALL' || platform === 'UNKNOWN') {
    return input.forecastDaily;
  }
  const recent30 = nonNegative(input.recent30DailyAvg);
  if (recent30 >= POST_LANDING_SECONDARY_RECENT30_MAX) return input.forecastDaily;
  const shadow = nonNegative(input.shadowDaily);
  const recentBase = Math.max(recent30, POST_LANDING_SECONDARY_FLOOR);
  const base = shadow > 0 ? Math.min(shadow, recentBase) : recentBase;
  const cap = Math.max(base, POST_LANDING_SECONDARY_FLOOR) * POST_LANDING_SECONDARY_UPLIFT;
  return roundDaily(Math.min(input.forecastDaily, cap));
}

/** 落地后再帽组合 */
export function applyPostLandingOptimismCaps(input: {
  forecastDaily: number;
  platform?: string | null;
  horizonIndex: number;
  recent30DailyAvg?: number | null;
  d6?: number | null;
  shadowDaily?: number | null;
}): {
  forecastDaily: number;
  nearRunRateCap: number | null;
  secondaryChannelCap: number | null;
  capMode: 'shadow_relative' | 'runrate_absolute' | 'none';
} {
  const before = input.forecastDaily;
  const shadow = nonNegative(input.shadowDaily);
  let forecastDaily = applyPostLandingNearRunRateCap(input);
  const afterNear = forecastDaily;
  forecastDaily = applyPostLandingSecondaryChannelCap({
    forecastDaily,
    platform: input.platform,
    recent30DailyAvg: input.recent30DailyAvg,
    shadowDaily: input.shadowDaily,
  });
  const nearApplied = afterNear + 1e-9 < before;
  return {
    forecastDaily,
    nearRunRateCap: nearApplied ? afterNear : null,
    secondaryChannelCap: forecastDaily + 1e-9 < afterNear ? forecastDaily : null,
    capMode: nearApplied
      ? shadow > 0
        ? 'shadow_relative'
        : 'runrate_absolute'
      : 'none',
  };
}

export async function applyOptimismDampAfterLanding(input: {
  versionId: string;
}): Promise<{ changedRows: number; scannedRows: number }> {
  const rows = await db
    .select({
      id: salesForecastMonthly.id,
      year: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      platform: salesForecastMonthly.platform,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      forecastDailyP10: salesForecastMonthly.forecastDailyP10,
      forecastDailyP90: salesForecastMonthly.forecastDailyP90,
      horizonFactors: salesForecastMonthly.horizonFactors,
    })
    .from(salesForecastMonthly)
    .where(eq(salesForecastMonthly.versionId, input.versionId));

  const horizonByMonth = buildHorizonIndexByMonthKey(
    rows.map((row) => ({ year: row.year, month: row.month })),
  );

  let changedRows = 0;
  for (const row of rows) {
    const horizonIndex = horizonByMonth.get(monthKey(row.year, row.month)) ?? 0;
    if (horizonIndex > POST_LANDING_MAX_HORIZON) continue;

    const factors = unwrapFactors(row.horizonFactors) ?? {};
    const priorCap = factors.postLandingOptimismCap;
    const priorBefore =
      priorCap && typeof priorCap === 'object'
        ? Number((priorCap as { beforeDaily?: unknown }).beforeDaily)
        : NaN;
    // 若曾被旧绝对顶压过，先恢复帽前值再按新规则限幅
    const currentStored = Number(row.forecastDailyAvg);
    const baseDaily =
      Number.isFinite(priorBefore) && priorBefore > 0 ? priorBefore : currentStored;
    if (!(baseDaily > 0)) continue;

    const recent30 = Number(factors.recent30DailyAvg);
    const d6 = Number(factors.d6);
    const shadowDaily = readShadowDaily(factors);
    const capped = applyPostLandingOptimismCaps({
      forecastDaily: baseDaily,
      platform: row.platform,
      horizonIndex,
      recent30DailyAvg: Number.isFinite(recent30) ? recent30 : null,
      d6: Number.isFinite(d6) ? d6 : null,
      shadowDaily,
    });
    if (Math.abs(capped.forecastDaily - currentStored) < 0.005) continue;

    const nextFactors = { ...factors } as Record<string, unknown>;
    nextFactors.postLandingOptimismCap = {
      beforeDaily: roundDaily(baseDaily),
      afterDaily: capped.forecastDaily,
      nearRunRateCap: capped.nearRunRateCap,
      secondaryChannelCap: capped.secondaryChannelCap,
      uplift: POST_LANDING_SHADOW_UPLIFT,
      horizonIndex,
      capMode: capped.capMode,
      shadowDaily: shadowDaily != null ? roundDaily(shadowDaily) : null,
    };

    const scale =
      currentStored > 0 ? capped.forecastDaily / currentStored : 1;
    const p10 = Number(row.forecastDailyP10);
    const p90 = Number(row.forecastDailyP90);
    await db
      .update(salesForecastMonthly)
      .set({
        forecastDailyAvg: String(capped.forecastDaily),
        forecastDailyP10:
          Number.isFinite(p10) && p10 > 0 ? String(roundDaily(p10 * scale)) : row.forecastDailyP10,
        forecastDailyP90:
          Number.isFinite(p90) && p90 > 0 ? String(roundDaily(p90 * scale)) : row.forecastDailyP90,
        horizonFactors: nextFactors,
        updatedAt: new Date(),
      })
      .where(eq(salesForecastMonthly.id, row.id));
    changedRows += 1;
  }

  return { changedRows, scannedRows: rows.length };
}
