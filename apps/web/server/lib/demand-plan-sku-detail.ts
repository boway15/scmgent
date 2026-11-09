import { and, eq } from 'drizzle-orm';
import {
  db,
  demandPlanVersions,
  demandPlanWeekly,
  salesForecastVersions,
  skus,
  type DemandPlanWeekBlendMeta,
} from '@scm/db';
import { buildDemandPlanPeriodColumns } from './demand-plan-periods.js';
import {
  resolveDemandPlanSkuDetailActualDisplayWindow,
  resolveDemandPlanSkuDetailSalesWindow,
} from './demand-plan-start-week.js';
import { listForecastHorizon, type ForecastHorizonCell } from './forecast-horizon.js';
import { resolvePublishedVersionIdForSku } from './forecast-published-resolve.js';
import { resolveForecastStartMonthAsOf } from './forecast-start-month.js';
import { buildSkuForecastContextMap, formatBaselineWeightsLabel } from './forecast-sku-context.js';
import { computeLifecycleBaselineWeights, type SalesLifecycle } from './forecast-baseline.js';
import { splitMergedWeeklyDailyByPlatform } from './demand-plan-enrich.js';
import { FORECAST_V41_PLATFORM_CODES } from './forecast-platform-scope.js';
import { FORECAST_GLOBAL_STATION } from './forecast-station-scope.js';
import {
  addIsoWeeks,
  isoWeekKeyFromUtcDate,
  isoWeekMondayUtc,
  maxSaleDateKey,
  monthKeyFromUtcDate,
  planningAssumedSalesCutoff,
  planningRecentWindowEnd,
} from './planning-calendar.js';
import { weekWeightedForecastDaily } from './demand-plan-reconstruct.js';
import { loadDailySalesBySkuIdsInRange } from './sales-history-query.js';
import { loadDemandPlanSkuInlineV41Horizon } from './demand-plan-inline-v41.js';
import { loadDemandPlanSkuInlineV41WHorizon } from './demand-plan-inline-v41-w.js';
import { FORECAST_HORIZON_MONTHS } from './forecast-limits.js';
import { forecastMonthKey } from './forecast-demand.js';
import { resolveFlexBiasShadowEnabled } from './forecast-flex-bias-shadow.js';

export const DEMAND_PLAN_SKU_HISTORY_WEEKS = 26;

/** SKU 抽屉历史销量与所选平台同口径；未选或 ALL 为全渠道合计。 */
export function resolveDemandPlanSkuDetailSalesPlatform(platform?: string | null): string {
  return (platform?.trim() || 'ALL').toUpperCase();
}

export type DemandPlanSkuWeeklyActual = {
  weekKey: string;
  qtySold: number;
  actualDailyAvg: number | null;
  inProgress: boolean;
};

export type DemandPlanSkuWeeklyForecast = {
  weekKey: string;
  anchorMonthLabel: string;
  systemDailyAvg: number;
  manualDailyAvg: number | null;
  effectiveDailyAvg: number;
  hasManual: boolean;
  actualDailyAvg: number | null;
  actualInProgress: boolean;
  qtySold: number | null;
  confidenceLevel: string | null;
  baselineDailyAvg: number | null;
  seasonalityFactor: number | null;
  trendFactor: number | null;
  categoryCombinedFactor: number | null;
  categoryTrendWasClipped: boolean;
  categoryTrendMatched: boolean;
  horizonFactors: ForecastHorizonCell['horizonFactors'];
  allCatV41Factors: ForecastHorizonCell['allCatV41Factors'];
  aiAssistRationale: string | null;
  aiAssistMode: 'auto' | 'human' | null;
  planSystemDailyAvg: string | null;
  planEffectiveDailyAvg: string | null;
  planManualDailyAvg: string | null;
  planAdjustReason: string | null;
  planWeekId: string | null;
  planBlendMeta: DemandPlanWeekBlendMeta | null;
  championForecastDaily: string | null;
  planSource: string | null;
};

