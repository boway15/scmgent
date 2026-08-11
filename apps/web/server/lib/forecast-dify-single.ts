/**
 * T99 / forecast_skipped SKU 单条 Dify LLM 预测：
 * 按版本 startMonth 严格回测组装历史月销 + 品类趋势 + 预测周期 + context_json
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastReviewItems, skus } from '@scm/db';
import {
  buildMonthlyForecastHorizon,
  clipCombinedSeasonality,
  roundDaily,
} from './forecast-baseline.js';
import { loadSeasonalityLookup, resolveSeasonalityFactors } from './forecast-collaboration.js';
import { DRAWER_HISTORY_MONTH_COUNT, MAX_FORECAST_MONTH_COUNT } from './forecast-limits.js';
import { buildHistoryMonthLabels, type ForecastHistoryCell } from './forecast-horizon.js';
import { horizonBandFromIndex } from './forecast-horizon-band.js';
import { mapForecastDailyFields, normalizeSalesPlatform } from './forecast-demand.js';
import { FORECAST_V41_PLATFORM_CODES } from './forecast-platform-scope.js';
import { runSingleSkuForecastWorkflow, type DifySingleSkuForecastRow } from '../integrations/dify-workflows.js';
import { isSalesForecastWorkflowEnabled } from '../integrations/dify.js';
import {
  assertVersionIsDraft,
  getForecastVersionById,
} from './forecast-version.js';
import { loadMonthlySalesBySkuIds } from './sales-history-query.js';
import { resolveAllCatProductCategory, computeAllCatV41ForecastForMonth } from './forecast-allcat-v41.js';
import { resolveForecastGenerationStation } from './forecast-station-scope.js';
import {
  buildAiAssistHorizonFactors,
  serializeExogenousJson,
  validateExogenousAgainstHorizon,
  validateHumanAssistInput,
  type ForecastAssistMode,
  type ForecastExogenousInput,
} from './forecast-exogenous-input.js';
import { isPersistedProfileSegment, resolveAnchorProfileSegment } from './forecast-horizon.js';
import {
  formatForecastStartMonth,
  isForecastStartMonthBacktest,
  resolveForecastStartMonthAsOf,
} from './forecast-start-month.js';
import {
  buildAiAssistSystemReference,
  resolveAiAssistBandEpsilon,
  resolveAiAssistMonthDaily,
} from './forecast-ai-assist-reference.js';

export const AI_ASSIST_START_MONTH_REQUIRED_MESSAGE =
  'AI 辅助预测需要版本开始月；请带开始月重新生成草稿后再试';

export function resolveAiAssistVersionId(versionId: string | null | undefined): string {
  const trimmed = versionId?.trim();
  if (!trimmed) {
    const err = new Error('versionId is required for AI assist forecast');
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  return trimmed;
}

export function resolveAiAssistBacktestAsOf(startMonth: string | null | undefined): Date {
  const trimmed = startMonth?.trim();
  if (!trimmed) {
    const err = new Error(AI_ASSIST_START_MONTH_REQUIRED_MESSAGE);
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  return resolveForecastStartMonthAsOf(trimmed);
}

export function resolveAiAssistHistoryMaxMonth(asOf: Date): { year: number; month: number } {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function resolveAiAssistHistoryStartMonth(asOf: Date): { year: number; month: number } {
  const d = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - DRAWER_HISTORY_MONTH_COUNT, 1),
  );
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function resolveAiAssistHistoryCapEnd(asOf: Date): Date {
  return new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 0));
}

export type AiAssistContextJson = {
  tier: string;
  profileSegment: string | null;
  productCategory: string | null;
  skipReason: string;
  station: string;
  platform: string;
  startMonth: string;
  asOf: string;
  historyCapEnd: string;
  isBacktest: boolean;
};

/** Dify context_json：回测口径字段与原有 tier/station 一并下发 */
export function buildAiAssistContextJson(input: {
  tier: string;
  profileSegment?: string | null;
  productCategory: string | null;
  skipReason: string;
  station: string;
  platform: string;
  startMonth: string;
  asOf: Date;
  historyCapEnd: Date;
  now?: Date;
}): AiAssistContextJson {
  const startMonth = formatForecastStartMonth(input.asOf);
  return {
    tier: input.tier,
    profileSegment: input.profileSegment ?? null,
    productCategory: input.productCategory,
    skipReason: input.skipReason,
    station: input.station,
    platform: input.platform,
    startMonth: input.startMonth.trim() || startMonth,
    asOf: input.asOf.toISOString().slice(0, 10),
    historyCapEnd: input.historyCapEnd.toISOString().slice(0, 10),
    isBacktest: isForecastStartMonthBacktest(
      input.startMonth.trim() || startMonth,
      input.now ?? new Date(),
    ),
  };
}

