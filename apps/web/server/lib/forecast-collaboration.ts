import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  db,
  salesForecastMonthly,
  salesForecastReviewItems,
  salesForecastSeasonality,
  salesForecastSourceBatches,
  salesForecastVersions,
  forecastAccuracyMonthly,
  skus,
  warehouses,
} from '@scm/db';
import {
  allocateUniqueDraftVersionName,
  findOrCreateDraftVersionForImport,
  getOrCreateDraftVersion,
  getForecastVersionById,
} from './forecast-version.js';
import {
  loadLatestSalesHistoryCategoryBySkuIds,
  resolveEffectiveSkuCategory,
  skuMatchesCategoryFilter,
} from './sku-category.js';
import {
  FORECAST_GLOBAL_STATION,
  isForecastGlobalStation,
  resolveBaselineGenerateStations,
  resolveForecastGenerationStation,
} from './forecast-station-scope.js';

export { resolveBaselineGenerateStations } from './forecast-station-scope.js';
import { rebuildSeasonalityFromSalesHistoryMonthly } from './forecast-seasonality-rebuild.js';
import {
  buildMonthlyForecastHorizon,
  classifySalesLifecycle,
  clipCombinedSeasonality,
  collectStockoutExcludedDates,
  computeForecastDailyAvgForMonth,
  computeFloorForecast,
  computeBClassPointForecast,
  computeResidualInterval,
  computeYoyAnchorDailyAvg,
  DEFAULT_SALES_HISTORY_LOOKBACK_DAYS,
  effectiveRecentWindowEnd,
  filterSalesRowsExcludingDates,
  resolveEffectiveLastYearDailyAvg,
  resolveConservativeCategoryFactor,
  roundDaily,
  SEASONALITY_MIN_MONTH_QTY,
  SEASONALITY_MIN_POSITIVE_MONTHS,
  SEASONALITY_TREND_RECENT_MONTHS,
  SEASONALITY_WINDOW_MONTHS,
  type HorizonFactorSnapshot,
  type SalesLifecycle,
} from './forecast-baseline.js';
import { horizonBandFromIndex } from './forecast-horizon-band.js';
import {
  buildCategoryPoolKey,
  computePoolDailyFromSkus,
  groupLongTailSkusByPool,
  splitPoolForecastToSkus,
  type SkuPoolInput,
} from './forecast-aggregate-pool.js';
import {
  getForecastPhase,
  resolveSalesTierSegment,
  resolveT1SubSegment,
  shouldForecastSalesTier,
  type SalesTier,
  type T1SubSegment,
} from './forecast-sales-tier.js';
import {
  buildLast12MonthlyQty,
  resolveSkuProfileSnapshot,
} from './forecast-profile-snapshot.js';
import { loadForecastCalibrationConfig } from './forecast-profile-config.js';
import {
  resolveProfileSegment,
  type ProfileClass,
  type ProfileSegment,
} from './forecast-profile-class.js';
import { normalizeSalesPlatform, stationForWarehouse } from './forecast-demand.js';
import { DEFAULT_MONTHLY_HISTORY_LOOKBACK_MONTHS } from './sales-history-monthly.js';
import {
  loadDailySalesBySkuIdsInRange,
  loadFirstSaleDateBySkuIds,
  loadMonthlySalesBySkuIds,
} from './sales-history-query.js';
import type { MonthlyTrendRow } from './sales-report-parser.js';
import {
  emptyEligibilityStats,
  evaluateForecastEligibility,
  shouldUseCategoryReference,
  type EligibilityStats,
} from './forecast-eligibility.js';
import {
  type ForecastAlgoMode,
  isAllCatV41AlgoMode,
  isMonthlyAbcdAlgoMode,
  resolveForecastAlgoMode,
} from './forecast-algo-mode.js';
import {
  ALLCAT_V41_MODEL,
  buildT99ReviewMessage,
  computeAllCatV41ForecastForMonth,
  isAllCatV41Forecastable,
  isAllCatV41RecentSalesAbsent,
  resolveAllCatProductCategory,
} from './forecast-allcat-v41.js';
import {
  resolveBaselineForecastPlatforms,
  resolveForecastPlatformFilter,
} from './forecast-platform-scope.js';
import {
  buildMonthlyAbcdCPoolContext,
  computeMonthlyAbcdForecastDailyAvg,
  type MonthlyAbcdCPoolContext,
} from './forecast-monthly-abcd.js';
import { cleanMonthlyQtyForTraining } from './forecast-monthly-clean.js';

export type { EligibilityStats };

export type ReviewIssueType =
  | 'high_value'
  | 'trend_shift'
  | 'stockout_suspected'
  | 'category_deviation'
  | 'low_accuracy'
  | 'missing_history'
  | 'platform_mix'
  | 'forecast_skipped'
  | 'precision_review';

export type ReviewItemDraft = {
  skuId: string;
  station: string;
  platform: string;
  issueType: ReviewIssueType;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  suggestedDailyAvg?: number;
};

export type ReviewItemIdentity = {
  versionId: string;
  skuId: string;
  station: string;
  platform: string;
  issueType: ReviewIssueType;
};

export type SeasonalityFactorDraft = {
  dimensionType: MonthlyTrendRow['dimensionType'];
  dimensionValue: string;
  month: number;
  seasonalityFactor: number;
  trendFactor: number;
};

export type SeasonalityLookup = Map<string, { seasonalityFactor: number; trendFactor: number }>;

function seasonalityMapKey(
  dimensionType: 'category' | 'project_group',
  dimensionValue: string,
  month: number,
): string {
  return `${dimensionType}::${dimensionValue.trim()}::${month}`;
}

export function buildSeasonalityDimensionCandidates(category: string | null | undefined): {
  category: string[];
  projectGroup: string[];
} {
  const raw = category?.trim();
  if (!raw) {
    return { category: [], projectGroup: [] };
  }

  const segments = raw.split(/[|\\/]/).map((part) => part.trim()).filter(Boolean);
  const leaf = segments[segments.length - 1] ?? raw;
  const projectGroup = segments.length >= 2 ? segments[1] : segments[0] ?? raw;

  return {
    category: Array.from(new Set([raw, leaf, ...segments])),
    projectGroup: Array.from(new Set([projectGroup, raw, ...segments])),
  };
}

export function resolveSeasonalityFactors(
  lookup: SeasonalityLookup,
  category: string | null | undefined,
  month: number,
): { seasonalityFactor: number; trendFactor: number; matched: boolean } {
  const candidates = buildSeasonalityDimensionCandidates(category);

  for (const dimensionValue of candidates.category) {
    const hit = lookup.get(seasonalityMapKey('category', dimensionValue, month));
    if (hit) return { ...hit, matched: true };
  }

  for (const dimensionValue of candidates.projectGroup) {
    const hit = lookup.get(seasonalityMapKey('project_group', dimensionValue, month));
    if (hit) return { ...hit, matched: true };
  }

  return { seasonalityFactor: 1, trendFactor: 1, matched: false };
}

export async function loadSeasonalityLookup(): Promise<SeasonalityLookup> {
  const rows = await db
    .select({
      dimensionType: salesForecastSeasonality.dimensionType,
      dimensionValue: salesForecastSeasonality.dimensionValue,
      month: salesForecastSeasonality.month,
      seasonalityFactor: salesForecastSeasonality.seasonalityFactor,
      trendFactor: salesForecastSeasonality.trendFactor,
    })
    .from(salesForecastSeasonality);

  const lookup: SeasonalityLookup = new Map();
  for (const row of rows) {
    lookup.set(seasonalityMapKey(row.dimensionType, row.dimensionValue, row.month), {
      seasonalityFactor: Number(row.seasonalityFactor) || 1,
      trendFactor: Number(row.trendFactor) || 1,
    });
  }
  return lookup;
}

export type SalesRowWithWarehouse = {
  saleDate: string;
  qtySold: number;
  warehouseCode: string | null;
};

