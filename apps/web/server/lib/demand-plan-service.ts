import { and, eq, gte, inArray, like, lte } from 'drizzle-orm';
import {
  db,
  demandPlanMonthly,
  demandPlanPilotSnapshots,
  demandPlanVersions,
  demandPlanWeekly,
  inventoryDailySnapshots,
  planningDemandAdoptions,
  safetyStockConfig,
  skus,
} from '@scm/db';
import {
  DEMAND_PLAN_PROJECT_GROUP_ALL,
  DEMAND_PLAN_WAREHOUSE_ALL,
  isAllScopeProjectGroup,
  parseDemandPlanPilotConfig,
} from './demand-plan-config.js';
import {
  excludedCrossGroupSpuIds,
  type SkuPilotInput,
} from './demand-plan-eligibility.js';
import {
  championRefLevel,
  classifyReconstructSource,
  hasForecastShape,
  systemDailyAvgForWeek,
  weekForecastDailyForPlan,
} from './demand-plan-reconstruct.js';
import { chunkRowsForInsert } from './inventory-health-store.js';
import { calcEffectiveDailyDemand } from './effective-daily-demand.js';
import { forecastMonthKey } from './forecast-demand.js';
import { FORECAST_HORIZON_MONTHS } from './forecast-limits.js';
import { loadMergedPublishedForecastBySkuIds } from './forecast-published-resolve.js';
import {
  buildSkuNetworkTimeline,
  buildSkuWarehouseTimeline,
} from './inventory-timeline-service.js';
import {
  resolveLeadTimeForSkuWarehouse,
  resolvePreShipmentLeadTimeForSku,
} from './lead-time-resolver.js';
import {
  buildIsoWeekHorizon,
  DEMAND_PLAN_HORIZON_WEEKS,
  isoWeekMondayUtc,
  monthKeyFromUtcDate,
  planningRecentWindowEnd,
} from './planning-calendar.js';
import { DEFAULT_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';
import { freezeHorizonMonths, isDemandPeriodFrozen } from './demand-plan-freeze.js';
import { loadDailySalesBySkuIdsInRange } from './sales-history-query.js';
import { isAccessorySku } from './sku-encoding.js';

export type DemandPlanVersionStatus = 'draft' | 'pilot_published' | 'archived';

export type DemandPlanSkipLog = {
  skuId: string;
  skuCode: string;
  reason: 'cross_group_spu' | 'accessory' | 'no_share' | 'no_forecast' | 'no_recent_demand';
};

const DEMAND_PLAN_WEEKLY_INSERT_CHUNK = 500;

export type DemandPlanVersion = typeof demandPlanVersions.$inferSelect;
export type AdoptionRow = typeof planningDemandAdoptions.$inferSelect;

const ADOPT_INCOMPLETE_MESSAGE = '该版本周行不完整，不能采用';
const ADOPT_WEEK_COUNT = DEMAND_PLAN_HORIZON_WEEKS;

function httpError(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

function utcStamp(now: Date): string {
  return now.toISOString().slice(0, 10).replaceAll('-', '');
}

function toNumeric(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return (Math.round(value * 10_000) / 10_000).toFixed(4);
}

function horizonMonths(startMonth: string, count: number): string[] {
  const [year, month] = startMonth.split('-').map(Number);
  const periods: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const cursor = new Date(Date.UTC(year, month - 1 + i, 1));
    periods.push(forecastMonthKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1));
  }
  return periods;
}

export function championCoversHorizon(
  forecastMap: Map<string, number>,
  startMonth: string,
  monthCount: number,
): boolean {
  return horizonMonths(startMonth, monthCount).every((period) => {
    const daily = forecastMap.get(period);
    return daily != null && daily > 0;
  });
}

