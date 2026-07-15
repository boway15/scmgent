/**
 * A·主力算法标定：真 recent30/90 特征 + 网格重算 computeAClassForecast
 */
import { eq, inArray } from 'drizzle-orm';
import { db, skus, warehouses } from '@scm/db';
import type { AccuracyRowInput } from './forecast-accuracy-tier.js';
import { computeWeightedMape } from './forecast-accuracy-tier.js';
import {
  applyACoreUpperBound,
  classifySalesLifecycle,
  computeAClassForecast,
  computeYoyAnchorDailyAvg,
  effectiveRecentWindowEnd,
  resolveEffectiveLastYearDailyAvg,
  roundDaily,
  type SalesLifecycle,
} from './forecast-baseline.js';
import { filterSalesRowsByStation } from './forecast-collaboration.js';
import { normalizeSalesPlatform, stationForWarehouse } from './forecast-demand.js';
import { horizonMonthIndex } from './forecast-horizon-band.js';
import type { ACoreAlgoConfig } from './forecast-profile-config.js';
import { DEFAULT_ACORE_ALGO_CONFIG } from './forecast-profile-config.js';
import { buildLast12MonthlyQty } from './forecast-profile-snapshot.js';
import { FORECAST_REGRESSION_SKUS, isRegressionSku } from './forecast-regression-skus.js';
import {
  loadDailySalesBySkuIdsInRange,
  loadMonthlySalesBySkuIds,
} from './sales-history-query.js';
import { DEFAULT_MONTHLY_HISTORY_LOOKBACK_MONTHS } from './sales-history-monthly.js';

export type ACoreSkuContext = {
  skuCode: string;
  skuId: string;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  lifecycle: SalesLifecycle;
  monthlyRows: Array<{ saleYear: number; month: number; qtySold: number }>;
  dailyRows: Array<{ saleDate: string; qtySold: number }>;
  yoyAnchorDailyAvg: number;
  structuralLevel: number;
};

export type ACoreCalibrationScore = {
  config: ACoreAlgoConfig;
  precisionWmape: number | null;
  flexWmape: number | null;
  regressionPrecisionWmape: number | null;
};

export type ACoreCalibrationGrid = {
  k0Recent30Weight: number[];
  k1Recent30Weight: number[];
  upperHeadroomK0: number[];
  declineRecent30Ratio: number[];
};

export const DEFAULT_ACORE_CALIBRATION_GRID: ACoreCalibrationGrid = {
  k0Recent30Weight: [0.65, 0.7, 0.75],
  k1Recent30Weight: [0.5, 0.55, 0.6],
  upperHeadroomK0: [1.04, 1.06, 1.08, 1.1],
  declineRecent30Ratio: [0.8, 0.85, 0.9],
};

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sumQtySince(rows: Array<{ saleDate: string; qtySold: number }>, since: Date): number {
  const sinceKey = toDateOnly(since);
  return rows.reduce((sum, row) => {
    return String(row.saleDate).slice(0, 10) >= sinceKey ? sum + Number(row.qtySold) : sum;
  }, 0);
}

function countSalesDaysSince(rows: Array<{ saleDate: string; qtySold: number }>, since: Date): number {
  const sinceKey = toDateOnly(since);
  const days = new Set<string>();
  for (const row of rows) {
    const saleDate = String(row.saleDate).slice(0, 10);
    if (saleDate >= sinceKey && Number(row.qtySold) > 0) {
      days.add(saleDate);
    }
  }
  return days.size;
}

function computeMaxZeroRunDays(
  rows: Array<{ saleDate: string; qtySold: number }>,
  start: Date,
  end: Date,
): number {
  const qtyByDate = new Map(rows.map((row) => [String(row.saleDate).slice(0, 10), Number(row.qtySold)]));
  let maxRun = 0;
  let currentRun = 0;
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const qty = qtyByDate.get(toDateOnly(cursor)) ?? 0;
    if (qty <= 0) {
      currentRun++;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  return maxRun;
}

async function loadWarehouseStationMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({
      code: warehouses.code,
      regionGroup: warehouses.regionGroup,
      countryCode: warehouses.countryCode,
    })
    .from(warehouses)
    .where(eq(warehouses.isActive, true));

  return new Map(
    rows.map((row) => [
      row.code,
      stationForWarehouse(row.regionGroup, row.countryCode).toUpperCase(),
    ]),
  );
}