export type { ForecastAssistMode, ForecastExogenousInput };

export type DifySingleForecastInput = {
  skuCode: string;
  station: string;
  platform?: string;
  versionId?: string;
  monthCount?: number;
  userId?: string;
  assistMode?: ForecastAssistMode;
  exogenousFactors?: ForecastExogenousInput;
};

export type DifySingleForecastMonth = {
  monthLabel: string;
  forecastYear: number;
  month: number;
  forecastDailyAvg: number;
  confidence?: string;
  rationale?: string;
};

export type DifySingleForecastResult = {
  skuCode: string;
  skuName: string;
  tier: string;
  difyEnabled: boolean;
  rationale: string;
  monthlyForecasts: DifySingleForecastMonth[];
  writtenRows: number;
  missingMonths: string[];
  versionId: string;
};

function monthLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function buildCategoryTrendForHorizon(
  lookup: Awaited<ReturnType<typeof loadSeasonalityLookup>>,
  category: string | null | undefined,
  monthCount: number,
  asOf = new Date(),
) {
  const horizon = buildMonthlyForecastHorizon(asOf, monthCount);
  return horizon.map((h) => {
    const resolved = resolveSeasonalityFactors(lookup, category, h.month);
    const rawCombined = resolved.seasonalityFactor * resolved.trendFactor;
    const clipped = clipCombinedSeasonality(rawCombined);
    return {
      monthLabel: monthLabel(h.forecastYear, h.month),
      forecastYear: h.forecastYear,
      month: h.month,
      seasonalityFactor: resolved.seasonalityFactor,
      trendFactor: resolved.trendFactor,
      combinedFactor: clipped.factor,
    };
  });
}

function buildSalesHistory24(
  monthlyRows: Array<{ saleYear: number; month: number; qtySold: number }>,
  asOf = new Date(),
): ForecastHistoryCell[] {
  const qtyByMonth = new Map<string, number>();
  for (const row of monthlyRows) {
    const key = monthLabel(row.saleYear, row.month);
    qtyByMonth.set(key, (qtyByMonth.get(key) ?? 0) + row.qtySold);
  }
  const labels = buildHistoryMonthLabels(DRAWER_HISTORY_MONTH_COUNT, asOf);
  const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  return labels.map((h) => {
    const qtySold = qtyByMonth.get(h.monthLabel) ?? 0;
    const days = daysInMonth(h.forecastYear, h.month);
    return {
      forecastYear: h.forecastYear,
      month: h.month,
      monthLabel: h.monthLabel,
      qtySold,
      actualDailyAvg: days > 0 ? roundDaily(qtySold / days) : 0,
    };
  });
}

export function parseDifyMonthlyForecastJson(raw: unknown): DifySingleSkuForecastRow[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const rows: DifySingleSkuForecastRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const monthLabel = String(row.monthLabel ?? row.month_label ?? '').trim();
    const forecastDailyAvg = Number(row.forecastDailyAvg ?? row.forecast_daily_avg ?? 0);
    if (!monthLabel || !Number.isFinite(forecastDailyAvg) || forecastDailyAvg < 0) continue;
    rows.push({
      monthLabel,
      forecastDailyAvg: roundDaily(forecastDailyAvg),
      confidence: row.confidence != null ? String(row.confidence) : undefined,
      rationale: row.rationale != null ? String(row.rationale) : undefined,
    });
  }
  return rows;
}