function qtyAvailableFromPayload(payload: unknown, warehouseCode: string): number {
  if (!payload || typeof payload !== 'object') return 0;
  const rec = payload as Record<string, unknown>;
  const stocks = rec.warehouseStocks;
  if (Array.isArray(stocks)) {
    if (warehouseCode === DEMAND_PLAN_WAREHOUSE_ALL) {
      return stocks.reduce((sum, row) => {
        if (!row || typeof row !== 'object') return sum;
        const stock = row as Record<string, unknown>;
        const n = Number(stock.qtyAvailable ?? stock.qty_available ?? 0);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
    const match = stocks.find((row) => {
      if (!row || typeof row !== 'object') return false;
      const stock = row as Record<string, unknown>;
      return stock.warehouseCode === warehouseCode || stock.warehouse === warehouseCode;
    }) as Record<string, unknown> | undefined;
    if (match) {
      const n = Number(match.qtyAvailable ?? match.qty_available ?? 0);
      return Number.isFinite(n) ? n : 0;
    }
  }
  const n = Number(rec.qtyAvailable ?? rec.qty_available ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function nextDemandPlanVersionNo(now: Date, seq: number): string {
  return `DP-${utcStamp(now)}-${String(seq).padStart(2, '0')}`;
}

export function assertManualAdjust(
  manualDailyAvg: number | null,
  adjustReason: string | null,
): void {
  if (manualDailyAvg != null && !adjustReason?.trim()) {
    httpError('人工调整必须填写原因', 400);
  }
}

export function shouldArchivePrevious(input: {
  existingStatus: DemandPlanVersionStatus;
}): boolean {
  return input.existingStatus === 'pilot_published';
}

export function canAdoptWeeklyCounts(counts: number[]): boolean {
  return counts.length > 0 && counts.every((count) => count === ADOPT_WEEK_COUNT);
}

export function shouldWriteAdoptionOnPublish(adopt?: boolean): boolean {
  return adopt === true;
}

export function shouldResetAdoptionOnArchive(input: {
  archivedVersionId: string;
  adoptionVersionId: string | null | undefined;
}): boolean {
  return Boolean(input.adoptionVersionId) && input.adoptionVersionId === input.archivedVersionId;
}

export type AdoptWeeklyCompletenessInput = {
  status: DemandPlanVersionStatus;
  horizonWeeks: number | null;
  startWeek: string | null | undefined;
  skuWeekCounts: number[];
  allowDraft?: boolean;
};

export function isAdoptWeeklyComplete(input: AdoptWeeklyCompletenessInput): boolean {
  const statusOk =
    input.status === 'pilot_published' || (input.allowDraft === true && input.status === 'draft');
  if (!statusOk) return false;
  if (input.horizonWeeks !== ADOPT_WEEK_COUNT || !input.startWeek) return false;
  return canAdoptWeeklyCounts(input.skuWeekCounts);
}

export function assertAdoptWeeklyComplete(input: AdoptWeeklyCompletenessInput): void {
  if (!isAdoptWeeklyComplete(input)) {
    httpError(ADOPT_INCOMPLETE_MESSAGE, 400);
  }
}

function weeklyCountsBySku(rows: Array<{ skuId: string }>): number[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.skuId, (counts.get(row.skuId) ?? 0) + 1);
  }
  return [...counts.values()];
}

export async function canAdoptWeeklyVersion(versionId: string): Promise<DemandPlanVersion> {
  const [version] = await db
    .select()
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, versionId))
    .limit(1);
  if (!version) httpError('需求计划版本不存在', 404);
  assertAdoptWeeklyComplete({
    status: version.status,
    horizonWeeks: version.horizonWeeks,
    startWeek: version.startWeek,
    skuWeekCounts: await loadSkuWeekCounts(versionId),
  });
  return version;
}

async function loadSkuWeekCounts(versionId: string): Promise<number[]> {
  const weekRows = await db
    .select({ skuId: demandPlanWeekly.skuId })
    .from(demandPlanWeekly)
    .where(eq(demandPlanWeekly.versionId, versionId));
  return weeklyCountsBySku(weekRows);
}

async function resetAdoptionIfPointingAt(versionId: string, adoptedBy?: string): Promise<void> {
  const [adoption] = await db
    .select()
    .from(planningDemandAdoptions)
    .where(eq(planningDemandAdoptions.demandPlanVersionId, versionId))
    .limit(1);
  if (
    !adoption ||
    !shouldResetAdoptionOnArchive({
      archivedVersionId: versionId,
      adoptionVersionId: adoption.demandPlanVersionId,
    })
  ) {
    return;
  }
  await adoptForecast({
    projectGroup: adoption.projectGroup,
    warehouseCode: adoption.warehouseCode,
    adoptedBy,
  });
}

async function upsertAdoption(params: {
  projectGroup: string;
  warehouseCode: string;
  source: 'forecast' | 'demand_plan';
  demandPlanVersionId: string | null;
  adoptedBy?: string;
}): Promise<AdoptionRow> {
  const now = new Date();
  const values = {
    projectGroup: params.projectGroup,
    warehouseCode: params.warehouseCode,
    source: params.source,
    demandPlanVersionId: params.demandPlanVersionId,
    adoptedBy: params.adoptedBy ?? null,
    adoptedAt: now,
    updatedAt: now,
  };
  const [row] = await db
    .insert(planningDemandAdoptions)
    .values(values)
    .onConflictDoUpdate({
      target: [planningDemandAdoptions.projectGroup, planningDemandAdoptions.warehouseCode],
      set: {
        source: values.source,
        demandPlanVersionId: values.demandPlanVersionId,
        adoptedBy: values.adoptedBy,
        adoptedAt: values.adoptedAt,
        updatedAt: values.updatedAt,
      },
    })
    .returning();
  if (!row) throw new Error('Failed to upsert planning demand adoption');
  return row;
}

function assertPilotScope(projectGroup: string, env?: NodeJS.ProcessEnv) {
  if (isAllScopeProjectGroup(projectGroup)) return;
  const config = parseDemandPlanPilotConfig(env ?? process.env);
  if (config.projectGroups.length > 0 && !config.projectGroups.includes(projectGroup)) {
    httpError('project group is not in the pilot config', 400);
  }
}

async function allocateDemandPlanVersionNo(now: Date): Promise<string> {
  const prefix = `DP-${utcStamp(now)}-`;
  const rows = await db
    .select({ versionNo: demandPlanVersions.versionNo })
    .from(demandPlanVersions)
    .where(like(demandPlanVersions.versionNo, `${prefix}%`));
  let maxSeq = 0;
  for (const row of rows) {
    const n = Number.parseInt(row.versionNo.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
  }
  return nextDemandPlanVersionNo(now, maxSeq + 1);
}

/**
 * generateDemandPlanDraft:
 * 1. Default projectGroup=ALL（全量 active SKU）；legacy 单组生成仍可用。
 * 2. Active SKUs in scope; skip cross-group SPUs (logged).
 * 3. 26 ISO weeks from asOf; startMonth = week-start month; horizonMonths = 6 (doc only).
 * 4. Recent 90d sales on [windowEnd-89, windowEnd] via planningRecentWindowEnd.
 * 5. U = calcEffectiveDailyDemand with asOf = windowEnd+1d.
 * 6. Plan is project-group level (warehouse=ALL, share=1).近窗销量 U 为主；月预测仅作季节形状（可选）。
 * 7. Insert draft version + demand_plan_weekly rows (no monthly inserts), batched insert.
 */
export async function generateDemandPlanDraft(params: {
  projectGroup?: string;
  warehouseCode?: string;
  versionName?: string;
  createdBy?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}) {
  const now = params.now ?? new Date();
  const asOf = now;
  const warehouseCode = DEMAND_PLAN_WAREHOUSE_ALL;
  const projectGroup = params.projectGroup?.trim() || DEMAND_PLAN_PROJECT_GROUP_ALL;
  assertPilotScope(projectGroup, params.env);

  const groupSkus = await db
    .select({
      skuId: skus.id,
      skuCode: skus.code,
      projectGroup: skus.projectGroup,
      spuId: skus.spuId,
      isActive: skus.isActive,
      encodingMeta: skus.encodingMeta,
      skuKind: skus.skuKind,
    })
    .from(skus)
    .where(
      isAllScopeProjectGroup(projectGroup)
        ? eq(skus.isActive, true)
        : and(eq(skus.projectGroup, projectGroup), eq(skus.isActive, true)),
    );

  const spuIds = [...new Set(groupSkus.map((row) => row.spuId).filter((id): id is string => Boolean(id)))];
  const siblingRows: SkuPilotInput[] = (
    spuIds.length
      ? await db
          .select({
            skuId: skus.id,
            skuCode: skus.code,
            skuKind: skus.skuKind,
            projectGroup: skus.projectGroup,
            spuId: skus.spuId,
            isActive: skus.isActive,
          })
          .from(skus)
          .where(and(inArray(skus.spuId, spuIds), eq(skus.isActive, true)))
      : groupSkus.map((row) => ({
          skuId: row.skuId,
          skuCode: row.skuCode,
          skuKind: row.skuKind,
          projectGroup: row.projectGroup,
          spuId: row.spuId,
          isActive: row.isActive,
        }))
  ).filter((row) => !isAccessorySku({ code: row.skuCode, skuKind: row.skuKind }));
  const excludedSpuIds = excludedCrossGroupSpuIds(siblingRows);

  const skipped: DemandPlanSkipLog[] = [];
  const eligible = groupSkus.filter((row) => {
    if (isAccessorySku({ code: row.skuCode, skuKind: row.skuKind })) {
      skipped.push({ skuId: row.skuId, skuCode: row.skuCode, reason: 'accessory' });
      return false;
    }
    if (row.spuId && excludedSpuIds.has(row.spuId)) {
      skipped.push({ skuId: row.skuId, skuCode: row.skuCode, reason: 'cross_group_spu' });
      return false;
    }
    return true;
  });

  const skuIds = eligible.map((row) => row.skuId);
  const weeks = buildIsoWeekHorizon(asOf, DEMAND_PLAN_HORIZON_WEEKS);
  const startWeek = weeks[0]!;
  const startMonth = monthKeyFromUtcDate(isoWeekMondayUtc(startWeek));
  const windowEnd = planningRecentWindowEnd(asOf);
  const windowStart = new Date(windowEnd.getTime());
  windowStart.setUTCDate(windowStart.getUTCDate() - 89);
  const windowStartKey = windowStart.toISOString().slice(0, 10);
  const windowEndKey = windowEnd.toISOString().slice(0, 10);
  const demandAsOf = new Date(windowEnd.getTime() + 86_400_000);

  const [salesBySku, forecastBySku, snapshotRows] = skuIds.length
    ? await Promise.all([
        loadDailySalesBySkuIdsInRange({
          skuIds,
          fromDate: windowStartKey,
          toDate: windowEndKey,
          platform: 'ALL',
        }),
        loadMergedPublishedForecastBySkuIds(skuIds),
        db
          .select({
            skuId: inventoryDailySnapshots.skuId,
            snapshotDate: inventoryDailySnapshots.snapshotDate,
            payload: inventoryDailySnapshots.payload,
          })
          .from(inventoryDailySnapshots)
          .where(
            and(
              inArray(inventoryDailySnapshots.skuId, skuIds),
              gte(inventoryDailySnapshots.snapshotDate, windowStartKey),
              lte(inventoryDailySnapshots.snapshotDate, windowEndKey),
            ),
          ),
      ])
    : [new Map(), new Map(), [] as Array<{ skuId: string; snapshotDate: string; payload: unknown }>];

  const availabilityBySku = new Map<string, Array<{ date: string; qtyAvailable: number }>>();
  for (const row of snapshotRows) {
    const list = availabilityBySku.get(row.skuId) ?? [];
    list.push({
      date: String(row.snapshotDate).slice(0, 10),
      qtyAvailable: qtyAvailableFromPayload(row.payload, warehouseCode),
    });
    availabilityBySku.set(row.skuId, list);
  }

  const forecastHorizon = horizonMonths(startMonth, FORECAST_HORIZON_MONTHS);
  const weeklyValues: Array<typeof demandPlanWeekly.$inferInsert> = [];
  for (const sku of eligible) {
    const forecastMap = forecastBySku.get(sku.skuId)?.map ?? new Map<string, number>();
    const availability = availabilityBySku.get(sku.skuId) ?? [];
    const hasAvailabilitySeries = availability.length > 0;
    const reconstructed = calcEffectiveDailyDemand({
      sales: (salesBySku.get(sku.skuId) ?? []).map((row) => ({
        saleDate: row.saleDate,
        qtySold: row.qtySold,
      })),
      availability: hasAvailabilitySeries ? availability : [],
      windowDays: 90,
      asOf: demandAsOf,
    });
    if (reconstructed.avgDaily <= 0) {
      skipped.push({ skuId: sku.skuId, skuCode: sku.skuCode, reason: 'no_recent_demand' });
      continue;
    }

    const source = hasAvailabilitySeries
      ? classifyReconstructSource({
          hasAvailabilitySeries,
          inStockDays: reconstructed.inStockDays,
        })
      : 'calendar_recent';
    const unconstrainedRecentDaily = reconstructed.avgDaily;
    const useForecastShape = hasForecastShape(forecastMap, forecastHorizon);
    const championRefDaily = useForecastShape
      ? championRefLevel(forecastHorizon.map((period) => forecastMap.get(period) ?? 0))
      : unconstrainedRecentDaily;

    for (const week of weeks) {
      const weekForecastDaily = weekForecastDailyForPlan({
        weekKey: week,
        monthlyDaily: forecastMap,
        flatDaily: unconstrainedRecentDaily,
        useForecastShape,
      });
      weeklyValues.push({
        skuId: sku.skuId,
        warehouseCode,
        period: week,
        systemDailyAvg: toNumeric(
          systemDailyAvgForWeek({
            unconstrainedRecentDaily,
            share: 1,
            weekForecastDaily,
            championRefDaily,
          }),
        )!,
        unconstrainedRecentDaily: toNumeric(unconstrainedRecentDaily),
        championForecastDaily: toNumeric(weekForecastDaily),
        source,
      });
    }
  }

  const versionNo = await allocateDemandPlanVersionNo(now);
  const [version] = await db
    .insert(demandPlanVersions)
    .values({
      versionNo,
      versionName: params.versionName?.trim() || versionNo,
      status: 'draft',
      startWeek,
      horizonWeeks: DEMAND_PLAN_HORIZON_WEEKS,
      startMonth,
      horizonMonths: FORECAST_HORIZON_MONTHS,
      projectGroup,
      warehouseCode,
      createdBy: params.createdBy ?? null,
    })
    .returning();
  if (!version) throw new Error('Failed to insert demand plan version');

  if (weeklyValues.length) {
    const rowsWithVersion = weeklyValues.map((row) => ({ ...row, versionId: version.id }));
    for (const chunk of chunkRowsForInsert(rowsWithVersion, DEMAND_PLAN_WEEKLY_INSERT_CHUNK)) {
      await db.insert(demandPlanWeekly).values(chunk);
    }
  }

  return { version, skipped };
}

export async function publishDemandPlan(params: {
  versionId: string;
  publishedBy?: string;
  adopt?: boolean;
}): Promise<{ version: DemandPlanVersion; adoption: AdoptionRow | null }> {
  const [version] = await db
    .select()
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, params.versionId))
    .limit(1);
  if (!version) httpError('需求计划版本不存在', 404);
  if (version.status !== 'draft') httpError('仅草稿版本可发布', 400);

  if (shouldWriteAdoptionOnPublish(params.adopt)) {
    assertAdoptWeeklyComplete({
      status: version.status,
      horizonWeeks: version.horizonWeeks,
      startWeek: version.startWeek,
      skuWeekCounts: await loadSkuWeekCounts(version.id),
      allowDraft: true,
    });
  }

  const previous = await db
    .select()
    .from(demandPlanVersions)
    .where(
      and(
        eq(demandPlanVersions.projectGroup, version.projectGroup),
        eq(demandPlanVersions.warehouseCode, version.warehouseCode),
        eq(demandPlanVersions.status, 'pilot_published'),
      ),
    );
  const now = new Date();
  for (const row of previous) {
    if (row.id === version.id) continue;
    if (shouldArchivePrevious({ existingStatus: row.status })) {
      await archiveDemandPlan(row.id, params.publishedBy);
    }
  }

  const [published] = await db
    .update(demandPlanVersions)
    .set({
      status: 'pilot_published',
      publishedAt: now,
      publishedBy: params.publishedBy ?? null,
      updatedAt: now,
    })
    .where(eq(demandPlanVersions.id, version.id))
    .returning();
  if (!published) throw new Error('Failed to publish demand plan version');

  const monthRows = await db
    .select()
    .from(demandPlanMonthly)
    .where(eq(demandPlanMonthly.versionId, version.id));
  const firstBySku = new Map<
    string,
    {
      unconstrainedRecentDaily: string | null;
      championForecastDaily: string | null;
      inStockDayRatio: string | null;
    }
  >();
  for (const row of monthRows) {
    if (!firstBySku.has(row.skuId)) {
      firstBySku.set(row.skuId, {
        unconstrainedRecentDaily: row.unconstrainedRecentDaily,
        championForecastDaily: row.championForecastDaily,
        inStockDayRatio: row.inStockDayRatio,
      });
    }
  }
  if (firstBySku.size === 0) {
    const weekRows = await db
      .select()
      .from(demandPlanWeekly)
      .where(eq(demandPlanWeekly.versionId, version.id))
      .orderBy(demandPlanWeekly.skuId, demandPlanWeekly.period);
    for (const row of weekRows) {
      if (!firstBySku.has(row.skuId)) {
        firstBySku.set(row.skuId, {
          unconstrainedRecentDaily: row.unconstrainedRecentDaily,
          championForecastDaily: row.championForecastDaily,
          inStockDayRatio: null,
        });
      }
    }
  }

  for (const [skuId, month] of firstBySku) {
    const [sku] = await db
      .select({
        encodingMeta: skus.encodingMeta,
        leadTimeDays: skus.leadTimeDays,
        moq: skus.moq,
        merchantCode: skus.merchantCode,
      })
      .from(skus)
      .where(eq(skus.id, skuId))
      .limit(1);
    const [policy] = await db
      .select()
      .from(safetyStockConfig)
      .where(
        and(eq(safetyStockConfig.skuId, skuId), eq(safetyStockConfig.warehouseCode, version.warehouseCode)),
      )
      .limit(1);

    let stockoutDateDemand: string | null = null;
    let stockoutDateForecast: string | null = null;
    let suggestedQtyDemand: string | null = null;
    let suggestedQtyForecast: string | null = null;
    try {
      const isNetworkPlan = version.warehouseCode === DEMAND_PLAN_WAREHOUSE_ALL;
      const [allPolicies, lead] = await Promise.all([
        isNetworkPlan
          ? db.select().from(safetyStockConfig).where(eq(safetyStockConfig.skuId, skuId))
          : Promise.resolve([]),
        isNetworkPlan
          ? resolvePreShipmentLeadTimeForSku({
              skuId,
              merchantCode: sku?.merchantCode,
              skuLeadTimeDays: sku?.leadTimeDays,
            })
          : resolveLeadTimeForSkuWarehouse({
              skuId,
              warehouseCode: version.warehouseCode,
              merchantCode: sku?.merchantCode,
              skuLeadTimeDays: sku?.leadTimeDays,
            }),
      ]);
      const networkSafety = isNetworkPlan
        ? allPolicies
            .filter((row) => row.warehouseCode !== DEMAND_PLAN_WAREHOUSE_ALL)
            .reduce(
              (acc, row) => ({
                safetyStockDays: Math.max(
                  acc.safetyStockDays,
                  row.safetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS,
                ),
                safetyStockQty: acc.safetyStockQty + (row.safetyStockQty ?? 0),
              }),
              { safetyStockDays: DEFAULT_SAFETY_STOCK_DAYS, safetyStockQty: 0 },
            )
        : null;
      const built = isNetworkPlan
        ? await buildSkuNetworkTimeline({
            skuId,
            avgDaily: Number(month.unconstrainedRecentDaily) || 0,
            totalLeadDays: lead.totalLeadDays,
            safetyStockDays: networkSafety!.safetyStockDays,
            safetyStockQty: networkSafety!.safetyStockQty,
            moq: sku?.moq ?? undefined,
            includeChampionShadow: true,
          })
        : await buildSkuWarehouseTimeline({
            skuId,
            warehouseCode: version.warehouseCode,
            avgDaily: Number(month.unconstrainedRecentDaily) || 0,
            totalLeadDays: lead.totalLeadDays,
            safetyStockDays: policy?.safetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS,
            safetyStockQty: policy?.safetyStockQty ?? 0,
            moq: sku?.moq ?? undefined,
            encodingMeta: sku?.encodingMeta,
            includeChampionShadow: true,
          });
      stockoutDateDemand = built.timeline.stockoutDateConfirmed;
      suggestedQtyDemand = toNumeric(built.suggestedQty);
      stockoutDateForecast = built.championTimeline?.stockoutDateConfirmed ?? null;
      suggestedQtyForecast = built.championTimeline ? toNumeric(built.championTimeline.suggestedQty) : null;
    } catch {
      // 无 timeline 仍插入空日期快照
    }

    await db.insert(demandPlanPilotSnapshots).values({
      versionId: version.id,
      skuId,
      warehouseCode: version.warehouseCode,
      stockoutDateDemand,
      stockoutDateForecast,
      suggestedQtyDemand,
      suggestedQtyForecast,
      unconstrainedRecentDaily: month.unconstrainedRecentDaily,
      championForecastDaily: month.championForecastDaily,
      inStockDayRatio: month.inStockDayRatio,
    });
  }

  const adoption = shouldWriteAdoptionOnPublish(params.adopt)
    ? await adoptDemandPlan({ versionId: published.id, adoptedBy: params.publishedBy })
    : null;
  return { version: published, adoption };
}