export function buildACoreAlgoConfigFromGrid(input: {
  k0Recent30Weight: number;
  k1Recent30Weight: number;
  upperHeadroomK0: number;
  declineRecent30Ratio: number;
}): ACoreAlgoConfig {
  const base = DEFAULT_ACORE_ALGO_CONFIG.upperHeadroom;
  const delta = input.upperHeadroomK0 - base[0]!;
  const upperHeadroom = base.map((v) => Math.round((v + delta) * 10000) / 10000);
  return {
    k0Recent30Weight: input.k0Recent30Weight,
    k1Recent30Weight: input.k1Recent30Weight,
    upperHeadroom,
    declineRecent30Ratio: input.declineRecent30Ratio,
  };
}

export function expandACoreCalibrationGrid(
  grid: ACoreCalibrationGrid = DEFAULT_ACORE_CALIBRATION_GRID,
): ACoreAlgoConfig[] {
  const configs: ACoreAlgoConfig[] = [];
  for (const k0 of grid.k0Recent30Weight) {
    for (const k1 of grid.k1Recent30Weight) {
      for (const head of grid.upperHeadroomK0) {
        for (const decline of grid.declineRecent30Ratio) {
          configs.push(
            buildACoreAlgoConfigFromGrid({
              k0Recent30Weight: k0,
              k1Recent30Weight: k1,
              upperHeadroomK0: head,
              declineRecent30Ratio: decline,
            }),
          );
        }
      }
    }
  }
  return configs;
}

export function simulateACoreForecastForRow(input: {
  row: AccuracyRowInput;
  ctx: ACoreSkuContext;
  asOf: Date;
  config: ACoreAlgoConfig;
  seasonalityFactor?: number;
  trendFactor?: number;
}): number | null {
  const horizonIndex = horizonMonthIndex(
    input.row.forecastYear ?? 2026,
    input.row.month ?? 1,
    input.asOf,
  );
  if (horizonIndex > 5) return null;

  const lastYearSameMonthDailyAvg = resolveEffectiveLastYearDailyAvg({
    dailyRows: input.ctx.dailyRows,
    monthlyRows: input.ctx.monthlyRows,
    forecastYear: input.row.forecastYear ?? 2026,
    month: input.row.month ?? 1,
  });

  const seasonality = input.seasonalityFactor ?? 1;
  const trend = input.trendFactor ?? 1;
  const raw = computeAClassForecast({
    recent30DailyAvg: input.ctx.recent30DailyAvg,
    recent90DailyAvg: input.ctx.recent90DailyAvg,
    lastYearSameMonthDailyAvg,
    yoyAnchorDailyAvg: input.ctx.yoyAnchorDailyAvg,
    horizonMonthIndex: horizonIndex,
    seasonalityFactor: seasonality,
    trendFactor: trend,
    structuralLevel: input.ctx.structuralLevel,
    wNear: 0.5,
    wYoy: 0.5,
    aCoreConfig: input.config,
  });
  if (raw == null) return null;

  return applyACoreUpperBound({
    forecastDailyAvg: raw,
    recent30DailyAvg: input.ctx.recent30DailyAvg,
    recent90DailyAvg: input.ctx.recent90DailyAvg,
    horizonMonthIndex: horizonIndex,
    lifecycle: input.ctx.lifecycle,
    aCoreConfig: input.config,
  });
}