export type DemandPlanSkuWeeklyPlan = {
  id: string | null;
  weekKey: string;
  systemDailyAvg: string;
  manualDailyAvg: string | null;
  effectiveDailyAvg: string;
  adjustReason: string | null;
  championForecastDaily: string | null;
  source: string;
  blendMeta: DemandPlanWeekBlendMeta | null;
  /** 与计划周对齐的实际销量（回测 / 准确度对照） */
  qtySold: number;
  actualDailyAvg: number | null;
  actualInProgress: boolean;
};

function roundDaily(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function aggregateQtyByWeek(
  dailyRows: Array<{ saleDate: string; qtySold: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of dailyRows) {
    const dateKey = String(row.saleDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    const weekKey = isoWeekKeyFromUtcDate(new Date(`${dateKey}T00:00:00.000Z`));
    map.set(weekKey, (map.get(weekKey) ?? 0) + Number(row.qtySold));
  }
  return map;
}

export function buildRecentHistoryWeekKeys(
  asOf: Date,
  count = DEMAND_PLAN_SKU_HISTORY_WEEKS,
  windowEnd: Date = planningRecentWindowEnd(asOf),
): string[] {
  const endWeek = isoWeekKeyFromUtcDate(windowEnd);
  return Array.from({ length: count }, (_, index) => addIsoWeeks(endWeek, index - (count - 1)));
}

export function buildWeeklyActualFromDaily(input: {
  weekKeys: string[];
  dailyRows: Array<{ saleDate: string; qtySold: number }>;
  windowEnd: Date;
}): DemandPlanSkuWeeklyActual[] {
  const qtyByWeek = aggregateQtyByWeek(input.dailyRows);
  const windowEndWeek = isoWeekKeyFromUtcDate(input.windowEnd);

  return input.weekKeys.map((weekKey) => {
    const qtySold = qtyByWeek.get(weekKey) ?? 0;
    if (weekKey > windowEndWeek) {
      return { weekKey, qtySold, actualDailyAvg: null, inProgress: false };
    }
    if (weekKey === windowEndWeek) {
      const monday = isoWeekMondayUtc(weekKey);
      const days = Math.max(
        1,
        Math.floor((input.windowEnd.getTime() - monday.getTime()) / 86_400_000) + 1,
      );
      return {
        weekKey,
        qtySold,
        actualDailyAvg: roundDaily(qtySold / days),
        inProgress: true,
      };
    }
    return {
      weekKey,
      qtySold,
      actualDailyAvg: roundDaily(qtySold / 7),
      inProgress: false,
    };
  });
}

function anchorMonthLabelForWeek(weekKey: string): string {
  return monthKeyFromUtcDate(isoWeekMondayUtc(weekKey));
}

function weekHasManualMonth(weekKey: string, manualMonths: Set<string>): boolean {
  const monday = isoWeekMondayUtc(weekKey);
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const day = new Date(monday.getTime() + dayOffset * 86_400_000);
    if (manualMonths.has(monthKeyFromUtcDate(day))) return true;
  }
  return false;
}

export function expandMonthlyForecastToWeeks(input: {
  weekKeys: string[];
  monthCells: ForecastHorizonCell[];
  actualByWeek: Map<string, DemandPlanSkuWeeklyActual>;
  planByWeek: Map<string, DemandPlanSkuWeeklyPlan>;
}): DemandPlanSkuWeeklyForecast[] {
  const cellByMonth = new Map(input.monthCells.map((cell) => [cell.monthLabel, cell]));
  const systemMap = new Map<string, number>();
  const effectiveMap = new Map<string, number>();
  const manualMonths = new Set<string>();
  for (const cell of input.monthCells) {
    systemMap.set(cell.monthLabel, cell.forecastDailyAvg);
    effectiveMap.set(cell.monthLabel, cell.effectiveDailyAvg);
    if (cell.manualDailyAvg != null) manualMonths.add(cell.monthLabel);
  }

  return input.weekKeys.map((weekKey) => {
    const anchorMonthLabel = anchorMonthLabelForWeek(weekKey);
    const anchorCell = cellByMonth.get(anchorMonthLabel);
    const actual = input.actualByWeek.get(weekKey);
    const plan = input.planByWeek.get(weekKey);
    return {
      weekKey,
      anchorMonthLabel,
      systemDailyAvg: weekWeightedForecastDaily(weekKey, systemMap),
      manualDailyAvg: anchorCell?.manualDailyAvg ?? null,
      effectiveDailyAvg: weekWeightedForecastDaily(weekKey, effectiveMap),
      hasManual: weekHasManualMonth(weekKey, manualMonths),
      actualDailyAvg: actual?.actualDailyAvg ?? null,
      actualInProgress: actual?.inProgress ?? false,
      qtySold: actual?.qtySold ?? null,
      confidenceLevel: anchorCell?.confidenceLevel ?? null,
      baselineDailyAvg: anchorCell?.baselineDailyAvg ?? null,
      seasonalityFactor: anchorCell?.seasonalityFactor ?? null,
      trendFactor: anchorCell?.trendFactor ?? null,
      categoryCombinedFactor: anchorCell?.categoryCombinedFactor ?? null,
      categoryTrendWasClipped: anchorCell?.categoryTrendWasClipped ?? false,
      categoryTrendMatched: anchorCell?.categoryTrendMatched ?? false,
      horizonFactors: anchorCell?.horizonFactors ?? null,
      allCatV41Factors: anchorCell?.allCatV41Factors ?? null,
      aiAssistRationale: anchorCell?.aiAssistRationale ?? null,
      aiAssistMode: anchorCell?.aiAssistMode ?? null,
      planSystemDailyAvg: plan?.systemDailyAvg ?? null,
      planEffectiveDailyAvg: plan?.effectiveDailyAvg ?? null,
      planManualDailyAvg: plan?.manualDailyAvg ?? null,
      planAdjustReason: plan?.adjustReason ?? null,
      planWeekId: plan?.id ?? null,
      planBlendMeta: plan?.blendMeta ?? null,
      championForecastDaily: plan?.championForecastDaily ?? null,
      planSource: plan?.source ?? null,
    };
  });
}

export async function loadDemandPlanSkuDetail(input: {
  versionId: string;
  skuId: string;
  platform?: string | null;
  station?: string | null;
  asOf?: Date;
}) {
  const asOf = input.asOf ?? new Date();
  const platform = resolveDemandPlanSkuDetailSalesPlatform(input.platform);
  const station = (input.station?.trim() || FORECAST_GLOBAL_STATION).toUpperCase();
  const [version, skuRow, planRows] = await Promise.all([
    db
      .select()
      .from(demandPlanVersions)
      .where(eq(demandPlanVersions.id, input.versionId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: skus.id,
        code: skus.code,
        name: skus.name,
        category: skus.category,
        productCategory: skus.productCategory,
        projectGroup: skus.projectGroup,
        forceForecast: skus.forceForecast,
        lifecycle: skus.lifecycle,
        salesCountry: skus.salesCountry,
        ownerName: skus.ownerName,
        developerName: skus.developerName,
        unit: skus.unit,
        leadTimeDays: skus.leadTimeDays,
        moq: skus.moq,
      })
      .from(skus)
      .where(eq(skus.id, input.skuId))
      .limit(1),
    db
      .select({
        id: demandPlanWeekly.id,
        period: demandPlanWeekly.period,
        systemDailyAvg: demandPlanWeekly.systemDailyAvg,
        manualDailyAvg: demandPlanWeekly.manualDailyAvg,
        adjustReason: demandPlanWeekly.adjustReason,
        championForecastDaily: demandPlanWeekly.championForecastDaily,
        source: demandPlanWeekly.source,
        blendMeta: demandPlanWeekly.blendMeta,
      })
      .from(demandPlanWeekly)
      .where(
        and(eq(demandPlanWeekly.versionId, input.versionId), eq(demandPlanWeekly.skuId, input.skuId)),
      )
      .orderBy(demandPlanWeekly.period),
  ]);

  if (!version) {
    throw Object.assign(new Error('需求计划版本不存在'), { status: 404 });
  }

  const sku = skuRow[0];
  if (!sku) {
    throw Object.assign(new Error('SKU not found'), { status: 404 });
  }

  const forecastVersionId =
    version.championForecastVersionId?.trim() ||
    (await resolvePublishedVersionIdForSku(input.skuId, station));

  const planWeekKeys = buildDemandPlanPeriodColumns(version);
  const salesLoadEnd = planningAssumedSalesCutoff(asOf);
  const provisionalHistoryKeys = buildRecentHistoryWeekKeys(
    asOf,
    DEMAND_PLAN_SKU_HISTORY_WEEKS,
    salesLoadEnd,
  );
  const provisionalWeekKeys = [...new Set([...provisionalHistoryKeys, ...planWeekKeys])].sort();
  const salesFromKey = isoWeekMondayUtc(
    provisionalWeekKeys[0] ?? provisionalHistoryKeys[0]!,
  ).toISOString().slice(0, 10);
  const salesLoadEndKey = salesLoadEnd.toISOString().slice(0, 10);
  const dailyBySku = await loadDailySalesBySkuIdsInRange({
    skuIds: [input.skuId],
    fromDate: salesFromKey,
    toDate: salesLoadEndKey,
    platform,
  });
  const dailyRows = (dailyBySku.get(input.skuId) ?? []).map((row) => ({
    saleDate: row.saleDate,
    qtySold: row.qtySold,
  }));
  const maxSaleDate = maxSaleDateKey(dailyRows);
  const { windowEnd: trainingWindowEnd } = resolveDemandPlanSkuDetailSalesWindow({
    startWeek: version.startWeek,
    now: asOf,
    maxSaleDate,
  });
  const actualDisplayWindowEnd = resolveDemandPlanSkuDetailActualDisplayWindow({
    now: asOf,
    maxSaleDate,
  });
  const historyWeekKeys = buildRecentHistoryWeekKeys(
    asOf,
    DEMAND_PLAN_SKU_HISTORY_WEEKS,
    actualDisplayWindowEnd,
  );
  const salesWeekKeys = [...new Set([...historyWeekKeys, ...planWeekKeys])].sort();
  const actualDisplayEndKey = actualDisplayWindowEnd.toISOString().slice(0, 10);
  const clippedDailyRowsForDisplay = dailyRows.filter(
    (row) => String(row.saleDate).slice(0, 10) <= actualDisplayEndKey,
  );

  const historyWeeks = buildWeeklyActualFromDaily({
    weekKeys: historyWeekKeys,
    dailyRows: clippedDailyRowsForDisplay,
    windowEnd: actualDisplayWindowEnd,
  });
  const actualByWeek = new Map(
    buildWeeklyActualFromDaily({
      weekKeys: salesWeekKeys,
      dailyRows: clippedDailyRowsForDisplay,
      windowEnd: actualDisplayWindowEnd,
    }).map((row) => [row.weekKey, row]),
  );

  const planRowByPeriod = new Map(planRows.map((row) => [row.period, row]));
  const planWeeks: DemandPlanSkuWeeklyPlan[] = planWeekKeys.map((weekKey) => {
    const row = planRowByPeriod.get(weekKey);
    const actual = actualByWeek.get(weekKey);
    return {
      id: row?.id ?? null,
      weekKey,
      systemDailyAvg: row ? String(row.systemDailyAvg) : '0',
      manualDailyAvg: row?.manualDailyAvg != null ? String(row.manualDailyAvg) : null,
      effectiveDailyAvg: row ? String(row.manualDailyAvg ?? row.systemDailyAvg) : '0',
      adjustReason: row?.adjustReason ?? null,
      championForecastDaily:
        row?.championForecastDaily != null ? String(row.championForecastDaily) : null,
      source: row?.source ?? 'missing',
      blendMeta: (row?.blendMeta as DemandPlanWeekBlendMeta | null | undefined) ?? null,
      qtySold: actual?.qtySold ?? 0,
      actualDailyAvg: actual?.actualDailyAvg ?? null,
      actualInProgress: actual?.inProgress ?? false,
    };
  });

  let forecastVersion: { id: string; versionNo: string; versionName: string } | null = null;
  let forecastWeeks: DemandPlanSkuWeeklyForecast[] = [];
  let forecastHorizon: {
    profileSegment: string | null;
    forecastProfileClass: string | null;
    lifecycle: string | null;
    platform: string;
    station: string;
    months: ForecastHorizonCell[];
  } | null = null;
  let forecastContext: Awaited<ReturnType<typeof buildSkuForecastContextMap>>[string] | null = null;

  const forecastHorizonAsOf = version.startMonth?.trim()
    ? resolveForecastStartMonthAsOf(version.startMonth)
    : asOf;

  if (planWeekKeys.length > 0) {
    const identity = { skuId: input.skuId, station, platform };
    const contextKey = `${input.skuId}::${station}::${platform}`;
    const horizonPromise = forecastVersionId
      ? listForecastHorizon({
          versionId: forecastVersionId,
          skuId: input.skuId,
          station,
          platform,
          page: 1,
          pageSize: 1,
          monthCount: 6,
          historyMonthCount: 0,
          asOf: forecastHorizonAsOf,
        })
      : Promise.resolve({
          items: [] as Awaited<ReturnType<typeof listForecastHorizon>>['items'],
        });
    const versionPromise = forecastVersionId
      ? db
          .select({
            id: salesForecastVersions.id,
            versionNo: salesForecastVersions.versionNo,
            versionName: salesForecastVersions.versionName,
          })
          .from(salesForecastVersions)
          .where(eq(salesForecastVersions.id, forecastVersionId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null);
    const contextPromise = forecastVersionId
      ? buildSkuForecastContextMap({ versionId: forecastVersionId, identities: [identity] })
      : Promise.resolve({} as Awaited<ReturnType<typeof buildSkuForecastContextMap>>);

    const [versionRow, horizon, contexts] = await Promise.all([
      versionPromise,
      horizonPromise,
      contextPromise,
    ]);
    forecastContext = forecastVersionId ? (contexts[contextKey] ?? null) : null;

    if (versionRow) {
      forecastVersion = {
        id: versionRow.id,
        versionNo: versionRow.versionNo,
        versionName: versionRow.versionName,
      };
    }

    let horizonItem = horizon.items[0];
    let monthCells = horizonItem?.months ?? [];
    const generationMeta = version.generationMeta;
    const demandSource = generationMeta?.demandForecastSource;
    const useInlineV41WHorizon = demandSource === 'v41_w';
    const useInlineV41Horizon =
      demandSource === 'v41_inline' || (!forecastVersionId && !useInlineV41WHorizon);
    if (useInlineV41WHorizon && sku) {
      const inlineW = await loadDemandPlanSkuInlineV41WHorizon({
        skuId: input.skuId,
        sku: {
          productCategory: sku.productCategory,
          category: sku.category,
          forceForecast: sku.forceForecast,
        },
        windowEnd: trainingWindowEnd,
        horizonWeekKeys: planWeekKeys,
        flexBiasShadow: resolveFlexBiasShadowEnabled(),
      });
      if (inlineW.weekCells.length) {
        forecastContext = {
          lifecycle: (inlineW.lifecycle as SalesLifecycle | null) ?? 'mature',
          weights: computeLifecycleBaselineWeights((inlineW.lifecycle as SalesLifecycle) ?? 'mature'),
          weightsLabel: formatBaselineWeightsLabel(
            computeLifecycleBaselineWeights((inlineW.lifecycle as SalesLifecycle) ?? 'mature'),
          ),
          recent30DailyAvg: inlineW.recent30DailyAvg,
          recent90DailyAvg: inlineW.recent90DailyAvg,
          lastYearSameMonthDailyAvg: 0,
          categoryReferenceDailyAvg: null,
          storedBaselineDailyAvg: inlineW.weekCells[0]?.forecastDailyAvg ?? null,
          profileSegment: inlineW.profileSegment,
          v41WalkForwardFactors: inlineW.weekCells[0]?.allCatV41WFactors ?? null,
        };
      }
    } else if ((useInlineV41Horizon || monthCells.length === 0) && sku) {
      const startMonth = version.startMonth?.trim();
      const horizonMonthKeys: string[] = [];
      if (startMonth) {
        const [year, month] = startMonth.split('-').map(Number);
        for (let i = 0; i < FORECAST_HORIZON_MONTHS; i += 1) {
          const cursor = new Date(Date.UTC(year!, month! - 1 + i, 1));
          horizonMonthKeys.push(
            forecastMonthKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1),
          );
        }
      }
      const inline = await loadDemandPlanSkuInlineV41Horizon({
        skuId: input.skuId,
        sku: {
          productCategory: sku.productCategory,
          category: sku.category,
          projectGroup: sku.projectGroup,
          salesCountry: sku.salesCountry,
          forceForecast: sku.forceForecast,
        },
        windowEnd: trainingWindowEnd,
        horizonMonthKeys,
        flexBiasShadow: resolveFlexBiasShadowEnabled(),
        targetPlatform: platform,
      });
      if (inline.monthCells.length) {
        monthCells = inline.monthCells;
        horizonItem = {
          skuId: input.skuId,
          skuCode: sku.code,
          skuName: sku.name ?? '',
          category: sku.category,
          station,
          platform,
          lifecycle: inline.lifecycle,
          forecastProfileClass: null,
          profileSegment: inline.profileSegment,
          months: monthCells,
          historyMonths: [],
        };
        const inlineLifecycle = (inline.lifecycle as SalesLifecycle | null) ?? 'mature';
        const inlineWeights = computeLifecycleBaselineWeights(inlineLifecycle);
        forecastContext = {
          lifecycle: inlineLifecycle,
          weights: inlineWeights,
          weightsLabel: formatBaselineWeightsLabel(inlineWeights),
          recent30DailyAvg: inline.recent30DailyAvg,
          recent90DailyAvg: inline.recent90DailyAvg,
          lastYearSameMonthDailyAvg: 0,
          categoryReferenceDailyAvg: null,
          storedBaselineDailyAvg: inline.monthCells[0]?.baselineDailyAvg ?? null,
          storedLifecycle: inline.lifecycle,
          forecastProfileClass: null,
          profileSegment: inline.profileSegment,
        };
      }
      if (platform !== 'ALL' && inline.monthByPlatform.size > 0) {
        for (const planRow of planWeeks) {
          const mergedSystem = Number(planRow.systemDailyAvg);
          const mergedManual =
            planRow.manualDailyAvg != null ? Number(planRow.manualDailyAvg) : null;
          const split = splitMergedWeeklyDailyByPlatform({
            period: planRow.weekKey,
            mergedSystemDaily: Number.isFinite(mergedSystem) ? mergedSystem : 0,
            mergedManualDaily:
              mergedManual != null && Number.isFinite(mergedManual) ? mergedManual : null,
            monthByPlatform: inline.monthByPlatform,
            platforms: [...FORECAST_V41_PLATFORM_CODES],
          });
          const match = split.breakdown.find((entry) => entry.platform === platform);
          if (match) {
            planRow.systemDailyAvg = String(match.systemDailyAvg);
            planRow.effectiveDailyAvg = String(match.effectiveDailyAvg);
          } else {
            planRow.systemDailyAvg = '0';
            planRow.effectiveDailyAvg = '0';
          }
        }
      }
    }
    if (horizonItem) {
      forecastHorizon = {
        profileSegment: horizonItem.profileSegment,
        forecastProfileClass: horizonItem.forecastProfileClass,
        lifecycle: horizonItem.lifecycle,
        platform: horizonItem.platform,
        station: horizonItem.station,
        months: monthCells,
      };
    }
    const planByWeek = new Map(planWeeks.map((row) => [row.weekKey, row]));
    forecastWeeks = expandMonthlyForecastToWeeks({
      weekKeys: planWeekKeys,
      monthCells,
      actualByWeek,
      planByWeek,
    });
  }

  return {
    sku,
    platform,
    station,
    planStartWeek: version.startWeek ?? null,
    planHorizonWeeks: version.horizonWeeks ?? planWeekKeys.length,
    historyWeeks,
    planWeeks,
    forecastWeeks,
    forecastVersion,
    forecastHorizon,
    forecastContext,
  };
}