export async function adoptDemandPlan(params: {
  versionId: string;
  adoptedBy?: string;
}): Promise<AdoptionRow> {
  const version = await canAdoptWeeklyVersion(params.versionId);
  return upsertAdoption({
    projectGroup: version.projectGroup,
    warehouseCode: version.warehouseCode,
    source: 'demand_plan',
    demandPlanVersionId: version.id,
    adoptedBy: params.adoptedBy,
  });
}

export async function adoptForecast(params: {
  projectGroup: string;
  warehouseCode: string;
  adoptedBy?: string;
}): Promise<AdoptionRow> {
  return upsertAdoption({
    projectGroup: params.projectGroup,
    warehouseCode: params.warehouseCode,
    source: 'forecast',
    demandPlanVersionId: null,
    adoptedBy: params.adoptedBy,
  });
}

export async function archiveDemandPlan(versionId: string, archivedBy?: string) {
  const [existing] = await db
    .select()
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, versionId))
    .limit(1);
  if (!existing) httpError('需求计划版本不存在', 404);

  await resetAdoptionIfPointingAt(versionId, archivedBy);

  const [row] = await db
    .update(demandPlanVersions)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(demandPlanVersions.id, versionId))
    .returning();
  if (!row) httpError('需求计划版本不存在', 404);
  return row;
}