/** 将 AI 全平台预测总量分摊到 V4.1 分平台行，供矩阵聚合读取。 */
export function distributeAiForecastAcrossPlatforms(
  totalValue: number,
  existingByPlatform: Map<string, number>,
): Map<string, number> {
  if (totalValue <= 0) return new Map();
  const platforms = [...existingByPlatform.keys()];
  if (!platforms.length) {
    return new Map([['AMAZON', roundDaily(totalValue)]]);
  }
  if (platforms.length === 1) {
    return new Map([[platforms[0]!, roundDaily(totalValue)]]);
  }
  const currentTotal = platforms.reduce((sum, platform) => sum + (existingByPlatform.get(platform) ?? 0), 0);
  if (currentTotal <= 0) {
    const primary = platforms.includes('AMAZON') ? 'AMAZON' : platforms[0]!;
    return new Map(
      platforms.map((platform) => [platform, platform === primary ? roundDaily(totalValue) : 0]),
    );
  }
  const scale = totalValue / currentTotal;
  return new Map(
    platforms.map((platform) => [platform, roundDaily((existingByPlatform.get(platform) ?? 0) * scale)]),
  );
}

async function loadExistingPlatformForecasts(input: {
  skuId: string;
  station: string;
  versionId: string;
  forecastYear: number;
  month: number;
}): Promise<Map<string, number>> {
  const rows = await db
    .select({
      platform: salesForecastMonthly.platform,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      manualDailyAvg: salesForecastMonthly.manualDailyAvg,
    })
    .from(salesForecastMonthly)
    .where(
      and(
        eq(salesForecastMonthly.skuId, input.skuId),
        eq(salesForecastMonthly.station, input.station),
        eq(salesForecastMonthly.versionId, input.versionId),
        eq(salesForecastMonthly.forecastYear, input.forecastYear),
        eq(salesForecastMonthly.month, input.month),
        inArray(salesForecastMonthly.platform, [...FORECAST_V41_PLATFORM_CODES]),
      ),
    );

  const byPlatform = new Map<string, number>();
  for (const row of rows) {
    const daily = mapForecastDailyFields({
      forecastDailyAvg: row.forecastDailyAvg,
      manualDailyAvg: row.manualDailyAvg,
    });
    byPlatform.set(row.platform, daily.effectiveDailyAvg);
  }
  return byPlatform;
}

type ProfileSegmentPickRow = {
  forecastYear: number;
  month: number;
  platform: string;
  profileSegment: string | null;
};

/** AI 辅助写入时保留原商品分层，仅通过 horizonFactors 标记 AI */
export function resolveAiAssistProfileSegment(input: {
  existingRows: ProfileSegmentPickRow[];
  reviewTier: string | null;
  computedTier: string;
}): string {
  const validRows = input.existingRows.filter((row) => isPersistedProfileSegment(row.profileSegment));
  const fromExisting = resolveAnchorProfileSegment(validRows);
  if (fromExisting) return fromExisting;
  if (input.reviewTier === 'T99') return 'T99';
  return input.computedTier;
}

async function loadExistingProfileSegmentRows(input: {
  skuId: string;
  station: string;
  versionId: string;
}): Promise<ProfileSegmentPickRow[]> {
  return db
    .select({
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      platform: salesForecastMonthly.platform,
      profileSegment: salesForecastMonthly.profileSegment,
    })
    .from(salesForecastMonthly)
    .where(
      and(
        eq(salesForecastMonthly.skuId, input.skuId),
        eq(salesForecastMonthly.station, input.station),
        eq(salesForecastMonthly.versionId, input.versionId),
      ),
    );
}

