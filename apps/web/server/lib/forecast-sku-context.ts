import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, salesForecastMonthly, skus } from '@scm/db';
import {
  classifySalesLifecycle,
  collectStockoutExcludedDates,
  computeLifecycleBaselineWeights,
  DEFAULT_SALES_HISTORY_LOOKBACK_DAYS,
  effectiveRecentWindowEnd,
  filterSalesRowsExcludingDates,
  resolveLastYearSameMonthDailyAvg,
  roundDaily,
  type LifecycleBaselineWeights,
  type SalesLifecycle,
} from './forecast-baseline.js';
import { formatForecastMonth, normalizeSalesPlatform } from './forecast-demand.js';
import type { HorizonFactorSnapshot } from './forecast-baseline.js';
import { parseHorizonFactors } from './forecast-baseline.js';
import {
  computeAgeDaysFromFirstSale,
  computeCategoryReferenceBySku,
  filterSalesRowsByStation,
} from './forecast-collaboration.js';
import {
  loadDailySalesBySkuIdsInRange,
  loadFirstSaleDateBySkuIds,
  loadMonthlySalesBySkuIds,
} from './sales-history-query.js';

export type ForecastVersionSummary = {
  monthCount: number;
  monthLabels: string[];
  description: string;
};

export type SkuForecastContext = {
  lifecycle: SalesLifecycle;
  weights: LifecycleBaselineWeights;
  weightsLabel: string;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  lastYearSameMonthDailyAvg: number;
  categoryReferenceDailyAvg: number | null;
  storedBaselineDailyAvg: number | null;
  storedLifecycle: string | null;
  forecastProfileClass: string | null;
  profileSegment: string | null;
};

export type SkuForecastIdentity = {
  skuId: string;
  station: string;
  platform: string;
};

function contextKey(identity: SkuForecastIdentity): string {
  return `${identity.skuId}::${identity.station}::${identity.platform}`;
}

function groupKey(identity: SkuForecastIdentity): string {
  return `${normalizeSalesPlatform(identity.platform)}::${identity.station.toUpperCase()}`;
}

export function formatBaselineWeightsLabel(weights: LifecycleBaselineWeights): string {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  return `${pct(weights.w90)} / ${pct(weights.w30)} / ${pct(weights.wLy)} / ${pct(weights.wCat)}`;
}

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

function warehouseCodesForStation(station: string, warehouseStationByCode: Map<string, string>): string[] {
  const targetStation = station.toUpperCase();
  return [...warehouseStationByCode.entries()]
    .filter(([, code]) => code === targetStation)
    .map(([warehouseCode]) => warehouseCode);
}

async function loadWarehouseStationMap(): Promise<Map<string, string>> {
  const { warehouses } = await import('@scm/db');
  const { eq: eqWh } = await import('drizzle-orm');
  const { stationForWarehouse } = await import('./forecast-demand.js');
  const rows = await db
    .select({
      code: warehouses.code,
      regionGroup: warehouses.regionGroup,
      countryCode: warehouses.countryCode,
    })
    .from(warehouses)
    .where(eqWh(warehouses.isActive, true));

  return new Map(
    rows.map((row) => [
      row.code,
      stationForWarehouse(row.regionGroup, row.countryCode).toUpperCase(),
    ]),
  );
}

export async function getVersionForecastSummary(versionId: string): Promise<ForecastVersionSummary> {
  const monthRows = await db
    .selectDistinct({
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
    })
    .from(salesForecastMonthly)
    .where(eq(salesForecastMonthly.versionId, versionId))
    .orderBy(asc(salesForecastMonthly.forecastYear), asc(salesForecastMonthly.month));

  const monthLabels = monthRows.map((row) => formatForecastMonth(row.forecastYear, row.month));
  const monthCount = monthLabels.length;
  const first = monthLabels[0] ?? '-';
  const last = monthLabels[monthLabels.length - 1] ?? first;

  return {
    monthCount,
    monthLabels,
    description:
      monthCount > 0
        ? `共 ${monthCount} 个自然月（${first} 至 ${last}），每月输出一条预测日均（件/天）。`
        : '暂无预测月份明细。',
  };
}