export async function updateDemandPlanMonth(params: {
  versionId: string;
  monthId: string;
  manualDailyAvg: number | null;
  adjustReason: string | null;
  totalLeadDays?: number;
}) {
  assertManualAdjust(params.manualDailyAvg, params.adjustReason);
  const [version] = await db
    .select({
      status: demandPlanVersions.status,
      startMonth: demandPlanVersions.startMonth,
      horizonMonths: demandPlanVersions.horizonMonths,
    })
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, params.versionId))
    .limit(1);
  if (!version) httpError('需求计划版本不存在', 404);
  if (version.status !== 'draft') httpError('仅草稿版本可修改月度需求', 400);

  const [monthRow] = await db
    .select({ period: demandPlanMonthly.period })
    .from(demandPlanMonthly)
    .where(
      and(eq(demandPlanMonthly.id, params.monthId), eq(demandPlanMonthly.versionId, params.versionId)),
    )
    .limit(1);
  if (!monthRow) httpError('需求计划月度行不存在', 404);

  const freezeMonths = freezeHorizonMonths(
    params.totalLeadDays ?? 90,
    version.horizonMonths ?? 12,
  );
  if (
    isDemandPeriodFrozen({
      period: monthRow.period,
      startMonth: version.startMonth,
      freezeMonths,
    })
  ) {
    httpError(`提前期内月份 ${monthRow.period} 已冻结，不可修改`, 400);
  }

  const patch: Partial<typeof demandPlanMonthly.$inferInsert> & { updatedAt: Date } = {
    manualDailyAvg: toNumeric(params.manualDailyAvg),
    adjustReason: params.adjustReason?.trim() || null,
    updatedAt: new Date(),
  };
  if (params.manualDailyAvg != null) patch.source = 'manual';

  const [updated] = await db
    .update(demandPlanMonthly)
    .set(patch)
    .where(
      and(eq(demandPlanMonthly.id, params.monthId), eq(demandPlanMonthly.versionId, params.versionId)),
    )
    .returning();
  if (!updated) httpError('需求计划月度行不存在', 404);
  return updated;
}

export async function updateDemandPlanWeek(params: {
  versionId: string;
  weekId: string;
  manualDailyAvg: number | null;
  adjustReason: string | null;
}) {
  assertManualAdjust(params.manualDailyAvg, params.adjustReason);
  const [version] = await db
    .select({ status: demandPlanVersions.status })
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, params.versionId))
    .limit(1);
  if (!version) httpError('需求计划版本不存在', 404);
  if (version.status !== 'draft') httpError('仅草稿版本可修改周需求', 400);

  const patch: Partial<typeof demandPlanWeekly.$inferInsert> & { updatedAt: Date } = {
    manualDailyAvg: toNumeric(params.manualDailyAvg),
    adjustReason: params.adjustReason?.trim() || null,
    updatedAt: new Date(),
  };
  if (params.manualDailyAvg != null) patch.source = 'manual';

  const [updated] = await db
    .update(demandPlanWeekly)
    .set(patch)
    .where(
      and(eq(demandPlanWeekly.id, params.weekId), eq(demandPlanWeekly.versionId, params.versionId)),
    )
    .returning();
  if (!updated) httpError('需求计划周行不存在', 404);
  return updated;
}
