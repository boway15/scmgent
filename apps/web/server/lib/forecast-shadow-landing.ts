/**
 * 影子季节指数落地全流程（生成后 / 手工脚本共用）：
 * 1) 满幅 shadowDaily → forecast_daily_avg（保留 baseDailyBeforeShadow）
 * 2) 站点 SI 组合重塑
 * 3) 地平线衰减（旺季月满幅）
 * 4) 落地后再帽（近端 run-rate / 次通道）
 */
import { eq } from 'drizzle-orm';
import { db, salesForecastMonthly } from '@scm/db';
import {
  blendShadowWithHorizonDecay,
  buildHorizonIndexByMonthKey,
  loadSeasonalDampenFromCalibration,
} from './forecast-seasonal-dampen.js';
import { applyOptimismDampAfterLanding } from './forecast-optimism-post-landing.js';
import {
  applyStationSiPortfolioReshape,
  shouldRunSiReshapeAfterGenerate,
} from './forecast-si-reshape.js';
import {
  resolveSeasonalIndexMode,
  type SeasonalIndexMode,
} from './forecast-profile-config.js';

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

function shadowDaily(factors: Record<string, unknown> | null): number | null {
  const seasonal = factors?.seasonalIndex;
  if (!seasonal || typeof seasonal !== 'object') return null;
  const daily = (seasonal as { shadowDaily?: unknown }).shadowDaily;
  return typeof daily === 'number' && Number.isFinite(daily) ? daily : null;
}

function roundDaily(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** mode=shadow 时生成后自动跑全流程（影子仍在 factors，系统日均为 V4.1） */
export function shouldRunShadowLandingAfterGenerate(
  mode?: SeasonalIndexMode | null,
): boolean {
  const resolved = mode ?? resolveSeasonalIndexMode();
  return resolved === 'shadow' && shouldRunSiReshapeAfterGenerate(resolved);
}

export async function promoteForecastFromShadowDaily(
  versionId: string,
  minDiff = 0.05,
): Promise<number> {
  const rows = await db
    .select({
      id: salesForecastMonthly.id,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      horizonFactors: salesForecastMonthly.horizonFactors,
    })
    .from(salesForecastMonthly)
    .where(eq(salesForecastMonthly.versionId, versionId));

  let changed = 0;
  for (const row of rows) {
    const factors = unwrapFactors(row.horizonFactors);
    const shadow = shadowDaily(factors);
    if (shadow == null) continue;
    const current = Number(row.forecastDailyAvg);
    const next = roundDaily(shadow);
    const differs =
      current > 0 ? Math.abs(next - current) / current > minDiff : next > 0;
    if (!differs) continue;

    const nextFactors = { ...(factors ?? {}) } as Record<string, unknown>;
    const seasonal =
      nextFactors.seasonalIndex && typeof nextFactors.seasonalIndex === 'object'
        ? { ...(nextFactors.seasonalIndex as Record<string, unknown>) }
        : {};
    seasonal.baseDailyBeforeShadow = roundDaily(current);
    nextFactors.seasonalIndex = seasonal;

    await db
      .update(salesForecastMonthly)
      .set({
        forecastDailyAvg: String(next),
        horizonFactors: nextFactors,
        updatedAt: new Date(),
      })
      .where(eq(salesForecastMonthly.id, row.id));
    changed += 1;
  }
  return changed;
}

export async function applyHorizonDecayAfterReshape(versionId: string): Promise<number> {
  const rows = await db
    .select({
      id: salesForecastMonthly.id,
      year: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      horizonFactors: salesForecastMonthly.horizonFactors,
    })
    .from(salesForecastMonthly)
    .where(eq(salesForecastMonthly.versionId, versionId));

  const horizonByMonth = buildHorizonIndexByMonthKey(
    rows.map((row) => ({ year: row.year, month: row.month })),
  );
  const { shadowDecay } = loadSeasonalDampenFromCalibration();

  let changed = 0;
  for (const row of rows) {
    const factors = unwrapFactors(row.horizonFactors);
    const seasonal =
      factors?.seasonalIndex && typeof factors.seasonalIndex === 'object'
        ? (factors.seasonalIndex as Record<string, unknown>)
        : null;
    if (!seasonal) continue;
    const base = Number(seasonal.baseDailyBeforeShadow);
    if (!(base > 0)) continue;
    const current = Number(row.forecastDailyAvg);
    if (!(current > 0)) continue;
    const horizonIndex = horizonByMonth.get(monthKey(row.year, row.month)) ?? 0;
    const blended = blendShadowWithHorizonDecay(base, current, horizonIndex, shadowDecay, {
      calendarMonth: row.month,
    });
    const next = roundDaily(blended);
    if (Math.abs(next - current) < 0.005) continue;
    await db
      .update(salesForecastMonthly)
      .set({
        forecastDailyAvg: String(next),
        updatedAt: new Date(),
      })
      .where(eq(salesForecastMonthly.id, row.id));
    changed += 1;
  }
  return changed;
}

export type ShadowLandingPipelineResult = {
  promotedRows: number;
  reshapeGroups: number;
  reshapeRows: number;
  reshapeAsOf: string | null;
  decayedRows: number;
  postLandingChanged: number;
  postLandingScanned: number;
};

/**
 * 影子落地全流程。mode=shadow 的生成后默认入口。
 */
export async function applyShadowLandingPipeline(input: {
  versionId: string;
  startMonth?: string | null;
  historyCapEnd?: Date;
  minDiff?: number;
  skipPostLandingCap?: boolean;
}): Promise<ShadowLandingPipelineResult> {
  const minDiff = input.minDiff ?? 0.05;
  const promotedRows = await promoteForecastFromShadowDaily(input.versionId, minDiff);

  const reshape = await applyStationSiPortfolioReshape({
    versionId: input.versionId,
    startMonth: input.startMonth ?? undefined,
    historyCapEnd: input.historyCapEnd,
  });

  const decayedRows = await applyHorizonDecayAfterReshape(input.versionId);

  let postLandingChanged = 0;
  let postLandingScanned = 0;
  if (!input.skipPostLandingCap) {
    const post = await applyOptimismDampAfterLanding({ versionId: input.versionId });
    postLandingChanged = post.changedRows;
    postLandingScanned = post.scannedRows;
  }

  console.info(
    `[forecast] shadow landing version=${input.versionId} promote=${promotedRows} reshapeGroups=${reshape.groupsTouched} reshapeRows=${reshape.changedRows} decay=${decayedRows} postCap=${postLandingChanged}`,
  );

  return {
    promotedRows,
    reshapeGroups: reshape.groupsTouched,
    reshapeRows: reshape.changedRows,
    reshapeAsOf: reshape.asOfMonth,
    decayedRows,
    postLandingChanged,
    postLandingScanned,
  };
}