export function scoreACoreCalibration(input: {
  rows: AccuracyRowInput[];
  contextsBySku: Map<string, ACoreSkuContext>;
  asOf: Date;
  config: ACoreAlgoConfig;
  segmentFilter?: (row: AccuracyRowInput) => boolean;
}): ACoreCalibrationScore {
  const eligible = input.rows.filter(
    (r) =>
      (input.segmentFilter ? input.segmentFilter(r) : r.profileSegment === 'A:core') &&
      input.contextsBySku.has(r.skuCode.toUpperCase()),
  );

  const simulated: AccuracyRowInput[] = eligible.map((row) => {
    const ctx = input.contextsBySku.get(row.skuCode.toUpperCase())!;
    const forecastDaily =
      simulateACoreForecastForRow({
        row,
        ctx,
        asOf: input.asOf,
        config: input.config,
      }) ?? row.forecastDaily;
    return { ...row, forecastDaily };
  });

  const precisionRows = simulated.filter((r) => {
    const k = horizonMonthIndex(r.forecastYear ?? 2026, r.month ?? 1, input.asOf);
    return k >= 0 && k <= 2;
  });
  const flexRows = simulated.filter((r) => {
    const k = horizonMonthIndex(r.forecastYear ?? 2026, r.month ?? 1, input.asOf);
    return k >= 3 && k <= 5;
  });
  const regressionRows = precisionRows.filter((r) => isRegressionSku(r.skuCode));

  return {
    config: input.config,
    precisionWmape: computeWeightedMape(precisionRows),
    flexWmape: computeWeightedMape(flexRows),
    regressionPrecisionWmape: computeWeightedMape(regressionRows),
  };
}

export function meetsACoreCalibrationConstraints(
  score: ACoreCalibrationScore,
  opts?: { maxFlexWmape?: number; maxRegressionPrecisionWmape?: number },
): boolean {
  const maxFlex = opts?.maxFlexWmape ?? 0.25;
  const maxRegression = opts?.maxRegressionPrecisionWmape ?? 0.3;
  if (score.flexWmape != null && score.flexWmape > maxFlex) return false;
  if (
    score.regressionPrecisionWmape != null &&
    score.regressionPrecisionWmape > maxRegression
  ) {
    return false;
  }
  return true;
}

export function rankACoreCalibrationScores(
  scores: ACoreCalibrationScore[],
  opts?: { maxFlexWmape?: number; maxRegressionPrecisionWmape?: number },
): ACoreCalibrationScore[] {
  const feasible = scores.filter((s) => meetsACoreCalibrationConstraints(s, opts));
  const pool = feasible.length > 0 ? feasible : scores;
  return [...pool].sort((a, b) => {
    const aw = a.precisionWmape ?? Number.POSITIVE_INFINITY;
    const bw = b.precisionWmape ?? Number.POSITIVE_INFINITY;
    return aw - bw;
  });
}