export async function runDifySingleSkuForecast(
  input: DifySingleForecastInput,
): Promise<DifySingleForecastResult> {
  if (!isSalesForecastWorkflowEnabled()) {
    const err = new Error('Dify 销量预测工作流未配置（DIFY_API_KEY_SALES_FORECAST）');
    (err as Error & { status: number }).status = 503;
    throw err;
  }

  const skuCode = input.skuCode.trim().toUpperCase();
  const station = resolveForecastGenerationStation(input.station);
  const platform = normalizeSalesPlatform(input.platform);
  const monthCount = Math.min(
    MAX_FORECAST_MONTH_COUNT,
    Math.max(1, Math.floor(input.monthCount ?? MAX_FORECAST_MONTH_COUNT)),
  );

  const [sku] = await db
    .select({
      id: skus.id,
      code: skus.code,
      name: skus.name,
      category: skus.category,
      productCategory: skus.productCategory,
    })
    .from(skus)
    .where(eq(skus.code, skuCode))
    .limit(1);

  if (!sku) {
    const err = new Error(`SKU ${skuCode} 不存在`);
    (err as Error & { status: number }).status = 404;
    throw err;
  }

  const versionId = resolveAiAssistVersionId(input.versionId);
  const version = await getForecastVersionById(versionId);
  if (!version) {
    const err = new Error('预测版本不存在');
    (err as Error & { status: number }).status = 404;
    throw err;
  }
  await assertVersionIsDraft(version.id);
  const startMonth = version.startMonth?.trim() || '';
  const asOf = resolveAiAssistBacktestAsOf(startMonth);

  const historyMax = resolveAiAssistHistoryMaxMonth(asOf);
  const historyStart = resolveAiAssistHistoryStartMonth(asOf);
  const monthlyBySku = await loadMonthlySalesBySkuIds({
    skuIds: [sku.id],
    platform,
    minYear: historyStart.year,
    minMonth: historyStart.month,
    maxYear: historyMax.year,
    maxMonth: historyMax.month,
  });
  const monthlyRows = monthlyBySku.get(sku.id) ?? [];
  const salesHistory = buildSalesHistory24(monthlyRows, asOf);
  const seasonalityLookup = await loadSeasonalityLookup();
  const categoryTrend = buildCategoryTrendForHorizon(seasonalityLookup, sku.category, monthCount, asOf);
  const forecastHorizon = buildMonthlyForecastHorizon(asOf, monthCount).map((h) => ({
    monthLabel: monthLabel(h.forecastYear, h.month),
    forecastYear: h.forecastYear,
    month: h.month,
  }));

  const assistMode = input.assistMode ?? 'auto';
  const exogenousFactors = validateHumanAssistInput({
    assistMode,
    exogenousFactors: input.exogenousFactors,
  });
  validateExogenousAgainstHorizon(
    exogenousFactors,
    new Set(forecastHorizon.map((h) => h.monthLabel)),
  );

  const productCategory = resolveAllCatProductCategory(sku.productCategory ?? sku.category);

  const [reviewItem] = await db
    .select({
      message: salesForecastReviewItems.message,
      issueType: salesForecastReviewItems.issueType,
    })
    .from(salesForecastReviewItems)
    .where(
      and(
        eq(salesForecastReviewItems.versionId, version.id),
        eq(salesForecastReviewItems.skuId, sku.id),
        eq(salesForecastReviewItems.station, station),
        eq(salesForecastReviewItems.platform, platform),
        eq(salesForecastReviewItems.issueType, 'forecast_skipped'),
      ),
    )
    .limit(1);

  const reviewTier =
    reviewItem?.message && /T99|no-forecast/i.test(reviewItem.message) ? 'T99' : null;

  const historyCapEnd = resolveAiAssistHistoryCapEnd(asOf);
  const anchorV41 = computeAllCatV41ForecastForMonth({
    productCategory: sku.productCategory ?? sku.category,
    platform,
    forecastYear: forecastHorizon[0]?.forecastYear ?? asOf.getUTCFullYear(),
    forecastMonth: forecastHorizon[0]?.month ?? asOf.getUTCMonth() + 1,
    horizonIndex: 0,
    monthlyRows,
    historyCapEnd,
  });
  const existingProfileRows = await loadExistingProfileSegmentRows({
    skuId: sku.id,
    station,
    versionId: version.id,
  });
  const profileSegment = resolveAiAssistProfileSegment({
    existingRows: existingProfileRows,
    reviewTier,
    computedTier: anchorV41.tier,
  });

  const contextJson = buildAiAssistContextJson({
    tier: reviewTier ?? profileSegment,
    profileSegment,
    productCategory,
    skipReason: reviewItem?.message ?? 'manual AI forecast requested',
    station,
    platform,
    startMonth,
    asOf,
    historyCapEnd,
  });

  const systemReference = buildAiAssistSystemReference({
    profileSegment,
    productCategory,
    platform,
    monthlyRows,
    history: salesHistory,
    categoryTrend,
    forecastHorizon,
    historyCapEnd,
  });

  const workflowResult = await runSingleSkuForecastWorkflow(
    {
      sku_code: sku.code,
      sku_name: sku.name,
      category: sku.category ?? '',
      sales_history_json: JSON.stringify(salesHistory),
      category_trend_json: JSON.stringify(categoryTrend),
      forecast_horizon_json: JSON.stringify(forecastHorizon),
      context_json: JSON.stringify(contextJson),
      system_reference_json: JSON.stringify(systemReference),
      exogenous_json: serializeExogenousJson(exogenousFactors),
    },
    input.userId ?? 'forecast-dify-single',
  );

  const difyByLabel = new Map(workflowResult.monthly.map((row) => [row.monthLabel, row]));
  const refByLabel = new Map(systemReference.months.map((m) => [m.monthLabel, m]));
  const bandEpsilon = resolveAiAssistBandEpsilon((exogenousFactors?.factors.length ?? 0) > 0);

  const monthlyForecasts: DifySingleForecastMonth[] = forecastHorizon.map((h) => {
    const row = difyByLabel.get(h.monthLabel);
    const ref = refByLabel.get(h.monthLabel);
    const resolved = resolveAiAssistMonthDaily({
      difyDaily: row?.forecastDailyAvg,
      ref,
      epsilon: bandEpsilon,
    });
    const fallbackNote =
      resolved.usedFallback && ref
        ? `fallback suggestedBlend (${ref.blendMode})`
        : undefined;
    return {
      monthLabel: h.monthLabel,
      forecastYear: h.forecastYear,
      month: h.month,
      forecastDailyAvg: resolved.forecastDailyAvg,
      confidence: row?.confidence ?? (resolved.usedFallback ? 'medium' : undefined),
      rationale: row?.rationale ?? fallbackNote,
    };
  });

  const missingMonths = monthlyForecasts
    .filter((row) => !(row.forecastDailyAvg > 0))
    .map((row) => row.monthLabel);

  let writtenRows = 0;
  for (const [index, row] of monthlyForecasts.entries()) {
    if (row.forecastDailyAvg <= 0) continue;

    const existingByPlatform =
      normalizeSalesPlatform(platform) === 'ALL'
        ? await loadExistingPlatformForecasts({
            skuId: sku.id,
            station,
            versionId: version.id,
            forecastYear: row.forecastYear,
            month: row.month,
          })
        : new Map([[normalizeSalesPlatform(platform), 0]]);
    const distributed = distributeAiForecastAcrossPlatforms(row.forecastDailyAvg, existingByPlatform);

    const horizonFactors = buildAiAssistHorizonFactors({
      assistMode,
      exogenous: exogenousFactors,
      tier: reviewTier ?? 'SKU',
      reviewTier,
      rationale: row.rationale ?? workflowResult.summary,
      confidence: row.confidence,
    });

    for (const [writePlatform, forecastDailyAvg] of distributed) {
      if (forecastDailyAvg <= 0) continue;

      const [existing] = await db
        .select({ id: salesForecastMonthly.id })
        .from(salesForecastMonthly)
        .where(
          and(
            eq(salesForecastMonthly.skuId, sku.id),
            eq(salesForecastMonthly.station, station),
            eq(salesForecastMonthly.platform, writePlatform),
            eq(salesForecastMonthly.forecastYear, row.forecastYear),
            eq(salesForecastMonthly.month, row.month),
            eq(salesForecastMonthly.versionId, version.id),
          ),
        )
        .limit(1);

      const values = {
        forecastDailyAvg: String(forecastDailyAvg),
        baselineDailyAvg: String(forecastDailyAvg),
        manualDailyAvg: null,
        adjustReason: null,
        confidenceLevel: row.confidence ?? 'low',
        horizonFactors,
        forecastProfileClass: productCategory,
        profileSegment,
        horizonBand: horizonBandFromIndex(index),
        forecastModel: 'dify_single_sku',
        source: 'manual' as const,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(salesForecastMonthly).set(values).where(eq(salesForecastMonthly.id, existing.id));
      } else {
        await db.insert(salesForecastMonthly).values({
          skuId: sku.id,
          station,
          platform: writePlatform,
          forecastYear: row.forecastYear,
          month: row.month,
          versionId: version.id,
          lifecycle: 'manual_review',
          ...values,
        });
      }
      writtenRows += 1;
    }
  }

  return {
    skuCode: sku.code,
    skuName: sku.name,
    tier: profileSegment,
    difyEnabled: true,
    rationale: workflowResult.summary,
    monthlyForecasts,
    writtenRows,
    missingMonths,
    versionId: version.id,
  };
}
