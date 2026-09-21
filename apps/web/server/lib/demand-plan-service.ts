import { and, eq, gte, inArray, like } from 'drizzle-orm';
import {
  db,
  demandPlanMonthly,
  demandPlanPilotSnapshots,
  demandPlanVersions,
  inventoryDailySnapshots,
  safetyStockConfig,
  skus,
} from '@scm/db';
import { parseDemandPlanPilotConfig } from './demand-plan-config.js';
import {
  excludedCrossGroupSpuIds,
  type SkuPilotInput,
} from './demand-plan-eligibility.js';
import {
  championRefLevel,
  classifyReconstructSource,
  systemDailyAvgForMonth,
  warehouseShareWeight,
} from './demand-plan-reconstruct.js';
import { calcEffectiveDailyDemand } from './effective-daily-demand.js';
import { forecastMonthKey } from './forecast-demand.js';
import { loadMergedPublishedForecastBySkuIds } from './forecast-published-resolve.js';
import { parseSharesFromSnapshot } from './inventory-share-allocation.js';
import { buildSkuWarehouseTimeline } from './inventory-timeline-service.js';
import { readTurnoverSnapshot } from './inventory-turnover-snapshot.js';
import { resolveLeadTimeForSkuWarehouse } from './lead-time-resolver.js';
import { DEFAULT_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';
import { loadDailySalesBySkuIds } from './sales-history-query.js';

export type DemandPlanVersionStatus = 'draft' | 'pilot_published' | 'archived';

export type DemandPlanSkipLog = {
  skuId: string;
  skuCode: string;
  reason: 'cross_group_spu' | 'no_share' | 'no_forecast';
};

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

function qtyAvailableFromPayload(payload: unknown, warehouseCode: string): number {
  if (!payload || typeof payload !== 'object') return 0;
  const rec = payload as Record<string, unknown>;
  const stocks = rec.warehouseStocks;
  if (Array.isArray(stocks)) {
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

function assertPilotScope(projectGroup: string, warehouseCode: string, env?: NodeJS.ProcessEnv) {
  const config = parseDemandPlanPilotConfig(env ?? process.env);
  if (config.projectGroups.length === 0 || config.warehouses.length === 0) {
    httpError('pilot project group/warehouse not configured', 400);
  }
  if (!config.projectGroups.includes(projectGroup) || !config.warehouses.includes(warehouseCode)) {
    httpError('project group/warehouse is not in the pilot config', 400);
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
 * 1. Config lists must be non-empty; projectGroup/warehouse must match.
 * 2. Active SKUs in the group; skip cross-group SPUs (logged).
 * 3. startMonth = UTC YYYY-MM, horizonMonths = 12.
 * 4. Load sales, daily-snapshot availability, published forecast, turnover share.
 * 5. U = calcEffectiveDailyDemand when availability series present, else calendar 90d.
 * 6. No share → skip monthly (runtime falls back to forecast).
 * 7. No published forecast months in horizon → skip. Else systemDailyAvgForMonth.
 * 8. Insert draft version + monthly rows.
 */
export async function generateDemandPlanDraft(params: {
  projectGroup: string;
  warehouseCode: string;
  versionName?: string;
  createdBy?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}) {
  const now = params.now ?? new Date();
  assertPilotScope(params.projectGroup, params.warehouseCode, params.env);

  const groupSkus = await db
    .select({
      skuId: skus.id,
      skuCode: skus.code,
      projectGroup: skus.projectGroup,
      spuId: skus.spuId,
      isActive: skus.isActive,
      encodingMeta: skus.encodingMeta,
    })
    .from(skus)
    .where(and(eq(skus.projectGroup, params.projectGroup), eq(skus.isActive, true)));

  const spuIds = [...new Set(groupSkus.map((row) => row.spuId).filter((id): id is string => Boolean(id)))];
  const siblingRows: SkuPilotInput[] = spuIds.length
    ? await db
        .select({
          skuId: skus.id,
          projectGroup: skus.projectGroup,
          spuId: skus.spuId,
          isActive: skus.isActive,
        })
        .from(skus)
        .where(and(inArray(skus.spuId, spuIds), eq(skus.isActive, true)))
    : groupSkus.map((row) => ({
        skuId: row.skuId,
        projectGroup: row.projectGroup,
        spuId: row.spuId,
        isActive: row.isActive,
      }));
  const excludedSpuIds = excludedCrossGroupSpuIds(siblingRows);

  const skipped: DemandPlanSkipLog[] = [];
  const eligible = groupSkus.filter((row) => {
    if (row.spuId && excludedSpuIds.has(row.spuId)) {
      skipped.push({ skuId: row.skuId, skuCode: row.skuCode, reason: 'cross_group_spu' });
      return false;
    }
    return true;
  });

  const skuIds = eligible.map((row) => row.skuId);
  const startMonth = forecastMonthKey(now.getUTCFullYear(), now.getUTCMonth() + 1);
  const months = horizonMonths(startMonth, 12);
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  windowStart.setUTCDate(windowStart.getUTCDate() - 90);
  const windowStartKey = windowStart.toISOString().slice(0, 10);

  const [salesBySku, forecastBySku, snapshotRows] = skuIds.length
    ? await Promise.all([
        loadDailySalesBySkuIds(skuIds, 90),
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
            ),
          ),
      ])
    : [new Map(), new Map(), [] as Array<{ skuId: string; snapshotDate: string; payload: unknown }>];

  const availabilityBySku = new Map<string, Array<{ date: string; qtyAvailable: number }>>();
  for (const row of snapshotRows) {
    const list = availabilityBySku.get(row.skuId) ?? [];
    list.push({
      date: String(row.snapshotDate).slice(0, 10),
      qtyAvailable: qtyAvailableFromPayload(row.payload, params.warehouseCode),
    });
    availabilityBySku.set(row.skuId, list);
  }

  const monthlyValues: Array<typeof demandPlanMonthly.$inferInsert> = [];
  for (const sku of eligible) {
    const share = warehouseShareWeight(
      params.warehouseCode,
      parseSharesFromSnapshot(readTurnoverSnapshot(sku.encodingMeta)).weights,
    );
    if (share == null) {
      skipped.push({ skuId: sku.skuId, skuCode: sku.skuCode, reason: 'no_share' });
      continue;
    }

    const forecastMap = forecastBySku.get(sku.skuId)?.map ?? new Map<string, number>();
    const monthForecasts = months
      .map((period) => {
        const daily = forecastMap.get(period);
        return daily == null ? null : { period, daily };
      })
      .filter((row): row is { period: string; daily: number } => row != null);
    if (monthForecasts.length === 0) {
      skipped.push({ skuId: sku.skuId, skuCode: sku.skuCode, reason: 'no_forecast' });
      continue;
    }

    const availability = availabilityBySku.get(sku.skuId) ?? [];
    const hasAvailabilitySeries = availability.length > 0;
    const reconstructed = calcEffectiveDailyDemand({
      sales: (salesBySku.get(sku.skuId) ?? []).map((row) => ({
        saleDate: row.saleDate,
        qtySold: row.qtySold,
      })),
      availability: hasAvailabilitySeries ? availability : [],
      windowDays: 90,
      asOf: now,
    });
    const source = classifyReconstructSource({
      hasAvailabilitySeries,
      inStockDays: reconstructed.inStockDays,
    });
    const unconstrainedRecentDaily = reconstructed.avgDaily;
    const inStockDayRatio = reconstructed.windowDays > 0
      ? reconstructed.inStockDays / reconstructed.windowDays
      : 0;
    const championRefDaily = championRefLevel(monthForecasts.map((row) => row.daily));

    for (const month of monthForecasts) {
      monthlyValues.push({
        skuId: sku.skuId,
        warehouseCode: params.warehouseCode,
        period: month.period,
        systemDailyAvg: toNumeric(
          systemDailyAvgForMonth({
            unconstrainedRecentDaily,
            share,
            monthForecastDaily: month.daily,
            championRefDaily,
          }),
        )!,
        unconstrainedRecentDaily: toNumeric(unconstrainedRecentDaily),
        championForecastDaily: toNumeric(month.daily * share),
        inStockDayRatio: toNumeric(inStockDayRatio),
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
      startMonth,
      horizonMonths: 12,
      projectGroup: params.projectGroup,
      warehouseCode: params.warehouseCode,
      createdBy: params.createdBy ?? null,
    })
    .returning();
  if (!version) throw new Error('Failed to insert demand plan version');

  if (monthlyValues.length) {
    await db.insert(demandPlanMonthly).values(
      monthlyValues.map((row) => ({ ...row, versionId: version.id })),
    );
  }

  return { version, skipped };
}

export async function publishDemandPlan(params: {
  versionId: string;
  publishedBy?: string;
}) {
  const [version] = await db
    .select()
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, params.versionId))
    .limit(1);
  if (!version) httpError('需求计划版本不存在', 404);
  if (version.status !== 'draft') httpError('仅草稿版本可发布', 400);

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
      await db
        .update(demandPlanVersions)
        .set({ status: 'archived', updatedAt: now })
        .where(eq(demandPlanVersions.id, row.id));
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
  const firstBySku = new Map<string, (typeof monthRows)[number]>();
  for (const row of monthRows) {
    if (!firstBySku.has(row.skuId)) firstBySku.set(row.skuId, row);
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
      const lead = await resolveLeadTimeForSkuWarehouse({
        skuId,
        warehouseCode: version.warehouseCode,
        merchantCode: sku?.merchantCode,
        skuLeadTimeDays: sku?.leadTimeDays,
      });
      const built = await buildSkuWarehouseTimeline({
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

  return published;
}

export async function archiveDemandPlan(versionId: string) {
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
}) {
  assertManualAdjust(params.manualDailyAvg, params.adjustReason);
  const [version] = await db
    .select({ status: demandPlanVersions.status })
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, params.versionId))
    .limit(1);
  if (!version) httpError('需求计划版本不存在', 404);
  if (version.status !== 'draft') httpError('仅草稿版本可修改月度需求', 400);

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