export async function buildACoreCalibrationContextCache(input: {
  asOf: Date;
  station: string;
  platform: string;
  skuCodes: string[];
}): Promise<Map<string, ACoreSkuContext>> {
  const platform = normalizeSalesPlatform(input.platform);
  const station = input.station.trim().toUpperCase();
  const codes = [...new Set(input.skuCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (!codes.length) return new Map();

  const skuRows = await db
    .select({ id: skus.id, code: skus.code })
    .from(skus)
    .where(inArray(skus.code, codes));

  const warehouseStationByCode = await loadWarehouseStationMap();
  const recentWindowEnd = effectiveRecentWindowEnd(input.asOf);
  const recent30Since = addDays(recentWindowEnd, -29);
  const recent90Since = addDays(recentWindowEnd, -89);
  const lookbackStart = addDays(recentWindowEnd, -DEFAULT_MONTHLY_HISTORY_LOOKBACK_MONTHS * 31);
  const skuIds = skuRows.map((r) => r.id);

  const monthlyBySku = await loadMonthlySalesBySkuIds({
    skuIds,
    platform,
    minYear: lookbackStart.getUTCFullYear(),
    minMonth: lookbackStart.getUTCMonth() + 1,
    maxYear: recentWindowEnd.getUTCFullYear(),
    maxMonth: recentWindowEnd.getUTCMonth() + 1,
  });

  const dailyBySku = await loadDailySalesBySkuIdsInRange({
    skuIds,
    platform,
    fromDate: addDays(recentWindowEnd, -400).toISOString().slice(0, 10),
    toDate: recentWindowEnd.toISOString().slice(0, 10),
  });

  const cache = new Map<string, ACoreSkuContext>();
  for (const sku of skuRows) {
    const rawDaily = dailyBySku.get(sku.id) ?? [];
    const salesRows = filterSalesRowsByStation(rawDaily, station, warehouseStationByCode);
    const monthlyRows = monthlyBySku.get(sku.id) ?? [];
    const monthlyQty = buildLast12MonthlyQty(monthlyRows, recentWindowEnd);
    const recent30DailyAvg = roundDaily(sumQtySince(salesRows, recent30Since) / 30);
    const recent90DailyAvg = roundDaily(sumQtySince(salesRows, recent90Since) / 90);
    const salesDays90 = countSalesDaysSince(salesRows, recent90Since);
    const maxZeroRunDays = computeMaxZeroRunDays(salesRows, recent90Since, recentWindowEnd);
    const lifecycle = classifySalesLifecycle({
      ageDays: 365,
      salesDayRatio90: salesDays90 / 90,
      recent30DailyAvg,
      recent90DailyAvg,
      maxZeroRunDays,
    });
    const yoyAnchorDailyAvg = computeYoyAnchorDailyAvg(
      monthlyRows,
      recentWindowEnd.getUTCFullYear(),
      recentWindowEnd.getUTCMonth() + 1,
    );
    const structuralLevel = roundDaily(
      recent90DailyAvg > 0 ? recent90DailyAvg : recent30DailyAvg,
    );

    cache.set(sku.code.toUpperCase(), {
      skuCode: sku.code,
      skuId: sku.id,
      recent30DailyAvg,
      recent90DailyAvg,
      lifecycle,
      monthlyRows,
      dailyRows: salesRows,
      yoyAnchorDailyAvg,
      structuralLevel,
    });
  }

  return cache;
}

export function formatACoreScoreLine(score: ACoreCalibrationScore, rank: number): string {
  const p =
    score.precisionWmape != null ? `${(score.precisionWmape * 100).toFixed(1)}%` : '—';
  const r =
    score.regressionPrecisionWmape != null
      ? `${(score.regressionPrecisionWmape * 100).toFixed(1)}%`
      : '—';
  return [
    `#${rank}`,
    `precision=${p}`,
    `regression=${r}`,
    `k0=${score.config.k0Recent30Weight}`,
    `k1=${score.config.k1Recent30Weight}`,
    `head0=${score.config.upperHeadroom[0]}`,
    `decline=${score.config.declineRecent30Ratio}`,
  ].join(' · ');
}

export function regressionSkuDetailRows(input: {
  rows: AccuracyRowInput[];
  contextsBySku: Map<string, ACoreSkuContext>;
  asOf: Date;
  config: ACoreAlgoConfig;
}): Array<{
  skuCode: string;
  month: string;
  actualDaily: number;
  forecastDaily: number;
  ratio: number | null;
}> {
  const out: Array<{
    skuCode: string;
    month: string;
    actualDaily: number;
    forecastDaily: number;
    ratio: number | null;
  }> = [];

  for (const row of input.rows) {
    if (!isRegressionSku(row.skuCode)) continue;
    const ctx = input.contextsBySku.get(row.skuCode.toUpperCase());
    if (!ctx) continue;
    const forecastDaily =
      simulateACoreForecastForRow({
        row,
        ctx,
        asOf: input.asOf,
        config: input.config,
      }) ?? row.forecastDaily;
    const ratio = row.actualDaily > 0 ? forecastDaily / row.actualDaily : null;
    out.push({
      skuCode: row.skuCode,
      month: `${row.forecastYear}-${String(row.month).padStart(2, '0')}`,
      actualDaily: row.actualDaily,
      forecastDaily,
      ratio,
    });
  }
  return out;
}

export { FORECAST_REGRESSION_SKUS };
