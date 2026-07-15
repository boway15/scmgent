/**
 * 走步分层标定：asOf 前 DB 特征 + 网格评分（纯函数 + DB 特征加载）
 */
import { eq, inArray } from 'drizzle-orm';
import { db, skus, warehouses } from '@scm/db';
import {
  collectStockoutExcludedDates,
  effectiveRecentWindowEnd,
  filterSalesRowsExcludingDates,
  roundDaily,
} from './forecast-baseline.js';
import { filterSalesRowsByStation } from './forecast-collaboration.js';
import { normalizeSalesPlatform, stationForWarehouse } from './forecast-demand.js';
import type { AccuracyRowInput } from './forecast-accuracy-tier.js';
import { computeWeightedMape } from './forecast-accuracy-tier.js';
import { summarizeAccuracyMatrix } from './forecast-horizon-band.js';
import type { ProfileSegment } from './forecast-profile-class.js';
import type { ForecastProfileConfig } from './forecast-profile-config.js';
import { DEFAULT_FORECAST_PROFILE_CONFIG } from './forecast-profile-config.js';
import {
  buildLast12MonthlyQty,
  resolveSkuProfileSnapshot,
} from './forecast-profile-snapshot.js';
import {
  loadDailySalesBySkuIdsInRange,
  loadMonthlySalesBySkuIds,
} from './sales-history-query.js';
import { DEFAULT_MONTHLY_HISTORY_LOOKBACK_MONTHS } from './sales-history-monthly.js';

export type SkuFeatureSnapshot = {
  skuCode: string;
  skuId: string;
  monthlyQty: number[];
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  continuity: number;
  cv: number;
  segment: ProfileSegment;
};

export type SegmentationScore = {
  config: ForecastProfileConfig;
  aCoreSkuCount: number;
  aCorePrecisionWmape: number | null;
  aCoreFlexWmape: number | null;
  misclassifiedMicroShare: number;
  matrixSummary: ReturnType<typeof summarizeAccuracyMatrix>;
};

export type ProfileCalibrationGrid = {
  continuityMinA: number[];
  cvMaxA: number[];
  coreContinuityMin: number[];
  coreRecent90Min: number[];
};