export async function buildSkuForecastContextMap(input: {
  versionId: string;
  identities: SkuForecastIdentity[];
  today?: Date;
}): Promise<Record<string, SkuForecastContext>> {
  const unique = new Map<string, SkuForecastIdentity>();
  for (const identity of input.identities) {
    unique.set(contextKey(identity), identity);
  }
  if (unique.size === 0) return {};

  const today = input.today ?? new Date();
  const skuIds = Array.from(new Set([...unique.values()].map((item) => item.skuId)));

  const [skuRows, storedRows, warehouseStationByCode] = await Promise.all([
    db
      .select({ id: skus.id, code: skus.code, category: skus.category })
      .from(skus)
      .where(inArray(skus.id, skuIds)),
    db
      .select({
        skuId: salesForecastMonthly.skuId,
        station: salesForecastMonthly.station,
        platform: salesForecastMonthly.platform,
        baselineDailyAvg: salesForecastMonthly.baselineDailyAvg,
        lifecycle: salesForecastMonthly.lifecycle,
        forecastProfileClass: salesForecastMonthly.forecastProfileClass,
        profileSegment: salesForecastMonthly.profileSegment,
        forecastYear: salesForecastMonthly.forecastYear,
        month: salesForecastMonthly.month,
      })
      .from(salesForecastMonthly)
      .where(
        and(
          eq(salesForecastMonthly.versionId, input.versionId),
          inArray(salesForecastMonthly.skuId, skuIds),
        ),
      )
      .orderBy(asc(salesForecastMonthly.forecastYear), asc(salesForecastMonthly.month)),
    loadWarehouseStationMap(),
  ]);

  const storedByKey = new Map<string, (typeof storedRows)[number]>();
  for (const row of storedRows) {
    const key = contextKey({
      skuId: row.skuId,
      station: row.station,
      platform: row.platform,
    });
    if (!storedByKey.has(key)) storedByKey.set(key, row);
  }

  const recentWindowEnd = effectiveRecentWindowEnd(today);
  const recent30Since = addDays(recentWindowEnd, -29);
  const recent90Since = addDays(recentWindowEnd, -89);
  const lookbackFrom = toDateOnly(addDays(today, -DEFAULT_SALES_HISTORY_LOOKBACK_DAYS));
  const lookbackTo = toDateOnly(today);
  const firstHorizon = storedRows[0];
  const monthlyCutoff = firstHorizon
    ? new Date(Date.UTC(firstHorizon.forecastYear, firstHorizon.month - 1, 1))
    : today;

  const groups = new Map<string, { platform: string; station: string; identities: SkuForecastIdentity[] }>();
  for (const identity of unique.values()) {
    const key = groupKey(identity);
    const group = groups.get(key) ?? {
      platform: normalizeSalesPlatform(identity.platform),
      station: identity.station.toUpperCase(),
      identities: [],
    };
    group.identities.push(identity);
    groups.set(key, group);
  }

  const result: Record<string, SkuForecastContext> = {};

  for (const group of groups.values()) {
    const groupSkuIds = Array.from(new Set(group.identities.map((item) => item.skuId)));
    const groupSkuRows = skuRows.filter((row) => groupSkuIds.includes(row.id));
    const stationWarehouseCodes = warehouseCodesForStation(group.station, warehouseStationByCode);

    const [dailyBySku, monthlyBySku, firstSaleBySku] = await Promise.all([
      loadDailySalesBySkuIdsInRange({
        skuIds: groupSkuIds,
        fromDate: lookbackFrom,
        toDate: lookbackTo,
        platform: group.platform,
      }),
      loadMonthlySalesBySkuIds({
        skuIds: groupSkuIds,
        platform: group.platform,
        minYear: monthlyCutoff.getUTCFullYear(),
        minMonth: monthlyCutoff.getUTCMonth() + 1,
      }),
      loadFirstSaleDateBySkuIds({
        skuIds: groupSkuIds,
        platform: group.platform,
        station: group.station,
        warehouseCodesForStation: stationWarehouseCodes,
      }),
    ]);

    const recent90BySkuId = new Map<string, number>();
    for (const sku of groupSkuRows) {
      const rawSalesRows = filterSalesRowsByStation(
        dailyBySku.get(sku.id) ?? [],
        group.station,
        warehouseStationByCode,
      );
      const stockoutExcluded = collectStockoutExcludedDates(rawSalesRows, recent90Since, recentWindowEnd);
      const salesRows = filterSalesRowsExcludingDates(rawSalesRows, stockoutExcluded);
      recent90BySkuId.set(sku.id, roundDaily(sumQtySince(salesRows, recent90Since) / 90));
    }
    const categoryRefBySku = computeCategoryReferenceBySku(groupSkuRows, recent90BySkuId);

    for (const identity of group.identities) {
      const key = contextKey(identity);
      const sku = skuRows.find((row) => row.id === identity.skuId);
      if (!sku) continue;

      const rawSalesRows = filterSalesRowsByStation(
        dailyBySku.get(sku.id) ?? [],
        identity.station,
        warehouseStationByCode,
      );
      const stockoutExcluded = collectStockoutExcludedDates(rawSalesRows, recent90Since, recentWindowEnd);
      const salesRows = filterSalesRowsExcludingDates(rawSalesRows, stockoutExcluded);
      const monthlySalesRows = monthlyBySku.get(sku.id) ?? [];
      const firstSaleDate = firstSaleBySku.get(sku.id) ?? null;

      const recent30DailyAvg = roundDaily(sumQtySince(salesRows, recent30Since) / 30);
      const recent90DailyAvg = recent90BySkuId.get(sku.id) ?? 0;
      const salesDays90 = countSalesDaysSince(salesRows, recent90Since);
      const ageDays = computeAgeDaysFromFirstSale(firstSaleDate, today);
      const maxZeroRunDays = computeMaxZeroRunDays(rawSalesRows, recent90Since, recentWindowEnd);

      const lifecycle = classifySalesLifecycle({
        ageDays,
        salesDayRatio90: salesDays90 / 90,
        recent30DailyAvg,
        recent90DailyAvg,
        maxZeroRunDays,
      });

      const stored = storedByKey.get(key);
      const anchorYear = stored?.forecastYear ?? today.getUTCFullYear();
      const anchorMonth = stored?.month ?? today.getUTCMonth() + 1;
      const lastYearSameMonthDailyAvg = resolveLastYearSameMonthDailyAvg({
        dailyRows: salesRows,
        monthlyRows: monthlySalesRows,
        forecastYear: anchorYear,
        month: anchorMonth,
      });

      const effectiveLifecycle = ((stored?.lifecycle as SalesLifecycle | null) ?? lifecycle) as SalesLifecycle;
      const weights = computeLifecycleBaselineWeights(effectiveLifecycle);

      result[key] = {
        lifecycle: effectiveLifecycle,
        weights,
        weightsLabel: formatBaselineWeightsLabel(weights),
        recent30DailyAvg,
        recent90DailyAvg,
        lastYearSameMonthDailyAvg,
        categoryReferenceDailyAvg: categoryRefBySku.get(sku.id) ?? null,
        storedBaselineDailyAvg:
          stored?.baselineDailyAvg != null ? Number(stored.baselineDailyAvg) : null,
        storedLifecycle: stored?.lifecycle ?? null,
        forecastProfileClass: stored?.forecastProfileClass ?? null,
        profileSegment: stored?.profileSegment ?? null,
      };
    }
  }

  return result;
}

