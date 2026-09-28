import { and, eq } from 'drizzle-orm';
import { db, demandPlanVersions, demandPlanWeekly, salesForecastVersions, skus } from '@scm/db';
import { buildDemandPlanPeriodColumns } from './demand-plan-periods.js';
import { listForecastHorizon, type ForecastHorizonCell } from './forecast-horizon.js';
import { resolvePublishedVersionIdForSku } from './forecast-published-resolve.js';
import { buildSkuForecastContextMap } from './forecast-sku-context.js';
import {
  addIsoWeeks,
  isoWeekKeyFromUtcDate,
  isoWeekMondayUtc,
  monthKeyFromUtcDate,
  planningRecentWindowEnd,
} from './planning-calendar.js';
import { weekWeightedForecastDaily } from './demand-plan-reconstruct.js';
import { loadDailySalesBySkuIdsInRange } from './sales-history-query.js';

export const DEMAND_PLAN_SKU_HISTORY_WEEKS = 26;

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
  championForecastDaily: string | null;
  planSource: string | null;
};

export type DemandPlanSkuWeeklyPlan = {
  weekKey: string;
  systemDailyAvg: string;
  manualDailyAvg: string | null;
  effectiveDailyAvg: string;
  championForecastDaily: string | null;
  source: string;
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

export function buildRecentHistoryWeekKeys(asOf: Date, count = DEMAND_PLAN_SKU_HISTORY_WEEKS): string[] {
  const windowEnd = planningRecentWindowEnd(asOf);
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
      championForecastDaily: plan?.championForecastDaily ?? null,
      planSource: plan?.source ?? null,
    };
  });
}

export async function loadDemandPlanSkuDetail(input: {
  versionId: string;
  skuId: string;
  asOf?: Date;
}) {
  const asOf = input.asOf ?? new Date();
  const windowEnd = planningRecentWindowEnd(asOf);
  const historyWeekKeys = buildRecentHistoryWeekKeys(asOf);
  const [version, skuRow, planRows, forecastVersionId] = await Promise.all([
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
        period: demandPlanWeekly.period,
        systemDailyAvg: demandPlanWeekly.systemDailyAvg,
        manualDailyAvg: demandPlanWeekly.manualDailyAvg,
        championForecastDaily: demandPlanWeekly.championForecastDaily,
        source: demandPlanWeekly.source,
      })
      .from(demandPlanWeekly)
      .where(
        and(eq(demandPlanWeekly.versionId, input.versionId), eq(demandPlanWeekly.skuId, input.skuId)),
      )
      .orderBy(demandPlanWeekly.period),
    resolvePublishedVersionIdForSku(input.skuId),
  ]);

  if (!version) {
    throw Object.assign(new Error('需求计划版本不存在'), { status: 404 });
  }

  const sku = skuRow[0];
  if (!sku) {
    throw Object.assign(new Error('SKU not found'), { status: 404 });
  }

  const planWeekKeys =
    planRows.length > 0 ? planRows.map((row) => row.period) : buildDemandPlanPeriodColumns(version);
  const salesWeekKeys = [...new Set([...historyWeekKeys, ...planWeekKeys])].sort();
  const salesFromKey = isoWeekMondayUtc(salesWeekKeys[0] ?? historyWeekKeys[0]!).toISOString().slice(0, 10);
  const salesToKey = windowEnd.toISOString().slice(0, 10);
  const dailyBySku = await loadDailySalesBySkuIdsInRange({
    skuIds: [input.skuId],
    fromDate: salesFromKey,
    toDate: salesToKey,
    platform: 'ALL',
  });
  const dailyRows = (dailyBySku.get(input.skuId) ?? []).map((row) => ({
    saleDate: row.saleDate,
    qtySold: row.qtySold,
  }));

  const historyWeeks = buildWeeklyActualFromDaily({
    weekKeys: historyWeekKeys,
    dailyRows,
    windowEnd,
  });
  const actualByWeek = new Map(
    buildWeeklyActualFromDaily({ weekKeys: salesWeekKeys, dailyRows, windowEnd }).map((row) => [
      row.weekKey,
      row,
    ]),
  );

  const planWeeks: DemandPlanSkuWeeklyPlan[] = planRows.map((row) => ({
    weekKey: row.period,
    systemDailyAvg: String(row.systemDailyAvg),
    manualDailyAvg: row.manualDailyAvg != null ? String(row.manualDailyAvg) : null,
    effectiveDailyAvg: String(row.manualDailyAvg ?? row.systemDailyAvg),
    championForecastDaily: row.championForecastDaily != null ? String(row.championForecastDaily) : null,
    source: row.source,
  }));

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

  if (forecastVersionId && planWeekKeys.length > 0) {
    const identity = { skuId: input.skuId, station: 'ALL', platform: 'ALL' };
    const contextKey = `${input.skuId}::ALL::ALL`;
    const [versionRow, horizon, contexts] = await Promise.all([
      db
        .select({
          id: salesForecastVersions.id,
          versionNo: salesForecastVersions.versionNo,
          versionName: salesForecastVersions.versionName,
        })
        .from(salesForecastVersions)
        .where(eq(salesForecastVersions.id, forecastVersionId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      listForecastHorizon({
        versionId: forecastVersionId,
        skuId: input.skuId,
        station: 'ALL',
        platform: 'ALL',
        page: 1,
        pageSize: 1,
        monthCount: 6,
        historyMonthCount: 0,
        asOf,
      }),
      buildSkuForecastContextMap({ versionId: forecastVersionId, identities: [identity] }),
    ]);
    forecastContext = contexts[contextKey] ?? null;

    if (versionRow) {
      forecastVersion = {
        id: versionRow.id,
        versionNo: versionRow.versionNo,
        versionName: versionRow.versionName,
      };
    }

    const horizonItem = horizon.items[0];
    const monthCells = horizonItem?.months ?? [];
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
    historyWeeks,
    planWeeks,
    forecastWeeks,
    forecastVersion,
    forecastHorizon,
    forecastContext,
  };
}