export const DEFAULT_PROFILE_CALIBRATION_GRID: ProfileCalibrationGrid = {
  continuityMinA: [0.75, 0.8, 0.85],
  cvMaxA: [0.9, 1.0, 1.1],
  coreContinuityMin: [0.8, 0.85, 0.9],
  coreRecent90Min: [5, 7, 10],
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

export function parseWalkforwardAccuracyRows(text: string): AccuracyRowInput[] {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const [header, ...data] = lines;
  if (!header?.startsWith('sku_code')) {
    throw new Error(`unexpected walkforward header: ${header ?? '(empty)'}`);
  }

  return data.map((line) => {
    const parts = line.split(',');
    const monthLabel = parts[3] ?? '';
    const match = /^(\d{4})-(\d{2})$/.exec(monthLabel);
    return {
      skuCode: parts[0] ?? '',
      actualDaily: Number(parts[5]),
      forecastDaily: Number(parts[4]),
      biasRate: parts[6] === '' ? null : Number(parts[6]),
      mape: parts[7] === '' ? null : Number(parts[7]),
      forecastYear: match ? Number(match[1]) : 2026,
      month: match ? Number(match[2]) : 1,
      profileSegment: parts[8] || undefined,
      forecastDailyP10: parts[11] === '' ? null : Number(parts[11]),
      forecastDailyP90: parts[12] === '' ? null : Number(parts[12]),
      classificationEstimated: (parts[16] ?? 'persisted') === 'estimated',
    };
  });
}

export function assignSegment(
  feature: Pick<SkuFeatureSnapshot, 'monthlyQty' | 'recent90DailyAvg' | 'continuity' | 'cv'>,
  config: ForecastProfileConfig = DEFAULT_FORECAST_PROFILE_CONFIG,
  asOf?: Date,
): ProfileSegment {
  return resolveSkuProfileSnapshot({
    monthlyQty: feature.monthlyQty,
    recent90DailyAvg: feature.recent90DailyAvg,
    asOf,
    config,
  }).segment;
}

export function buildSegmentMapFromFeatures(
  featuresBySku: Map<string, SkuFeatureSnapshot>,
  config: ForecastProfileConfig,
  asOf?: Date,
): Map<string, ProfileSegment> {
  const map = new Map<string, ProfileSegment>();
  for (const [skuCode, feature] of featuresBySku) {
    map.set(skuCode, assignSegment(feature, config, asOf));
  }
  return map;
}

export function scoreSegmentation(input: {
  rows: AccuracyRowInput[];
  featuresBySku: Map<string, SkuFeatureSnapshot>;
  config: ForecastProfileConfig;
  asOf: Date;
}): SegmentationScore {
  const segmentBySku = buildSegmentMapFromFeatures(
    input.featuresBySku,
    input.config,
    input.asOf,
  );
  const matrixSummary = summarizeAccuracyMatrix(input.rows, {
    asOf: input.asOf,
    segmentBySku,
  });
  const aCoreSeg = matrixSummary.bySegment.find((s) => s.segment === 'A:core');
  const aCoreSkuCount = new Set(
    input.rows
      .filter((r) => segmentBySku.get(r.skuCode) === 'A:core')
      .map((r) => r.skuCode),
  ).size;

  const aCoreRows = input.rows.filter((r) => segmentBySku.get(r.skuCode) === 'A:core');
  const microRows = aCoreRows.filter((r) => r.actualDaily < 1);
  const misclassifiedMicroShare =
    aCoreRows.length > 0 ? microRows.length / aCoreRows.length : 0;

  return {
    config: input.config,
    aCoreSkuCount,
    aCorePrecisionWmape: aCoreSeg?.bands.precision.wmape ?? null,
    aCoreFlexWmape: aCoreSeg?.bands.flex.wmape ?? null,
    misclassifiedMicroShare,
    matrixSummary,
  };
}

export function meetsSegmentationConstraints(
  score: SegmentationScore,
  opts?: { minACoreSkus?: number; maxMicroShare?: number },
): boolean {
  const minACoreSkus = opts?.minACoreSkus ?? 50;
  const maxMicroShare = opts?.maxMicroShare ?? 0.05;
  return score.aCoreSkuCount >= minACoreSkus && score.misclassifiedMicroShare <= maxMicroShare;
}

export function expandProfileCalibrationGrid(
  grid: ProfileCalibrationGrid = DEFAULT_PROFILE_CALIBRATION_GRID,
): ForecastProfileConfig[] {
  const configs: ForecastProfileConfig[] = [];
  for (const continuityMinA of grid.continuityMinA) {
    for (const cvMaxA of grid.cvMaxA) {
      for (const coreContinuityMin of grid.coreContinuityMin) {
        for (const coreRecent90Min of grid.coreRecent90Min) {
          configs.push({
            ...DEFAULT_FORECAST_PROFILE_CONFIG,
            continuityMinA,
            cvMaxA,
            continuityMinB: continuityMinA,
            coreContinuityMin,
            coreRecent90Min,
          });
        }
      }
    }
  }
  return configs;
}

export function rankSegmentationScores(
  scores: SegmentationScore[],
  opts?: { minACoreSkus?: number; maxMicroShare?: number },
): SegmentationScore[] {
  const minACoreSkus = opts?.minACoreSkus ?? 50;
  const maxMicroShare = opts?.maxMicroShare ?? 0.05;
  const feasible = scores.filter((s) =>
    meetsSegmentationConstraints(s, { minACoreSkus, maxMicroShare }),
  );
  const pool = feasible.length > 0 ? feasible : scores;
  return [...pool].sort((a, b) => {
    const aw = a.aCorePrecisionWmape ?? Number.POSITIVE_INFINITY;
    const bw = b.aCorePrecisionWmape ?? Number.POSITIVE_INFINITY;
    if (aw !== bw) return aw - bw;
    return a.misclassifiedMicroShare - b.misclassifiedMicroShare;
  });
}

export async function buildSkuFeatureSnapshot(input: {
  skuId: string;
  skuCode: string;
  asOf: Date;
  station: string;
  platform: string;
  warehouseStationByCode: Map<string, string>;
  monthlyBySku: Map<string, Array<{ saleYear: number; month: number; qtySold: number }>>;
  dailyBySku: Map<string, Array<{ saleDate: string; qtySold: number; warehouseCode: string | null }>>;
}): Promise<SkuFeatureSnapshot> {
  const recentWindowEnd = effectiveRecentWindowEnd(input.asOf);
  const recent30Since = addDays(recentWindowEnd, -29);
  const recent90Since = addDays(recentWindowEnd, -89);

  const rawSalesRows = filterSalesRowsByStation(
    input.dailyBySku.get(input.skuId) ?? [],
    input.station,
    input.warehouseStationByCode,
  );
  const stockoutExcluded = collectStockoutExcludedDates(
    rawSalesRows,
    recent90Since,
    recentWindowEnd,
  );
  const salesRows = filterSalesRowsExcludingDates(rawSalesRows, stockoutExcluded);
  const monthlySalesRows = input.monthlyBySku.get(input.skuId) ?? [];
  const monthlyQty = buildLast12MonthlyQty(monthlySalesRows, recentWindowEnd);
  const recent30DailyAvg = roundDaily(sumQtySince(salesRows, recent30Since) / 30);
  const recent90DailyAvg = roundDaily(sumQtySince(salesRows, recent90Since) / 90);
  const profile = resolveSkuProfileSnapshot({
    monthlyQty,
    asOf: recentWindowEnd,
    recent90DailyAvg,
    layer: 'sku',
  });

  return {
    skuCode: input.skuCode,
    skuId: input.skuId,
    monthlyQty,
    recent30DailyAvg,
    recent90DailyAvg,
    continuity: profile.continuity,
    cv: profile.cv,
    segment: profile.segment,
  };
}

export async function buildCalibrationFeatureCache(input: {
  asOf: Date;
  station: string;
  platform: string;
  skuCodes: string[];
}): Promise<Map<string, SkuFeatureSnapshot>> {
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

  const cache = new Map<string, SkuFeatureSnapshot>();
  for (const sku of skuRows) {
    const feature = await buildSkuFeatureSnapshot({
      skuId: sku.id,
      skuCode: sku.code,
      asOf: input.asOf,
      station,
      platform,
      warehouseStationByCode,
      monthlyBySku,
      dailyBySku,
    });
    cache.set(sku.code.toUpperCase(), feature);
  }
  return cache;
}

export function scorePersistedSegmentBaseline(input: {
  rows: AccuracyRowInput[];
  asOf: Date;
}): number | null {
  const matrix = summarizeAccuracyMatrix(input.rows, { asOf: input.asOf });
  return matrix.bySegment.find((s) => s.segment === 'A:core')?.bands.precision.wmape ?? null;
}

export function formatSegmentationScoreLine(score: SegmentationScore, rank: number): string {
  const wmape =
    score.aCorePrecisionWmape != null
      ? `${(score.aCorePrecisionWmape * 100).toFixed(1)}%`
      : '—';
  return [
    `#${rank}`,
    `A:core WMAPE=${wmape}`,
    `SKU=${score.aCoreSkuCount}`,
    `micro=${(score.misclassifiedMicroShare * 100).toFixed(1)}%`,
    `cvMaxA=${score.config.cvMaxA}`,
    `coreCont=${score.config.coreContinuityMin}`,
    `coreR90=${score.config.coreRecent90Min}`,
  ].join(' · ');
}

export function computeSegmentDrift(
  before: Map<string, ProfileSegment>,
  after: Map<string, ProfileSegment>,
): { fromCoreToMid: string[]; fromMidToCore: string[] } {
  const fromCoreToMid: string[] = [];
  const fromMidToCore: string[] = [];
  for (const [sku, prev] of before) {
    const next = after.get(sku);
    if (!next) continue;
    if (prev === 'A:core' && next === 'A:mid') fromCoreToMid.push(sku);
    if (prev === 'A:mid' && next === 'A:core') fromMidToCore.push(sku);
  }
  return { fromCoreToMid, fromMidToCore };
}

export function wmapeForSegmentRows(
  rows: AccuracyRowInput[],
  segment: ProfileSegment,
  segmentBySku: Map<string, ProfileSegment>,
): number | null {
  const sub = rows.filter((r) => segmentBySku.get(r.skuCode) === segment && r.actualDaily > 0);
  return computeWeightedMape(sub);
}