export type SkuMonthlyForecastCell = {
  forecastYear: number;
  month: number;
  monthLabel: string;
  forecastDailyAvg: number;
  baselineDailyAvg: number | null;
  horizonFactors: HorizonFactorSnapshot | null;
};

export async function buildSkuMonthlyForecastMap(input: {
  versionId: string;
  identities: SkuForecastIdentity[];
}): Promise<Record<string, SkuMonthlyForecastCell[]>> {
  const unique = new Map<string, SkuForecastIdentity>();
  for (const identity of input.identities) {
    unique.set(contextKey(identity), identity);
  }
  if (unique.size === 0) return {};

  const skuIds = Array.from(new Set([...unique.values()].map((item) => item.skuId)));
  const rows = await db
    .select({
      skuId: salesForecastMonthly.skuId,
      station: salesForecastMonthly.station,
      platform: salesForecastMonthly.platform,
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      baselineDailyAvg: salesForecastMonthly.baselineDailyAvg,
      horizonFactors: salesForecastMonthly.horizonFactors,
    })
    .from(salesForecastMonthly)
    .where(
      and(
        eq(salesForecastMonthly.versionId, input.versionId),
        inArray(salesForecastMonthly.skuId, skuIds),
      ),
    )
    .orderBy(
      asc(salesForecastMonthly.skuId),
      asc(salesForecastMonthly.forecastYear),
      asc(salesForecastMonthly.month),
    );

  const result: Record<string, SkuMonthlyForecastCell[]> = {};
  for (const row of rows) {
    const key = contextKey({
      skuId: row.skuId,
      station: row.station,
      platform: row.platform,
    });
    if (!unique.has(key)) continue;

    const cells = result[key] ?? [];
    cells.push({
      forecastYear: row.forecastYear,
      month: row.month,
      monthLabel: formatForecastMonth(row.forecastYear, row.month),
      forecastDailyAvg:
        row.forecastDailyAvg != null ? Number(row.forecastDailyAvg) : 0,
      baselineDailyAvg:
        row.baselineDailyAvg != null ? Number(row.baselineDailyAvg) : null,
      horizonFactors: parseHorizonFactors(row.horizonFactors),
    });
    result[key] = cells;
  }

  return result;
}