export function buildReviewItemsForForecast(input: {
  skuId: string;
  skuCode?: string;
  station: string;
  platform: string;
  lifecycle: SalesLifecycle;
  baselineDailyAvg?: number;
  suggestedDailyAvg: number;
  hasEnoughHistory: boolean;
  categoryTrendApplied: boolean;
  categoryTrendFactor?: number;
  seasonalityWasClipped?: boolean;
  profileClass?: ProfileClass;
  volumeTier?: 'core' | 'mid' | 'tail';
  maxHorizonMonthIndex?: number;
}): ReviewItemDraft[] {
  const skuLabel = input.skuCode ?? input.skuId;
  const base = {
    skuId: input.skuId,
    station: input.station,
    platform: input.platform,
    suggestedDailyAvg: input.suggestedDailyAvg,
  };
  const items: ReviewItemDraft[] = [];

  if (!input.hasEnoughHistory) {
    items.push({
      ...base,
      issueType: 'missing_history',
      severity: 'info',
      message: `${skuLabel} 历史销量数据不足，请复核低置信度基线预测。`,
    });
  }

  if (input.lifecycle === 'new') {
    items.push({
      ...base,
      issueType: 'missing_history',
      severity: 'warning',
      message: `${skuLabel} 为新品/上架不足 90 天，预测为低置信度，请人工确认或填写预期日均。`,
    });
  }

  if (input.lifecycle === 'growth' || input.lifecycle === 'decline') {
    items.push({
      ...base,
      issueType: 'trend_shift',
      severity: 'warning',
      message: `${skuLabel} 近期销量趋势发生异动，请确认是否有促销、断货或生命周期变化。`,
    });
  }

  if (input.lifecycle === 'stockout_suspected') {
    items.push({
      ...base,
      issueType: 'stockout_suspected',
      severity: 'warning',
      message: `${skuLabel} 可能存在断货抑制的需求，请复核建议日均销量。`,
    });
  }

  if (input.seasonalityWasClipped && input.categoryTrendFactor != null && input.categoryTrendFactor !== 1) {
    items.push({
      ...base,
      issueType: 'category_deviation',
      severity:
        input.lifecycle === 'growth' || input.lifecycle === 'decline' ? 'warning' : 'info',
      message: `${skuLabel} 品类趋势系数 ${input.categoryTrendFactor.toFixed(
        2,
      )} 已裁剪至合理区间，请结合品类需求复核预测。`,
    });
  } else if (
    input.categoryTrendApplied === false &&
    input.categoryTrendFactor != null &&
    input.categoryTrendFactor !== 1
  ) {
    items.push({
      ...base,
      issueType: 'category_deviation',
      severity: 'warning',
      message: `${skuLabel} 品类趋势系数 ${input.categoryTrendFactor.toFixed(
        2,
      )} 未自动应用，请结合品类需求复核预测。`,
    });
  }

  if (
    input.profileClass === 'A' &&
    input.volumeTier === 'core' &&
    (input.maxHorizonMonthIndex ?? 99) <= 2
  ) {
    items.push({
      ...base,
      issueType: 'precision_review',
      severity: 'critical',
      message: `${skuLabel} 为 A·常青款·主力，近 3 月预测需强制复核后方可发布。`,
    });
  }

  return items;
}

export function formatTrendMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** 最近 N 个自然月（含 end 当月），返回 YYYY-MM 升序 */
export function monthKeysEndingAt(year: number, month: number, count: number): string[] {
  const safeCount = Math.max(1, Math.floor(count));
  const keys: string[] = [];
  let y = year;
  let m = month;

  for (let index = 0; index < safeCount; index++) {
    keys.unshift(formatTrendMonthKey(y, m));
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }

  return keys;
}

/** 为日历月 1–12 选取季节系数锚点：当月用 asOf 年月（含未完结销量） */
export function resolveSeasonalityAnchor(
  refYear: number,
  refMonth: number,
  calendarMonth: number,
): { endYear: number; endMonth: number } {
  if (calendarMonth === refMonth) {
    return { endYear: refYear, endMonth: refMonth };
  }
  if (calendarMonth < refMonth) {
    return { endYear: refYear, endMonth: calendarMonth };
  }
  return { endYear: refYear - 1, endMonth: calendarMonth };
}

export type SeasonalityFactorAtAnchor = {
  seasonalityFactor: number;
  trendFactor: number;
  combinedFactor: number;
  wasClipped: boolean;
};

/** 以绝对月 (endYear,endMonth) 为锚点测算季节/趋势/综合系数（保守：6月季节窗 + 3v3趋势） */
export function computeSeasonalityFactorAtAnchor(
  qtyByMonth: Map<string, number>,
  endYear: number,
  endMonth: number,
): SeasonalityFactorAtAnchor {
  const recentKeys = monthKeysEndingAt(endYear, endMonth, SEASONALITY_WINDOW_MONTHS);
  const recentQtys = recentKeys.map((key) => qtyByMonth.get(key) ?? 0);
  const recentAvg = recentQtys.reduce((sum, qty) => sum + qty, 0) / recentKeys.length;

  const lastYearQtys = recentKeys
    .map((key) => {
      const [yearText, monthText] = key.split('-');
      const lastYearKey = `${Number(yearText) - 1}-${monthText}`;
      return qtyByMonth.get(lastYearKey) ?? 0;
    })
    .filter((qty) => qty > 0);

  const lastYearAvg =
    lastYearQtys.length > 0
      ? lastYearQtys.reduce((a, b) => a + b, 0) / lastYearQtys.length
      : 0;

  const seasonalityFactor =
    lastYearQtys.length >= SEASONALITY_MIN_POSITIVE_MONTHS &&
    recentAvg >= SEASONALITY_MIN_MONTH_QTY / SEASONALITY_WINDOW_MONTHS &&
    lastYearAvg > 0 &&
    recentAvg > 0
      ? roundFactor(recentAvg / lastYearAvg)
      : 1;

  const recentTrendKeys = monthKeysEndingAt(endYear, endMonth, SEASONALITY_TREND_RECENT_MONTHS);
  const priorEndDate = new Date(Date.UTC(endYear, endMonth - 1 - SEASONALITY_TREND_RECENT_MONTHS, 1));
  const priorTrendKeys = monthKeysEndingAt(
    priorEndDate.getUTCFullYear(),
    priorEndDate.getUTCMonth() + 1,
    SEASONALITY_TREND_RECENT_MONTHS,
  );

  const recentTrendAvg =
    recentTrendKeys.reduce((sum, key) => sum + (qtyByMonth.get(key) ?? 0), 0) /
    recentTrendKeys.length;
  const priorTrendQtys = priorTrendKeys.map((key) => qtyByMonth.get(key) ?? 0);
  const priorPositive = priorTrendQtys.filter((qty) => qty > 0);
  const priorTrendAvg =
    priorPositive.length >= SEASONALITY_MIN_POSITIVE_MONTHS
      ? priorPositive.reduce((a, b) => a + b, 0) / priorPositive.length
      : 0;

  const trendFactor =
    priorTrendAvg >= SEASONALITY_MIN_MONTH_QTY / SEASONALITY_TREND_RECENT_MONTHS &&
    recentTrendAvg > 0 &&
    priorTrendAvg > 0
      ? roundFactor(recentTrendAvg / priorTrendAvg)
      : 1;

  const rawCombined = seasonalityFactor * trendFactor;
  const resolved = resolveConservativeCategoryFactor(rawCombined);

  return {
    seasonalityFactor,
    trendFactor,
    combinedFactor: resolved.factor,
    wasClipped: resolved.wasClipped,
  };
}

