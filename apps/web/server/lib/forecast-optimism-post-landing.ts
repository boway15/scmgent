/**
 * 影子落地 → 重塑 → 地平线衰减之后，再套一道近端乐观帽。
 * 解决「生成时已帽、落地满幅影子/旺季重塑又抬回去」的问题。
 */
import { eq } from 'drizzle-orm';
import { db, salesForecastMonthly } from '@scm/db';
import { buildHorizonIndexByMonthKey } from './forecast-seasonal-dampen.js';

/** 仅压近端两月（horizonIndex 0/1，含 11 月） */
export const POST_LANDING_MAX_HORIZON = 1;
/** 落地后再帽统一抬升上限（旺季也不放宽到 1.25） */
export const POST_LANDING_RUNRATE_UPLIFT = 1.1;
export const POST_LANDING_MIN_RECENT30 = 3;
/** 次通道弱开局：落地后不允许高于 recent30（×1.0） */
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

export function applyPostLandingNearRunRateCap(input: {
  forecastDaily: number;
  horizonIndex: number;
  recent30DailyAvg?: number | null;
  d6?: number | null;
}): number {
  if (!(input.forecastDaily > 0)) return input.forecastDaily;
  const k = Math.max(0, Math.floor(input.horizonIndex));
  if (k > POST_LANDING_MAX_HORIZON) return input.forecastDaily;
  const recent30 = nonNegative(input.recent30DailyAvg);
  if (recent30 < POST_LANDING_MIN_RECENT30) return input.forecastDaily;
  const d6 = nonNegative(input.d6);
  const cap = Math.max(recent30, d6) * POST_LANDING_RUNRATE_UPLIFT;
  return roundDaily(Math.min(input.forecastDaily, cap));
}

export function applyPostLandingSecondaryChannelCap(input: {
  forecastDaily: number;
  platform?: string | null;
  recent30DailyAvg?: number | null;
}): number {
  if (!(input.forecastDaily > 0)) return input.forecastDaily;
  const platform = (input.platform ?? '').trim().toUpperCase();
  if (!platform || platform === 'AMAZON' || platform === 'ALL' || platform === 'UNKNOWN') {
    return input.forecastDaily;
  }
  const recent30 = nonNegative(input.recent30DailyAvg);
  if (recent30 >= POST_LANDING_SECONDARY_RECENT30_MAX) return input.forecastDaily;
  const cap = Math.max(recent30, POST_LANDING_SECONDARY_FLOOR) * POST_LANDING_SECONDARY_UPLIFT;
  return roundDaily(Math.min(input.forecastDaily, cap));
}

/** 落地后再帽组合 */
export function applyPostLandingOptimismCaps(input: {
  forecastDaily: number;
  platform?: string | null;
  horizonIndex: number;
  recent30DailyAvg?: number | null;
  d6?: number | null;
}): {
  forecastDaily: number;
  nearRunRateCap: number | null;
  secondaryChannelCap: number | null;
} {
  const before = input.forecastDaily;
  let forecastDaily = applyPostLandingNearRunRateCap(input);
  const afterNear = forecastDaily;
  forecastDaily = applyPostLandingSecondaryChannelCap({
    forecastDaily,
    platform: input.platform,
    recent30DailyAvg: input.recent30DailyAvg,
  });
  return {
    forecastDaily,
    nearRunRateCap: afterNear + 1e-9 < before ? afterNear : null,
    secondaryChannelCap: forecastDaily + 1e-9 < afterNear ? forecastDaily : null,
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
      horizonFactors: salesForecastMonthly.horizonFactors,
    })
    .from(salesForecastMonthly)
    .where(eq(salesForecastMonthly.versionId, input.versionId));

  const horizonByMonth = buildHorizonIndexByMonthKey(
    rows.map((row) => ({ year: row.year, month: row.month })),
  );

  let changedRows = 0;
  for (const row of rows) {
    const current = Number(row.forecastDailyAvg);
    if (!(current > 0)) continue;
    const horizonIndex = horizonByMonth.get(monthKey(row.year, row.month)) ?? 0;
    if (horizonIndex > POST_LANDING_MAX_HORIZON) continue;

    const factors = unwrapFactors(row.horizonFactors) ?? {};
    const recent30 = Number(factors.recent30DailyAvg);
    const d6 = Number(factors.d6);
    const capped = applyPostLandingOptimismCaps({
      forecastDaily: current,
      platform: row.platform,
      horizonIndex,
      recent30DailyAvg: Number.isFinite(recent30) ? recent30 : null,
      d6: Number.isFinite(d6) ? d6 : null,
    });
    if (Math.abs(capped.forecastDaily - current) < 0.005) continue;

    const nextFactors = { ...factors } as Record<string, unknown>;
    nextFactors.postLandingOptimismCap = {
      beforeDaily: roundDaily(current),
      afterDaily: capped.forecastDaily,
      nearRunRateCap: capped.nearRunRateCap,
      secondaryChannelCap: capped.secondaryChannelCap,
      uplift: POST_LANDING_RUNRATE_UPLIFT,
      horizonIndex,
    };

    await db
      .update(salesForecastMonthly)
      .set({
        forecastDailyAvg: String(capped.forecastDaily),
        horizonFactors: nextFactors,
        updatedAt: new Date(),
      })
      .where(eq(salesForecastMonthly.id, row.id));
    changedRows += 1;
  }

  return { changedRows, scannedRows: rows.length };
}