export function computeSeasonalityFactors(
  rows: MonthlyTrendRow[],
  asOf: Date = new Date(),
): SeasonalityFactorDraft[] {
  const refYear = asOf.getUTCFullYear();
  const refMonth = asOf.getUTCMonth() + 1;

  const grouped = new Map<string, MonthlyTrendRow[]>();
  for (const row of rows) {
    const key = `${row.dimensionType}::${row.dimensionValue}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const factors: SeasonalityFactorDraft[] = [];
  for (const groupRows of grouped.values()) {
    if (!groupRows.length) continue;

    const qtyByMonth = new Map<string, number>();
    for (const row of groupRows) {
      qtyByMonth.set(row.month, (qtyByMonth.get(row.month) ?? 0) + row.qtySold);
    }

    const { dimensionType, dimensionValue } = groupRows[0]!;

    for (let calendarMonth = 1; calendarMonth <= 12; calendarMonth++) {
      const { endYear, endMonth } = resolveSeasonalityAnchor(refYear, refMonth, calendarMonth);
      const atAnchor = computeSeasonalityFactorAtAnchor(qtyByMonth, endYear, endMonth);

      factors.push({
        dimensionType,
        dimensionValue,
        month: calendarMonth,
        seasonalityFactor: atAnchor.seasonalityFactor,
        trendFactor: atAnchor.trendFactor,
      });
    }
  }

  return factors;
}

export function filterSalesRowsByStation<T extends { warehouseCode: string | null }>(
  rows: T[],
  station: string,
  warehouseStationByCode: Map<string, string>,
): T[] {
  if (isForecastGlobalStation(station)) {
    return rows;
  }
  const targetStation = station.toUpperCase();
  return rows.filter((row) => {
    const warehouseCode = row.warehouseCode?.trim();
    if (!warehouseCode) {
      return true;
    }
    return warehouseStationByCode.get(warehouseCode) === targetStation;
  });
}

/** 按品类 leaf 取同品类 SKU recent90 中位数，作为新品/缺历史 SKU 的参考日均 */
export function computeCategoryReferenceBySku(
  skuRows: Array<{ id: string; category: string | null }>,
  recent90BySkuId: Map<string, number>,
): Map<string, number> {
  const valuesByCategory = new Map<string, number[]>();

  for (const sku of skuRows) {
    const recent90 = recent90BySkuId.get(sku.id) ?? 0;
    if (recent90 <= 0) continue;

    const candidates = buildSeasonalityDimensionCandidates(sku.category);
    const key = candidates.category[0] ?? candidates.projectGroup[0];
    if (!key) continue;

    const list = valuesByCategory.get(key) ?? [];
    list.push(recent90);
    valuesByCategory.set(key, list);
  }

  const medianByCategory = new Map<string, number>();
  for (const [key, values] of valuesByCategory) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
    medianByCategory.set(key, roundDaily(median));
  }

  const result = new Map<string, number>();
  for (const sku of skuRows) {
    const candidates = buildSeasonalityDimensionCandidates(sku.category);
    for (const key of [...candidates.category, ...candidates.projectGroup]) {
      const ref = medianByCategory.get(key);
      if (ref != null && ref > 0) {
        result.set(sku.id, ref);
        break;
      }
    }
  }

  return result;
}

export function buildReviewItemIdentity(
  versionId: string,
  item: Pick<ReviewItemDraft, 'skuId' | 'station' | 'platform' | 'issueType'>,
): ReviewItemIdentity {
  return {
    versionId,
    skuId: item.skuId,
    station: item.station,
    platform: item.platform,
    issueType: item.issueType,
  };
}

export function buildReviewItemKey(input: ReviewItemIdentity): string {
  return [
    input.versionId,
    input.skuId,
    input.station,
    input.platform,
    input.issueType,
  ].join('::');
}

export function computeAgeDaysFromFirstSale(
  firstSaleDate: string | null | undefined,
  today: Date,
): number {
  if (!firstSaleDate) return 0;
  const diffMs = Date.parse(toDateOnly(today)) - Date.parse(String(firstSaleDate).slice(0, 10));
  if (!Number.isFinite(diffMs)) return 0;
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

export async function createForecastSourceBatch(input: {
  dailyFileName?: string;
  monthlyFileName?: string;
  dailyStartDate?: string | Date | null;
  dailyEndDate?: string | Date | null;
  monthlyStartMonth?: string;
  monthlyEndMonth?: string;
  skuCount: number;
  rowCount: number;
  createdBy?: string;
}) {
  const [row] = await db
    .insert(salesForecastSourceBatches)
    .values({
      batchNo: buildForecastSourceBatchNo(),
      dailyFileName: input.dailyFileName,
      monthlyFileName: input.monthlyFileName,
      dailyStartDate: formatDateOnly(input.dailyStartDate),
      dailyEndDate: formatDateOnly(input.dailyEndDate),
      monthlyStartMonth: input.monthlyStartMonth,
      monthlyEndMonth: input.monthlyEndMonth,
      skuCount: input.skuCount,
      rowCount: input.rowCount,
      status: 'parsed',
      createdBy: input.createdBy,
    })
    .returning();

  return row;
}

export async function upsertSeasonalityFactors(
  batchId: string,
  factors: SeasonalityFactorDraft[],
) {
  let upserted = 0;
  for (const factor of factors) {
    const [existing] = await db
      .select({ id: salesForecastSeasonality.id })
      .from(salesForecastSeasonality)
      .where(
        and(
          eq(salesForecastSeasonality.dimensionType, factor.dimensionType),
          eq(salesForecastSeasonality.dimensionValue, factor.dimensionValue),
          eq(salesForecastSeasonality.month, factor.month),
        ),
      )
      .limit(1);

    const values = {
      seasonalityFactor: String(factor.seasonalityFactor),
      trendFactor: String(factor.trendFactor),
      sourceBatchId: batchId,
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(salesForecastSeasonality)
        .set(values)
        .where(eq(salesForecastSeasonality.id, existing.id));
    } else {
      await db.insert(salesForecastSeasonality).values({
        dimensionType: factor.dimensionType,
        dimensionValue: factor.dimensionValue,
        month: factor.month,
        ...values,
      });
    }
    upserted++;
  }

  return { upserted };
}

async function purgeSkuForecastScopeForVersion(versionId: string, skuIds: string[]): Promise<void> {
  if (!skuIds.length) return;
  await db
    .delete(salesForecastReviewItems)
    .where(
      and(
        eq(salesForecastReviewItems.versionId, versionId),
        inArray(salesForecastReviewItems.skuId, skuIds),
      ),
    );
  await db
    .delete(salesForecastMonthly)
    .where(
      and(eq(salesForecastMonthly.versionId, versionId), inArray(salesForecastMonthly.skuId, skuIds)),
    );
}

export async function purgeForecastVersionScope(
  versionId: string,
  scope?: { station?: string; platform?: string },
): Promise<{ forecastDeleted: number; accuracyDeleted: number; reviewDeleted: number }> {
  const station = scope?.station?.trim().toUpperCase();
  const platformFilter = resolveForecastPlatformFilter(scope?.platform);

  const forecastConditions = [eq(salesForecastMonthly.versionId, versionId)];
  if (station && !isForecastGlobalStation(station)) {
    forecastConditions.push(eq(salesForecastMonthly.station, station));
  }
  if (platformFilter?.length === 1) {
    forecastConditions.push(eq(salesForecastMonthly.platform, platformFilter[0]));
  } else if (platformFilter && platformFilter.length > 1) {
    forecastConditions.push(
      or(
        inArray(salesForecastMonthly.platform, platformFilter),
        eq(salesForecastMonthly.platform, 'ALL'),
      )!,
    );
  }

  const accuracyConditions = [eq(forecastAccuracyMonthly.versionId, versionId)];
  if (station && !isForecastGlobalStation(station)) {
    accuracyConditions.push(eq(forecastAccuracyMonthly.station, station));
  }
  if (platformFilter?.length === 1) {
    accuracyConditions.push(eq(forecastAccuracyMonthly.platform, platformFilter[0]));
  } else if (platformFilter && platformFilter.length > 1) {
    accuracyConditions.push(
      or(
        inArray(forecastAccuracyMonthly.platform, platformFilter),
        eq(forecastAccuracyMonthly.platform, 'ALL'),
      )!,
    );
  }

  const reviewDeleted = await db
    .delete(salesForecastReviewItems)
    .where(eq(salesForecastReviewItems.versionId, versionId))
    .returning({ id: salesForecastReviewItems.id });

  const forecastDeleted = await db
    .delete(salesForecastMonthly)
    .where(and(...forecastConditions))
    .returning({ id: salesForecastMonthly.id });

  const accuracyDeleted = await db
    .delete(forecastAccuracyMonthly)
    .where(and(...accuracyConditions))
    .returning({ id: forecastAccuracyMonthly.id });

  return {
    forecastDeleted: forecastDeleted.length,
    accuracyDeleted: accuracyDeleted.length,
    reviewDeleted: reviewDeleted.length,
  };
}

/** 全量基线生成时按平台/版本清空旧行；单 SKU 重算仅 purgeSkuScope，不得清空整版。 */
export function resolveBaselinePurgePlatformScope(input: {
  purgeSkuScope?: boolean;
  platformCount: number;
  platformIndex?: number;
}): 'all' | 'current' | undefined {
  if (input.purgeSkuScope) return undefined;
  if (input.platformCount === 1) return 'current';
  if (input.platformIndex === 0) return 'all';
  return undefined;
}

import { assertForecastWriteAllowed } from './forecast-reset.js';

export async function generateBaselineForecastVersion(input: {
  station?: string;
  platform?: string;
  category?: string;
  skuCode?: string;
  versionName?: string;
  monthCount?: number;
  today?: Date;
  createdBy?: string;
  /** legacy | monthly_abcd；默认读 FORECAST_ALGO_MODE */
  algoMode?: ForecastAlgoMode;
  /** 走步回测：不复用同名 draft，始终新建版本 */
  forceNewVersion?: boolean;
  /** 走步 --replace：在已有版本上继续生成 */
  existingVersionId?: string;
}) {
  assertForecastWriteAllowed();
  const result = await generateBaselineForecastVersionForStation({
    ...input,
    station: resolveForecastGenerationStation(input.station),
    useGlobalVersion: true,
    existingVersionId: input.existingVersionId,
    purgeSkuScope: Boolean(input.skuCode?.trim()),
    forceNewVersion: input.forceNewVersion,
  });
  return result;
}

async function generateBaselineForecastVersionForStation(input: {
  station: string;
  platform?: string;
  category?: string;
  skuCode?: string;
  versionName?: string;
  monthCount?: number;
  today?: Date;
  createdBy?: string;
  algoMode?: ForecastAlgoMode;
  existingVersionId?: string;
  useGlobalVersion?: boolean;
  purgeSkuScope?: boolean;
  forceNewVersion?: boolean;
}) {
  const platforms = resolveBaselineForecastPlatforms(input.platform);
  if (platforms.length === 1) {
    return generateBaselineForStationPlatform({
      ...input,
      platform: platforms[0]!,
      purgePlatformScope: resolveBaselinePurgePlatformScope({
        purgeSkuScope: input.purgeSkuScope,
        platformCount: 1,
      }),
    });
  }

  let versionId = input.existingVersionId;
  let lastResult: Awaited<ReturnType<typeof generateBaselineForStationPlatform>> | undefined;
  let totalForecastRows = 0;
  let totalReviewRows = 0;
  const mergedEligibilityStats = emptyEligibilityStats();

  for (let index = 0; index < platforms.length; index++) {
    const platform = platforms[index]!;
    const part = await generateBaselineForStationPlatform({
      ...input,
      platform,
      existingVersionId: versionId ?? lastResult?.version.id,
      purgeSkuScope: Boolean(input.purgeSkuScope) && index === 0,
      purgePlatformScope: resolveBaselinePurgePlatformScope({
        purgeSkuScope: input.purgeSkuScope,
        platformCount: platforms.length,
        platformIndex: index,
      }),
    });
    versionId = part.version.id;
    lastResult = part;
    totalForecastRows += part.forecastRows;
    totalReviewRows += part.reviewRows;
    if (part.eligibilityStats) {
      mergedEligibilityStats.eligible += part.eligibilityStats.eligible;
      mergedEligibilityStats.skipped += part.eligibilityStats.skipped;
      for (const tier of ['core', 'mid', 'tail'] as const) {
        mergedEligibilityStats.byTier[tier] += part.eligibilityStats.byTier[tier];
      }
    }
  }

  if (!lastResult) {
    throw new Error('无法生成预测：未配置可用平台');
  }

  return {
    version: lastResult.version,
    forecastRows: totalForecastRows,
    reviewRows: totalReviewRows,
    eligibilityStats: mergedEligibilityStats,
    platformsGenerated: [...platforms],
  };
}

async function generateBaselineForStationPlatform(input: {
  station: string;
  platform: string;
  category?: string;
  skuCode?: string;
  versionName?: string;
  monthCount?: number;
  today?: Date;
  createdBy?: string;
  algoMode?: ForecastAlgoMode;
  existingVersionId?: string;
  useGlobalVersion?: boolean;
  purgeSkuScope?: boolean;
  purgePlatformScope?: 'all' | 'current';
  forceNewVersion?: boolean;
}) {
  const station = resolveForecastGenerationStation(input.station);
  const platform = normalizeSalesPlatform(input.platform);
  const categoryFilter = input.category?.trim() || undefined;
  const skuCodeFilter = input.skuCode?.trim().toUpperCase() || undefined;
  let version = input.existingVersionId ? await getForecastVersionById(input.existingVersionId) : null;
  if (input.existingVersionId && !version) {
    throw new Error('Forecast version not found');
  }
  if (!version) {
    version = input.versionName
      ? await findOrCreateDraftVersionByName({
          versionName: input.versionName,
          station: input.useGlobalVersion ? undefined : station,
          createdBy: input.createdBy,
          reuseExisting: !input.forceNewVersion,
        })
      : input.forceNewVersion
        ? await getOrCreateDraftVersion({
            versionName: input.versionName,
            station: input.useGlobalVersion ? undefined : station,
            createdBy: input.createdBy,
          })
        : await findOrCreateDraftVersionForImport(input.useGlobalVersion ? undefined : station);
  }
  const today = input.today ?? new Date();
  const algoMode = input.algoMode ?? resolveForecastAlgoMode();
  const useMonthlyAbcd = isMonthlyAbcdAlgoMode(algoMode);
  const useAllCatV41 = isAllCatV41AlgoMode(algoMode);
  const calibration = loadForecastCalibrationConfig();
  const profileConfig = calibration.profile;
  const aCoreConfig = calibration.aCore;
  const horizon = buildMonthlyForecastHorizon(today, input.monthCount ?? 12);
  const warehouseStationByCode = await loadWarehouseStationMap();
  if (!useMonthlyAbcd && !useAllCatV41) {
    await rebuildSeasonalityFromSalesHistoryMonthly({ createdBy: input.createdBy, asOf: today }).catch((err) => {
      console.warn('[forecast] seasonality rebuild skipped:', err instanceof Error ? err.message : err);
    });
  }
  const seasonalityLookup =
    useMonthlyAbcd || useAllCatV41 ? new Map() : await loadSeasonalityLookup();
  let skuRows = await db
    .select({
      id: skus.id,
      code: skus.code,
      category: skus.category,
      productCategory: skus.productCategory,
      forceForecast: skus.forceForecast,
    })
    .from(skus)
    .where(eq(skus.isActive, true));

  if (categoryFilter) {
    const salesCategoryBySku = await loadLatestSalesHistoryCategoryBySkuIds(skuRows.map((sku) => sku.id));
    skuRows = skuRows.filter((sku) =>
      skuMatchesCategoryFilter(
        resolveEffectiveSkuCategory(sku.category, salesCategoryBySku.get(sku.id)),
        categoryFilter,
      ),
    );
  }

  if (skuCodeFilter) {
    skuRows = skuRows.filter((sku) => sku.code.trim().toUpperCase() === skuCodeFilter);
    if (skuRows.length === 0) {
      throw new Error(`SKU ${input.skuCode?.trim()} 不存在、未启用，或与所选品类不匹配`);
    }
  }

  if (!input.purgeSkuScope) {
    if (input.purgePlatformScope === 'all') {
      await purgeForecastVersionScope(version.id, { station, platform: 'ALL' });
    } else if (input.purgePlatformScope === 'current') {
      await purgeForecastVersionScope(version.id, { station, platform });
    }
  }

  if (input.purgeSkuScope && skuRows.length > 0) {
    await purgeSkuForecastScopeForVersion(
      version.id,
      skuRows.map((sku) => sku.id),
    );
  }

  let forecastRows = 0;
  let reviewRows = 0;
  const highValueCandidates: Array<{
    skuId: string;
    skuCode: string;
    recent90Total: number;
    suggestedDailyAvg: number;
  }> = [];

  const recentWindowEnd = effectiveRecentWindowEnd(today);
  const lookbackFrom = toDateOnly(addDays(today, -DEFAULT_SALES_HISTORY_LOOKBACK_DAYS));
  const lookbackTo = toDateOnly(today);
  const monthlyCutoff = subtractMonthsUtc(today, DEFAULT_MONTHLY_HISTORY_LOOKBACK_MONTHS);
  const monthlyMaxYear = recentWindowEnd.getUTCFullYear();
  const monthlyMaxMonth = recentWindowEnd.getUTCMonth() + 1;
  const skuIds = skuRows.map((sku) => sku.id);
  const [dailyBySku, monthlyBySku, firstSaleBySku] = await Promise.all([
    loadDailySalesBySkuIdsInRange({
      skuIds,
      fromDate: lookbackFrom,
      toDate: lookbackTo,
      platform,
    }),
    loadMonthlySalesBySkuIds({
      skuIds,
      platform,
      minYear: monthlyCutoff.getUTCFullYear(),
      minMonth: monthlyCutoff.getUTCMonth() + 1,
      maxYear: monthlyMaxYear,
      maxMonth: monthlyMaxMonth,
    }),
    loadFirstSaleDateBySkuIds({
      skuIds,
      platform,
    }),
  ]);

  const recent30Since = addDays(recentWindowEnd, -29);
  const recent90Since = addDays(recentWindowEnd, -89);
  const recent90BySkuId = new Map<string, number>();

  for (const sku of skuRows) {
    const rawSalesRows = filterSalesRowsByStation(
      dailyBySku.get(sku.id) ?? [],
      station,
      warehouseStationByCode,
    );
    const stockoutExcluded = collectStockoutExcludedDates(
      rawSalesRows,
      recent90Since,
      recentWindowEnd,
    );
    const salesRows = filterSalesRowsExcludingDates(rawSalesRows, stockoutExcluded);
    recent90BySkuId.set(sku.id, roundDaily(sumQtySince(salesRows, recent90Since) / 90));
  }

  const categoryRefBySku = computeCategoryReferenceBySku(skuRows, recent90BySkuId);

  const skuPoolSplitDaily = new Map<string, number>();
  let monthlyAbcdCPoolContext: MonthlyAbcdCPoolContext | undefined;
  const skuProfileCache = new Map<
    string,
    ReturnType<typeof resolveSkuProfileSnapshot>
  >();
  const salesTierBySku = new Map<string, SalesTier>();
  const t1SubBySku = new Map<string, T1SubSegment>();
  const cPoolInputs: SkuPoolInput[] = [];

  for (const sku of skuRows) {
    const monthlySalesRows = monthlyBySku.get(sku.id) ?? [];
    const rawMonthlyQty = buildLast12MonthlyQty(monthlySalesRows, recentWindowEnd);
    const categoryRefDaily = categoryRefBySku.get(sku.id) ?? 0;
    const recent90DailyAvg = recent90BySkuId.get(sku.id) ?? 0;
    const profile = resolveSkuProfileSnapshot({
      monthlyQty: rawMonthlyQty,
      asOf: recentWindowEnd,
      recent90DailyAvg,
      layer: 'sku',
      config: profileConfig,
    });
    skuProfileCache.set(sku.id, profile);
    const tierResolved = resolveSalesTierSegment(rawMonthlyQty);
    const salesTier = tierResolved.tier;
    salesTierBySku.set(sku.id, salesTier);
    if (salesTier === 'T1_anchor') {
      t1SubBySku.set(sku.id, resolveT1SubSegment(tierResolved.features));
    }
    if (profile.profileClass === 'C') {
      const cleanedForPool = useMonthlyAbcd
        ? cleanMonthlyQtyForTraining(rawMonthlyQty, {
            categoryMeanQty: categoryRefDaily > 0 ? categoryRefDaily * 30 : undefined,
          }).cleaned
        : rawMonthlyQty;
      cPoolInputs.push({
        skuId: sku.id,
        skuCode: sku.code,
        category: sku.category,
        station,
        platform,
        monthlyQty: cleanedForPool,
        recent90DailyAvg: recent90BySkuId.get(sku.id) ?? 0,
      });
    }
  }

  if (useMonthlyAbcd) {
    monthlyAbcdCPoolContext = buildMonthlyAbcdCPoolContext(cPoolInputs);
  } else {
    for (const [, poolSkus] of groupLongTailSkusByPool(cPoolInputs)) {
      const sample = poolSkus[0];
      if (!sample) continue;
      const poolKey = buildCategoryPoolKey(sample.category, station, platform);
      const poolDaily = computePoolDailyFromSkus(poolSkus);
      const splits = splitPoolForecastToSkus({
        poolKey,
        station,
        platform,
        categoryPath: sample.category ?? '',
        poolDailyForecast: poolDaily,
        skuRows: poolSkus,
      });
      for (const split of splits) {
        skuPoolSplitDaily.set(split.skuId, split.forecastDailyAvg);
      }
    }
  }

  const forecastDrafts: ForecastMonthlyDraft[] = [];
  const reviewDrafts: ReviewItemDraft[] = [];
  const eligibilityStats = emptyEligibilityStats();
  const generationStartedAt = Date.now();

  for (const sku of skuRows) {
    const rawSalesRows = filterSalesRowsByStation(
      dailyBySku.get(sku.id) ?? [],
      station,
      warehouseStationByCode,
    );
    const stockoutExcluded = collectStockoutExcludedDates(
      rawSalesRows,
      recent90Since,
      recentWindowEnd,
    );
    const salesRows = filterSalesRowsExcludingDates(rawSalesRows, stockoutExcluded);
    const monthlySalesRows = monthlyBySku.get(sku.id) ?? [];
    const firstSaleDate = firstSaleBySku.get(sku.id) ?? null;

    const platformLookbackQty = salesRows.reduce((sum, row) => sum + row.qtySold, 0);
    if (platformLookbackQty <= 0 && !(sku.forceForecast ?? false)) {
      continue;
    }

    const recent30DailyAvg = roundDaily(sumQtySince(salesRows, recent30Since) / 30);
    const recent90DailyAvg = recent90BySkuId.get(sku.id) ?? 0;
    const salesDays90 = countSalesDaysSince(salesRows, recent90Since);
    const salesDays365 = countSalesDaysSince(
      salesRows,
      addDays(recentWindowEnd, -DEFAULT_SALES_HISTORY_LOOKBACK_DAYS),
    );
    const ageDays = computeAgeDaysFromFirstSale(firstSaleDate, today);
    const maxZeroRunDays = computeMaxZeroRunDays(rawSalesRows, recent90Since, recentWindowEnd);
    const lifecycle = classifySalesLifecycle({
      ageDays,
      salesDayRatio90: salesDays90 / 90,
      recent30DailyAvg,
      recent90DailyAvg,
      maxZeroRunDays,
    });

    const eligibility = evaluateForecastEligibility({
      recent30DailyAvg,
      recent90DailyAvg,
      salesDays365,
      forceForecast: sku.forceForecast ?? false,
    });
    if (!eligibility.eligible) {
      eligibilityStats.skipped += 1;
      reviewDrafts.push({
        skuId: sku.id,
        station,
        platform,
        issueType: 'forecast_skipped',
        severity: 'info',
        message: `${sku.code} 近 90 天无销量且历史不足，已跳过预测生成`,
        suggestedDailyAvg: 0,
      });
      continue;
    }
    eligibilityStats.eligible += 1;
    eligibilityStats.byTier[eligibility.tier] += 1;

    if (useAllCatV41) {
      const productCategory = resolveAllCatProductCategory(sku.productCategory ?? sku.category);
      const anchorV41 = computeAllCatV41ForecastForMonth({
        productCategory: sku.productCategory ?? sku.category,
        platform,
        forecastYear: horizon[0]?.forecastYear ?? today.getUTCFullYear(),
        forecastMonth: horizon[0]?.month ?? today.getUTCMonth() + 1,
        horizonIndex: 0,
        monthlyRows: monthlySalesRows,
        recent30DailyAvg,
        recent90DailyAvg,
        historyCapEnd: recentWindowEnd,
      });
      const anchorTier = anchorV41.tier;
      const anchorForecastable = isAllCatV41Forecastable(anchorTier);
      let wroteForecast = false;
      let v41GhostReviewPushed = false;

      if (
        (anchorTier === 'T4A' || anchorTier === 'T4B') &&
        !(sku.forceForecast ?? false) &&
        isAllCatV41RecentSalesAbsent({
          recent30DailyAvg,
          recent90DailyAvg,
          metrics: anchorV41.metrics,
          tier: anchorTier === 'T4A' || anchorTier === 'T4B' ? anchorTier : undefined,
        })
      ) {
        eligibilityStats.skipped += 1;
        reviewDrafts.push({
          skuId: sku.id,
          station,
          platform,
          issueType: 'forecast_skipped',
          severity: 'info',
          message: `${sku.code} ${anchorTier} 近端零销，已跳过保底预测（ghost 防控）`,
          suggestedDailyAvg: 0,
        });
        continue;
      }

      for (const [horizonIndex, horizonMonth] of horizon.entries()) {
        const v41 = computeAllCatV41ForecastForMonth({
          productCategory: sku.productCategory ?? sku.category,
          platform,
          forecastYear: horizonMonth.forecastYear,
          forecastMonth: horizonMonth.month,
          horizonIndex,
          monthlyRows: monthlySalesRows,
          recent30DailyAvg,
          recent90DailyAvg,
          historyCapEnd: recentWindowEnd,
        });

        if (!anchorForecastable) {
          forecastDrafts.push({
            skuId: sku.id,
            station,
            platform,
            forecastYear: horizonMonth.forecastYear,
            month: horizonMonth.month,
            baselineDailyAvg: 0,
            forecastDailyAvg: 0,
            lifecycle,
            confidenceLevel: v41.confidenceLevel,
            versionId: version.id,
            horizonFactors: v41.horizonFactors,
            forecastProfileClass: productCategory,
            profileSegment: anchorTier,
            horizonBand: v41.horizonBand,
            continuity12m: v41.metrics.active12 / 12,
            cv12m: v41.metrics.cv6,
            forecastDailyP10: 0,
            forecastDailyP90: 0,
            forecastModel: ALLCAT_V41_MODEL,
          });
          continue;
        }
        if (v41.forecastDaily <= 0) {
          if (
            !v41GhostReviewPushed &&
            (anchorTier === 'T4A' || anchorTier === 'T4B') &&
            v41.horizonFactors.zeroSalesGhostGate === true &&
            !(sku.forceForecast ?? false)
          ) {
            v41GhostReviewPushed = true;
            reviewDrafts.push({
              skuId: sku.id,
              station,
              platform,
              issueType: 'forecast_skipped',
              severity: 'info',
              message: `${sku.code} ${anchorTier} 近端零销，已跳过保底预测（ghost 防控）`,
              suggestedDailyAvg: 0,
            });
          }
          continue;
        }

        wroteForecast = true;
        forecastDrafts.push({
          skuId: sku.id,
          station,
          platform,
          forecastYear: horizonMonth.forecastYear,
          month: horizonMonth.month,
          baselineDailyAvg: v41.baseDaily,
          forecastDailyAvg: v41.forecastDaily,
          lifecycle,
          confidenceLevel: v41.confidenceLevel,
          versionId: version.id,
          horizonFactors: v41.horizonFactors,
          forecastProfileClass: productCategory,
          profileSegment: anchorTier,
          horizonBand: v41.horizonBand,
          continuity12m: v41.metrics.active12 / 12,
          cv12m: v41.metrics.cv6,
          forecastDailyP10: v41.forecastDailyP10,
          forecastDailyP90: v41.forecastDailyP90,
          forecastModel: ALLCAT_V41_MODEL,
        });
      }

      if (!anchorForecastable) {
        reviewDrafts.push({
          skuId: sku.id,
          station,
          platform,
          issueType: 'forecast_skipped',
          severity: wroteForecast ? 'warning' : 'info',
          message: buildT99ReviewMessage({
            skuCode: sku.code,
            productCategory,
            platform,
            metrics: anchorV41.metrics,
          }),
          suggestedDailyAvg: 0,
        });
      }
      continue;
    }

    const rawCategoryRef = categoryRefBySku.get(sku.id);
    const categoryReferenceDailyAvg = shouldUseCategoryReference({
      lifecycle,
      recent30DailyAvg,
      recent90DailyAvg,
    })
      ? rawCategoryRef
      : undefined;
    const yoyAnchorDailyAvg = computeYoyAnchorDailyAvg(
      monthlySalesRows,
      recentWindowEnd.getUTCFullYear(),
      recentWindowEnd.getUTCMonth() + 1,
    );
    const rawMonthlyQtyLoop = buildLast12MonthlyQty(monthlySalesRows, recentWindowEnd);
    const monthlyQty = useMonthlyAbcd
      ? cleanMonthlyQtyForTraining(rawMonthlyQtyLoop, {
          categoryMeanQty:
            (categoryRefBySku.get(sku.id) ?? 0) > 0
              ? (categoryRefBySku.get(sku.id) ?? 0) * 30
              : undefined,
        }).cleaned
      : rawMonthlyQtyLoop;
    const profileInfo =
      skuProfileCache.get(sku.id) ??
      resolveSkuProfileSnapshot({
        monthlyQty,
        asOf: recentWindowEnd,
        recent90DailyAvg,
        layer: 'sku',
        config: profileConfig,
      });

    if (profileInfo.profileClass === 'D' && recent90DailyAvg <= 0 && recent30DailyAvg <= 0 && !(sku.forceForecast ?? false)) {
      eligibilityStats.skipped += 1;
      reviewDrafts.push({
        skuId: sku.id,
        station,
        platform,
        issueType: 'forecast_skipped',
        severity: 'info',
        message: `${sku.code} D 类问题款近 90 天无销量，已跳过保底预测（ghost 防控）`,
        suggestedDailyAvg: 0,
      });
      continue;
    }

    const salesTier = salesTierBySku.get(sku.id) ?? resolveSalesTierSegment(rawMonthlyQtyLoop).tier;
    if (!shouldForecastSalesTier(salesTier) && !(sku.forceForecast ?? false)) {
      eligibilityStats.skipped += 1;
      if (getForecastPhase() === 'attack') {
        reviewDrafts.push({
          skuId: sku.id,
          station,
          platform,
          issueType: 'forecast_skipped',
          severity: 'info',
          message: `${sku.code} 非 T1 主攻层（${salesTier}），主攻阶段跳过预测`,
          suggestedDailyAvg: 0,
        });
      }
      continue;
    }

    let categoryTrendApplied = true;
    let categoryTrendFactor: number | undefined;
    let seasonalityWasClipped = false;
    let forecastDailyAvgSum = 0;
    let baselineDailyAvgForReview = 0;
    let hasLastYearSameMonth = false;

    for (const [horizonIndex, horizonMonth] of horizon.entries()) {
      const lastYearSameMonthDailyAvg = resolveEffectiveLastYearDailyAvg({
        dailyRows: salesRows,
        monthlyRows: monthlySalesRows,
        forecastYear: horizonMonth.forecastYear,
        month: horizonMonth.month,
      });
      if (lastYearSameMonthDailyAvg > 0) {
        hasLastYearSameMonth = true;
      }

      const seasonality = useMonthlyAbcd
        ? { seasonalityFactor: 1, trendFactor: 1 }
        : resolveSeasonalityFactors(
            seasonalityLookup,
            sku.category,
            horizonMonth.month,
          );
      const rawCombined = seasonality.seasonalityFactor * seasonality.trendFactor;
      const horizonBand = horizonBandFromIndex(horizonIndex);

      let forecastDailyP10: number | undefined;
      let forecastDailyP90: number | undefined;
      let monthly: ReturnType<typeof computeForecastDailyAvgForMonth>;
      let forecastModel: string | undefined;
      if (useMonthlyAbcd) {
        const poolKey = buildCategoryPoolKey(sku.category, station, platform);
        const abcd = computeMonthlyAbcdForecastDailyAvg({
          profileClass: salesTier === 'T1_anchor' ? 'A' : profileInfo.profileClass,
          salesTier:
            salesTier === 'T1_anchor' ||
            salesTier === 'T2_stable' ||
            salesTier === 'T3_seasonal'
              ? salesTier
              : undefined,
          t1SubSegment:
            salesTier === 'T1_anchor' ? t1SubBySku.get(sku.id) : undefined,
          monthlyQty,
          rawMonthlyQty: rawMonthlyQtyLoop,
          horizonIndex,
          forecastYear: horizonMonth.forecastYear,
          forecastMonth: horizonMonth.month,
          poolMonthlyQty:
            profileInfo.profileClass === 'C'
              ? monthlyAbcdCPoolContext?.poolMonthlyQtyByKey.get(poolKey)
              : undefined,
          poolShare:
            profileInfo.profileClass === 'C'
              ? monthlyAbcdCPoolContext?.poolShareBySkuId.get(sku.id)
              : undefined,
          recent30DailyAvg,
          recent90DailyAvg,
          lastYearSameMonthDailyAvg,
          yoyAnchorDailyAvg,
          lifecycle,
          profileSegment: salesTier === 'T1_anchor' ? 'A:core' : profileInfo.segment,
          volumeTier: salesTier === 'T1_anchor' ? 'core' : profileInfo.volumeTier,
          aCoreConfig,
          categoryP25DailyAvg: sku.forceForecast ? 0.05 : 0,
          cv12m: profileInfo.cv,
          seasonalityFactor: seasonality.seasonalityFactor,
          forceForecast: sku.forceForecast ?? false,
        });
        monthly = {
          baselineDailyAvg: abcd.baselineDailyAvg,
          forecastDailyAvg: abcd.forecastDailyAvg,
          categoryTrendApplied: true,
          combinedTrendFactor: 1,
          skuTrendFactor: 1,
          seasonalityWasClipped: false,
          horizonFactors: {
            nearLevel: abcd.forecastDailyAvg,
            structuralLevel: abcd.forecastDailyAvg,
            yoyMonthLevel: 0,
            yoyAnchorLevel: 0,
            growthFactor: 1,
            wNear: 1,
            wYoy: 0,
            horizonMonthIndex: horizonIndex,
          },
        };
        forecastModel = abcd.model;
        forecastDailyP10 = abcd.forecastDailyP10;
        forecastDailyP90 = abcd.forecastDailyP90;
      } else if (profileInfo.profileClass === 'D') {
        const floorDaily = computeFloorForecast({
          recent90DailyAvg,
          categoryP25: sku.forceForecast ? 0.05 : 0,
        });
        monthly = {
          baselineDailyAvg: floorDaily,
          forecastDailyAvg: floorDaily,
          categoryTrendApplied: true,
          combinedTrendFactor: 1,
          skuTrendFactor: 1,
          seasonalityWasClipped: false,
          horizonFactors: {
            nearLevel: floorDaily,
            structuralLevel: floorDaily,
            yoyMonthLevel: 0,
            yoyAnchorLevel: 0,
            growthFactor: 1,
            wNear: 1,
            wYoy: 0,
            horizonMonthIndex: horizonIndex,
          },
        };
      } else if (profileInfo.profileClass === 'C') {
        const poolBase = skuPoolSplitDaily.get(sku.id) ?? recent90DailyAvg;
        const clipped = clipCombinedSeasonality(rawCombined);
        const forecastDailyAvg = roundDaily(poolBase * clipped.factor);
        monthly = {
          baselineDailyAvg: roundDaily(poolBase),
          forecastDailyAvg,
          categoryTrendApplied: rawCombined !== 1,
          combinedTrendFactor: clipped.factor,
          skuTrendFactor: 1,
          seasonalityWasClipped: clipped.wasClipped,
          horizonFactors: {
            nearLevel: poolBase,
            structuralLevel: poolBase,
            yoyMonthLevel: 0,
            yoyAnchorLevel: 0,
            growthFactor: 1,
            wNear: 1,
            wYoy: 0,
            horizonMonthIndex: horizonIndex,
          },
        };
      } else if (profileInfo.profileClass === 'B') {
        const bPoint = computeBClassPointForecast({
          recent90DailyAvg,
          monthlyRows: monthlySalesRows,
          calendarMonth: horizonMonth.month,
          seasonalityFactor: seasonality.seasonalityFactor,
        });
        monthly = computeForecastDailyAvgForMonth({
          recent30DailyAvg,
          recent90DailyAvg,
          lastYearSameMonthDailyAvg,
          categoryReferenceDailyAvg,
          lifecycle,
          horizonMonthIndex: horizonIndex,
          calendarMonth: horizonMonth.month,
          monthlyRows: monthlySalesRows,
          yoyAnchorDailyAvg,
          refYear: recentWindowEnd.getUTCFullYear(),
          refMonth: recentWindowEnd.getUTCMonth() + 1,
          seasonalityFactor: seasonality.seasonalityFactor,
          trendFactor: seasonality.trendFactor,
          profileClass: profileInfo.profileClass,
          volumeTier: profileInfo.volumeTier,
          aCoreConfig,
        });
        monthly = {
          ...monthly,
          forecastDailyAvg: bPoint,
          baselineDailyAvg: roundDaily(recent90DailyAvg || bPoint),
        };
      } else {
        monthly = computeForecastDailyAvgForMonth({
          recent30DailyAvg,
          recent90DailyAvg,
          lastYearSameMonthDailyAvg,
          categoryReferenceDailyAvg,
          lifecycle,
          horizonMonthIndex: horizonIndex,
          calendarMonth: horizonMonth.month,
          monthlyRows: monthlySalesRows,
          yoyAnchorDailyAvg,
          refYear: recentWindowEnd.getUTCFullYear(),
          refMonth: recentWindowEnd.getUTCMonth() + 1,
          seasonalityFactor: seasonality.seasonalityFactor,
          trendFactor: seasonality.trendFactor,
          profileClass: profileInfo.profileClass,
          volumeTier: profileInfo.volumeTier,
          aCoreConfig,
        });
      }

      if (!useMonthlyAbcd) {
        if (profileInfo.profileClass === 'B') {
          const band = computeResidualInterval({
            forecastDailyAvg: monthly.forecastDailyAvg,
            cv12m: profileInfo.cv,
            profileSegment: profileInfo.segment,
            calendarMonth: horizonMonth.month,
          });
          forecastDailyP10 = band.p10;
          forecastDailyP90 = band.p90;
          forecastModel = 'residual_band';
        } else if (profileInfo.profileClass === 'C') {
          forecastModel = 'aggregate_split';
        } else if (profileInfo.profileClass === 'D') {
          forecastModel = 'floor_only';
        } else if (profileInfo.profileClass === 'A') {
          forecastModel = 'near_anchor';
        }
      }

      if (!monthly.categoryTrendApplied && rawCombined !== 1) {
        categoryTrendApplied = false;
        categoryTrendFactor ??= rawCombined;
      }
      if (monthly.seasonalityWasClipped) {
        seasonalityWasClipped = true;
        categoryTrendFactor ??= rawCombined;
      }

      if (baselineDailyAvgForReview === 0) {
        baselineDailyAvgForReview = monthly.baselineDailyAvg;
      }
      forecastDailyAvgSum += monthly.forecastDailyAvg;

      const confidenceLevel =
        recent90DailyAvg > 0 && hasLastYearSameMonth && !monthly.seasonalityWasClipped
          ? 'high'
          : recent90DailyAvg > 0
            ? 'medium'
            : 'low';

      forecastDrafts.push({
        skuId: sku.id,
        station,
        platform,
        forecastYear: horizonMonth.forecastYear,
        month: horizonMonth.month,
        baselineDailyAvg: monthly.baselineDailyAvg,
        forecastDailyAvg: monthly.forecastDailyAvg,
        lifecycle,
        confidenceLevel,
        versionId: version.id,
        horizonFactors: monthly.horizonFactors,
        forecastProfileClass: profileInfo.profileClass,
        profileSegment: profileInfo.segment,
        horizonBand,
        continuity12m: profileInfo.continuity,
        cv12m: profileInfo.cv,
        forecastDailyP10,
        forecastDailyP90,
        forecastModel,
      });
    }

    const suggestedDailyAvg =
      horizon.length > 0 ? roundDaily(forecastDailyAvgSum / horizon.length) : 0;

    reviewDrafts.push(
      ...buildReviewItemsForForecast({
        skuId: sku.id,
        skuCode: sku.code,
        station,
        platform,
        lifecycle,
        baselineDailyAvg: baselineDailyAvgForReview,
        suggestedDailyAvg,
        hasEnoughHistory:
          recent90DailyAvg > 0 && salesDays90 >= 7 && salesDays365 >= 30,
        categoryTrendApplied,
        categoryTrendFactor,
        seasonalityWasClipped,
        profileClass: profileInfo.profileClass,
        volumeTier: profileInfo.volumeTier,
        maxHorizonMonthIndex: horizon.length - 1,
      }),
    );

    if (recent90DailyAvg > 0) {
      highValueCandidates.push({
        skuId: sku.id,
        skuCode: sku.code,
        recent90Total: recent90DailyAvg * 90,
        suggestedDailyAvg:
          horizon.length > 0 ? roundDaily(forecastDailyAvgSum / horizon.length) : recent90DailyAvg,
      });
    }
  }

  await flushForecastMonthlyRows(forecastDrafts);
  forecastRows = forecastDrafts.length;

  for (const item of reviewDrafts) {
    await upsertReviewItem(version.id, item);
    reviewRows++;
  }

  const generationMs = Date.now() - generationStartedAt;
  if (skuRows.length > 0) {
    console.info(
      `[forecast] baseline generated ${forecastRows} rows for ${skuRows.length} skus in ${generationMs}ms`,
    );
  }

  const highValueThreshold = Math.max(50, Math.ceil(highValueCandidates.length * 0.05));
  const topHighValue = [...highValueCandidates]
    .sort((a, b) => b.recent90Total - a.recent90Total)
    .slice(0, highValueThreshold);

  for (const candidate of topHighValue) {
    await upsertReviewItem(version.id, {
      skuId: candidate.skuId,
      station,
      platform,
      issueType: 'high_value',
      severity: 'critical',
      message: `${candidate.skuCode} 为高销量 SKU（近 90 天约 ${Math.round(candidate.recent90Total)} 件），建议复核系统预测日均 ${candidate.suggestedDailyAvg.toFixed(2)}（生命周期基线 × SKU 趋势 × 品类系数，非简单 90 天均值）。`,
      suggestedDailyAvg: candidate.suggestedDailyAvg,
    });
    reviewRows++;
  }

  return {
    version,
    forecastRows,
    reviewRows,
    eligibilityStats,
    platformsGenerated: [platform],
  };
}

export async function prepareWalkForwardVersion(input: {
  versionName: string;
  station?: string;
  platform?: string;
  createdBy?: string;
  replaceVersion: boolean;
}): Promise<string | undefined> {
  if (!input.replaceVersion) return undefined;
  const station = input.station?.trim().toUpperCase();
  const platform = input.platform?.trim() ? normalizeSalesPlatform(input.platform) : undefined;
  const version = await findOrCreateDraftVersionByName({
    versionName: input.versionName,
    station,
    createdBy: input.createdBy,
    reuseExisting: true,
  });
  await purgeForecastVersionScope(version.id, {
    station,
    platform: platform === 'ALL' || !platform ? 'ALL' : platform,
  });
  return version.id;
}

async function findOrCreateDraftVersionByName(input: {
  versionName: string;
  station?: string;
  createdBy?: string;
  reuseExisting?: boolean;
}) {
  const station = input.station?.trim().toUpperCase();
  if (input.reuseExisting !== false) {
    const [existing] = await db
      .select()
      .from(salesForecastVersions)
      .where(
        and(
          eq(salesForecastVersions.versionNo, input.versionName),
          station ? eq(salesForecastVersions.station, station) : isNull(salesForecastVersions.station),
          eq(salesForecastVersions.status, 'draft'),
        ),
      )
      .limit(1);

    if (existing) return existing;
  }

  const versionNo = await allocateUniqueDraftVersionName(input.versionName, station);
  return getOrCreateDraftVersion({
    versionNo,
    versionName: versionNo,
    station,
    createdBy: input.createdBy,
  });
}

function roundFactor(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.round(value * 10_000) / 10_000;
}

function buildForecastSourceBatchNo(now = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `FS-${stamp}`;
}

function formatDateOnly(value?: string | Date | null): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
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

function warehouseCodesForStation(
  station: string,
  warehouseStationByCode: Map<string, string>,
): string[] {
  const targetStation = station.toUpperCase();
  return [...warehouseStationByCode.entries()]
    .filter(([, code]) => code === targetStation)
    .map(([warehouseCode]) => warehouseCode);
}

function subtractMonthsUtc(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
}

const FORECAST_FLUSH_SIZE = 500;

type ForecastMonthlyDraft = {
  skuId: string;
  station: string;
  platform: string;
  forecastYear: number;
  month: number;
  baselineDailyAvg: number;
  forecastDailyAvg: number;
  lifecycle: SalesLifecycle;
  confidenceLevel: 'high' | 'medium' | 'low';
  versionId: string;
  horizonFactors?: HorizonFactorSnapshot;
  forecastProfileClass?: ProfileClass;
  profileSegment?: ProfileSegment;
  horizonBand?: string;
  continuity12m?: number;
  cv12m?: number;
  forecastDailyP10?: number;
  forecastDailyP90?: number;
  forecastModel?: string;
};

async function flushForecastMonthlyRows(rows: ForecastMonthlyDraft[]) {
  for (let offset = 0; offset < rows.length; offset += FORECAST_FLUSH_SIZE) {
    const chunk = rows.slice(offset, offset + FORECAST_FLUSH_SIZE);
    if (!chunk.length) continue;

    for (const row of chunk) {
      await upsertForecastMonthlyRow(row);
    }
  }
}

async function upsertReviewItem(versionId: string, item: ReviewItemDraft) {
  assertForecastWriteAllowed();
  const identity = buildReviewItemIdentity(versionId, item);
  const [existing] = await db
    .select({ id: salesForecastReviewItems.id })
    .from(salesForecastReviewItems)
    .where(
      and(
        eq(salesForecastReviewItems.versionId, identity.versionId),
        eq(salesForecastReviewItems.skuId, identity.skuId),
        eq(salesForecastReviewItems.station, identity.station),
        eq(salesForecastReviewItems.platform, identity.platform),
        eq(salesForecastReviewItems.issueType, identity.issueType),
      ),
    )
    .limit(1);

  const values = {
    severity: item.severity,
    message: item.message,
    suggestedDailyAvg:
      item.suggestedDailyAvg != null ? String(item.suggestedDailyAvg) : undefined,
  };

  if (existing) {
    await db
      .update(salesForecastReviewItems)
      .set(values)
      .where(eq(salesForecastReviewItems.id, existing.id));
    return;
  }

  await db.insert(salesForecastReviewItems).values({
    versionId: identity.versionId,
    skuId: identity.skuId,
    station: identity.station,
    platform: identity.platform,
    issueType: identity.issueType,
    ...values,
  });
}

async function upsertForecastMonthlyRow(input: ForecastMonthlyDraft) {
  assertForecastWriteAllowed();
  const [existing] = await db
    .select({ id: salesForecastMonthly.id })
    .from(salesForecastMonthly)
    .where(
      and(
        eq(salesForecastMonthly.skuId, input.skuId),
        eq(salesForecastMonthly.station, input.station),
        eq(salesForecastMonthly.platform, input.platform),
        eq(salesForecastMonthly.forecastYear, input.forecastYear),
        eq(salesForecastMonthly.month, input.month),
        eq(salesForecastMonthly.versionId, input.versionId),
      ),
    )
    .limit(1);

  const values = {
    forecastDailyAvg: String(input.forecastDailyAvg),
    baselineDailyAvg: String(input.baselineDailyAvg),
    lifecycle: input.lifecycle,
    confidenceLevel: input.confidenceLevel,
    horizonFactors: input.horizonFactors ?? null,
    forecastProfileClass: input.forecastProfileClass ?? null,
    profileSegment: input.profileSegment ?? null,
    horizonBand: input.horizonBand ?? null,
    continuity12m:
      input.continuity12m != null ? String(input.continuity12m) : null,
    cv12m: input.cv12m != null ? String(input.cv12m) : null,
    forecastDailyP10:
      input.forecastDailyP10 != null ? String(input.forecastDailyP10) : null,
    forecastDailyP90:
      input.forecastDailyP90 != null ? String(input.forecastDailyP90) : null,
    forecastModel: input.forecastModel ?? null,
    source: 'import' as const,
    versionId: input.versionId,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(salesForecastMonthly).set(values).where(eq(salesForecastMonthly.id, existing.id));
    return;
  }

  await db.insert(salesForecastMonthly).values({
    skuId: input.skuId,
    station: input.station,
    platform: input.platform,
    forecastYear: input.forecastYear,
    month: input.month,
    ...values,
  });
}
