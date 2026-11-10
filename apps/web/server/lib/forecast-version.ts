import { eq, and, desc, isNull, inArray, sql, ilike, or } from 'drizzle-orm';
import {
  db,
  salesForecastVersions,
  salesForecastMonthly,
  salesForecastReviewItems,
  forecastAccuracyMonthly,
  LEGACY_FORECAST_VERSION_ID,
  users,
} from '@scm/db';
import { parseListPagination } from './list-pagination.js';
import { FORECAST_V41_PLATFORM_CODES } from './forecast-platform-scope.js';
import { parseBaselinePlatformFromVersionName } from './forecast-version-label.js';
import { invalidateAlertActionCache } from './alert-action-index.js';
import { invalidatePlanningDemandSourceCache } from './planning-demand-source.js';
import { isForecastStartMonthBacktest } from './forecast-start-month.js';

export const FORECAST_BACKTEST_REPLENISHMENT_BLOCKED_MESSAGE =
  '历史回测版本（开始月早于当月）仅供准确率复盘，不可发布或合入补货基线';

/** 开始月早于当月 → 回测稿，禁止进入补货生效链路 */
export function isForecastVersionBacktestForReplenishment(
  startMonth: string | null | undefined,
  now = new Date(),
): boolean {
  const month = startMonth?.trim();
  if (!month) return false;
  return isForecastStartMonthBacktest(month, now);
}

export function assertForecastVersionEligibleForReplenishment(
  startMonth: string | null | undefined,
  now = new Date(),
): void {
  if (isForecastVersionBacktestForReplenishment(startMonth, now)) {
    throw Object.assign(new Error(FORECAST_BACKTEST_REPLENISHMENT_BLOCKED_MESSAGE), {
      status: 400 as const,
    });
  }
}

function invalidateForecastDownstreamCaches(): void {
  invalidateAlertActionCache();
  invalidatePlanningDemandSourceCache();
}

export type ForecastVersionStatus = 'draft' | 'published' | 'archived';

/** 与 draft/published 正交：生成写入 / 影子落地进行中时可看数字会变 */
export type ForecastPipelineStatus = 'generating' | 'landing' | 'ready' | 'failed';

export const FORECAST_PIPELINE_STATUS_LABEL: Record<ForecastPipelineStatus, string> = {
  generating: '生成写入中',
  landing: '影子落地中',
  ready: '已就绪',
  failed: '生成失败',
};

export function isForecastPipelineBusy(status?: string | null): boolean {
  return status === 'generating' || status === 'landing';
}

export async function setForecastVersionPipelineStatus(
  versionId: string,
  pipelineStatus: ForecastPipelineStatus,
) {
  const [row] = await db
    .update(salesForecastVersions)
    .set({ pipelineStatus, updatedAt: new Date() })
    .where(eq(salesForecastVersions.id, versionId))
    .returning();
  return row;
}

/** 与 sales_forecast_versions.version_no varchar(50) 对齐 */
export const FORECAST_VERSION_NO_MAX_LEN = 50;
/** 与 sales_forecast_versions.version_name varchar(200) 对齐 */
export const FORECAST_VERSION_NAME_MAX_LEN = 200;

export function isSafeForecastVersionNo(versionNo: string): boolean {
  return versionNo.trim().length > 0 && versionNo.trim().length <= FORECAST_VERSION_NO_MAX_LEN;
}

/** 截断展示名；若带唯一性后缀，优先保留后缀尾部 */
export function clampDraftVersionName(
  baseName: string,
  maxLen = FORECAST_VERSION_NAME_MAX_LEN,
): string {
  const trimmed = baseName.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const suffixMatch = trimmed.match(/ · #\d+$/);
  if (suffixMatch) {
    const suffix = suffixMatch[0]!;
    const headMax = Math.max(0, maxLen - suffix.length);
    return `${trimmed.slice(0, trimmed.length - suffix.length).trimEnd().slice(0, headMax).trimEnd()}${suffix}`;
  }
  return trimmed.slice(0, maxLen).trimEnd();
}

export async function getPublishedForecastVersionIds(station?: string): Promise<string[]> {
  const rows = await db
    .select({ id: salesForecastVersions.id, station: salesForecastVersions.station })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.status, 'published'))
    .orderBy(desc(salesForecastVersions.publishedAt));

  if (!station) return rows.map((r) => r.id);
  const matched = rows.filter((r) => !r.station || r.station === station);
  return matched.length ? matched.map((r) => r.id) : rows.map((r) => r.id);
}

export async function getPrimaryPublishedVersionId(station?: string): Promise<string> {
  const ids = await getPublishedForecastVersionIds(station);
  return ids[0] ?? LEGACY_FORECAST_VERSION_ID;
}

export async function getOrCreateDraftVersion(params: {
  versionName?: string;
  versionNo?: string;
  station?: string;
  createdBy?: string;
}) {
  const versionNo = params.versionNo ?? `DRAFT-${Date.now()}`;
  const versionName = params.versionName ?? versionNo;
  const [row] = await db
    .insert(salesForecastVersions)
    .values({
      versionNo,
      versionName,
      station: params.station ?? null,
      status: 'draft',
      pipelineStatus: 'generating',
      createdBy: params.createdBy ?? null,
    })
    .returning();
  return row;
}

/** 在 version_name 下分配可用展示名（同日重复生成时追加 · #N）；version_no 仍用短码 */
export async function allocateUniqueDraftVersionName(
  baseName: string,
  station?: string,
): Promise<string> {
  const trimmed = clampDraftVersionName(baseName);
  const stationKey = station?.trim().toUpperCase();
  const stationClause = stationKey
    ? eq(salesForecastVersions.station, stationKey)
    : isNull(salesForecastVersions.station);

  const exists = async (candidate: string) => {
    const [row] = await db
      .select({ id: salesForecastVersions.id })
      .from(salesForecastVersions)
      .where(and(eq(salesForecastVersions.versionName, candidate), stationClause))
      .limit(1);
    return Boolean(row);
  };

  if (!(await exists(trimmed))) return trimmed;

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = clampDraftVersionName(`${trimmed} · #${suffix}`);
    if (!(await exists(candidate))) return candidate;
  }

  return clampDraftVersionName(`${trimmed} · ${Date.now()}`);
}

export async function publishForecastVersion(versionId: string, publishedBy: string) {
  const [version] = await db
    .select()
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, versionId))
    .limit(1);

  if (!version) throw new Error('Forecast version not found');
  if (version.status !== 'draft') throw new Error('Only draft versions can be published');
  assertForecastVersionEligibleForReplenishment(version.startMonth);

  const [published] = await db
    .update(salesForecastVersions)
    .set({
      status: 'published',
      publishedBy,
      publishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(salesForecastVersions.id, versionId))
    .returning();

  invalidateForecastDownstreamCaches();
  return published;
}

export async function archiveForecastVersion(versionId: string) {
  const [row] = await db
    .update(salesForecastVersions)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(salesForecastVersions.id, versionId))
    .returning();
  if (row) invalidateForecastDownstreamCaches();
  return row;
}

export type MergeDraftIntoPublishedResult = {
  mode: 'merged' | 'published';
  draftVersionId: string;
  targetVersionId: string;
  targetVersion: typeof salesForecastVersions.$inferSelect;
  mergedSkuCount: number;
  mergedForecastRows: number;
  mergedReviewItems: number;
};

/**
 * 将指定 SKU 试算草稿合入当前主已发布版本；若尚无已发布版本则直接发布该草稿。
 * 合入后草稿归档，避免碎片 published 版本污染补货拼图。
 */
export async function mergeDraftIntoPrimaryPublished(
  draftVersionId: string,
  userId: string,
): Promise<MergeDraftIntoPublishedResult> {
  const draft = await getForecastVersionById(draftVersionId);
  if (!draft) {
    throw Object.assign(new Error('预测版本不存在'), { status: 404 as const });
  }
  if (draft.status !== 'draft') {
    throw Object.assign(new Error('仅草稿版本可合入已发布基线'), { status: 400 as const });
  }
  assertForecastVersionEligibleForReplenishment(draft.startMonth);

  const primaryId = await getPrimaryPublishedVersionId(draft.station ?? undefined);
  const primaryCandidate = await getForecastVersionById(primaryId);
  // getPrimaryPublishedVersionId 在无 published 时也会回落 LEGACY id；须确认真实存在且为 published
  if (
    !primaryCandidate ||
    primaryCandidate.status !== 'published' ||
    primaryCandidate.id === draft.id
  ) {
    const published = await publishForecastVersion(draftVersionId, userId);
    const skuRows = await db
      .selectDistinct({ skuId: salesForecastMonthly.skuId })
      .from(salesForecastMonthly)
      .where(eq(salesForecastMonthly.versionId, published.id));
    const forecastRowCount = await db
      .select({ id: salesForecastMonthly.id })
      .from(salesForecastMonthly)
      .where(eq(salesForecastMonthly.versionId, published.id));
    const reviewCount = await db
      .select({ id: salesForecastReviewItems.id })
      .from(salesForecastReviewItems)
      .where(eq(salesForecastReviewItems.versionId, published.id));
    return {
      mode: 'published',
      draftVersionId,
      targetVersionId: published.id,
      targetVersion: published,
      mergedSkuCount: skuRows.length,
      mergedForecastRows: forecastRowCount.length,
      mergedReviewItems: reviewCount.length,
    };
  }

  const primary = primaryCandidate;
  const draftStart = draft.startMonth?.trim() || null;
  const primaryStart = primary.startMonth?.trim() || null;
  if (draftStart && primaryStart && draftStart !== primaryStart) {
    throw Object.assign(
      new Error(
        `草稿开始月 ${draftStart} 与当前生效基线开始月 ${primaryStart} 不一致，请先生成同开始月的草稿再合入，或直接发布为独立版本`,
      ),
      { status: 400 as const },
    );
  }

  const result = await db.transaction(async (tx) => {
    const draftSkuRows = await tx
      .selectDistinct({ skuId: salesForecastMonthly.skuId })
      .from(salesForecastMonthly)
      .where(eq(salesForecastMonthly.versionId, draftVersionId));
    const skuIds = draftSkuRows.map((row) => row.skuId);
    if (!skuIds.length) {
      throw Object.assign(new Error('草稿无预测明细，无法合入'), { status: 400 as const });
    }

    await tx
      .delete(salesForecastReviewItems)
      .where(
        and(
          eq(salesForecastReviewItems.versionId, primary.id),
          inArray(salesForecastReviewItems.skuId, skuIds),
        ),
      );
    await tx
      .delete(salesForecastMonthly)
      .where(
        and(eq(salesForecastMonthly.versionId, primary.id), inArray(salesForecastMonthly.skuId, skuIds)),
      );

    const monthlyRows = await tx
      .select()
      .from(salesForecastMonthly)
      .where(eq(salesForecastMonthly.versionId, draftVersionId));
    const reviewRows = await tx
      .select()
      .from(salesForecastReviewItems)
      .where(eq(salesForecastReviewItems.versionId, draftVersionId));

    const now = new Date();
    if (monthlyRows.length) {
      await tx.insert(salesForecastMonthly).values(
        monthlyRows.map((row) => ({
          skuId: row.skuId,
          station: row.station,
          platform: row.platform,
          forecastYear: row.forecastYear,
          month: row.month,
          forecastDailyAvg: row.forecastDailyAvg,
          baselineDailyAvg: row.baselineDailyAvg,
          manualDailyAvg: row.manualDailyAvg,
          adjustReason: row.adjustReason,
          confidenceLevel: row.confidenceLevel,
          versionId: primary.id,
          lifecycle: row.lifecycle,
          horizonFactors: row.horizonFactors,
          forecastProfileClass: row.forecastProfileClass,
          profileSegment: row.profileSegment,
          horizonBand: row.horizonBand,
          continuity12m: row.continuity12m,
          cv12m: row.cv12m,
          forecastDailyP10: row.forecastDailyP10,
          forecastDailyP90: row.forecastDailyP90,
          forecastModel: row.forecastModel,
          ownerName: row.ownerName,
          source: row.source,
          importBatchId: row.importBatchId,
          updatedAt: now,
          createdAt: now,
        })),
      );
    }

    if (reviewRows.length) {
      await tx.insert(salesForecastReviewItems).values(
        reviewRows.map((row) => ({
          versionId: primary.id,
          skuId: row.skuId,
          station: row.station,
          platform: row.platform,
          issueType: row.issueType,
          severity: row.severity,
          message: row.message,
          suggestedDailyAvg: row.suggestedDailyAvg,
          reviewedDailyAvg: row.reviewedDailyAvg,
          status: row.status,
          reviewerId: row.reviewerId,
          reviewedAt: row.reviewedAt,
          createdAt: now,
        })),
      );
    }

    const [updatedPrimary] = await tx
      .update(salesForecastVersions)
      .set({ updatedAt: now })
      .where(eq(salesForecastVersions.id, primary.id))
      .returning();

    await tx
      .update(salesForecastVersions)
      .set({ status: 'archived', updatedAt: now })
      .where(eq(salesForecastVersions.id, draftVersionId));

    return {
      targetVersion: updatedPrimary ?? primary,
      mergedSkuCount: skuIds.length,
      mergedForecastRows: monthlyRows.length,
      mergedReviewItems: reviewRows.length,
    };
  });

  invalidateForecastDownstreamCaches();
  return {
    mode: 'merged',
    draftVersionId,
    targetVersionId: primary.id,
    targetVersion: result.targetVersion,
    mergedSkuCount: result.mergedSkuCount,
    mergedForecastRows: result.mergedForecastRows,
    mergedReviewItems: result.mergedReviewItems,
  };
}

export type DeleteDraftForecastVersionResult = {
  id: string;
  versionNo: string;
  deleted: {
    forecastMonthly: number;
    forecastAccuracy: number;
    reviewItems: number;
  };
};

/** 仅草稿可硬删除；先清子表再删版本 */
export async function deleteDraftForecastVersion(
  versionId: string,
): Promise<DeleteDraftForecastVersionResult> {
  const version = await getForecastVersionById(versionId);
  if (!version) {
    throw Object.assign(new Error('预测版本不存在'), { status: 404 as const });
  }
  if (version.status !== 'draft') {
    throw Object.assign(new Error('仅草稿版本可删除'), { status: 400 as const });
  }

  return db.transaction(async (tx) => {
    const forecastMonthly = await tx
      .delete(salesForecastMonthly)
      .where(eq(salesForecastMonthly.versionId, versionId))
      .returning({ id: salesForecastMonthly.id });
    const forecastAccuracy = await tx
      .delete(forecastAccuracyMonthly)
      .where(eq(forecastAccuracyMonthly.versionId, versionId))
      .returning({ id: forecastAccuracyMonthly.id });
    const reviewItems = await tx
      .delete(salesForecastReviewItems)
      .where(eq(salesForecastReviewItems.versionId, versionId))
      .returning({ id: salesForecastReviewItems.id });
    const [deleted] = await tx
      .delete(salesForecastVersions)
      .where(and(eq(salesForecastVersions.id, versionId), eq(salesForecastVersions.status, 'draft')))
      .returning({ id: salesForecastVersions.id, versionNo: salesForecastVersions.versionNo });

    if (!deleted) {
      throw Object.assign(new Error('删除失败：版本不存在或已非草稿'), { status: 409 as const });
    }

    return {
      id: deleted.id,
      versionNo: deleted.versionNo,
      deleted: {
        forecastMonthly: forecastMonthly.length,
        forecastAccuracy: forecastAccuracy.length,
        reviewItems: reviewItems.length,
      },
    };
  });
}

export async function listForecastVersions(status?: ForecastVersionStatus) {
  const base = db.select().from(salesForecastVersions).$dynamic();
  if (status) {
    return base
      .where(eq(salesForecastVersions.status, status))
      .orderBy(desc(salesForecastVersions.createdAt));
  }
  return base.orderBy(desc(salesForecastVersions.createdAt)).limit(50);
}

export type ForecastVersionStats = {
  forecastRowCount: number;
  skuCount: number;
  monthCount: number;
  /** 待复核 SKU×渠道 数 */
  reviewPending: number;
  /** 待复核涉及的去重 SKU 数 */
  reviewPendingSkuCount: number;
  reviewCritical: number;
  accuracyWmape: number | null;
};

export type ForecastVersionListItem = {
  id: string;
  versionNo: string;
  versionName: string;
  station: string | null;
  status: ForecastVersionStatus;
  pipelineStatus: ForecastPipelineStatus | string;
  createdAt: Date;
  publishedAt: Date | null;
  /** 预测地平线首月 YYYY-MM；历史版本可能为空 */
  startMonth: string | null;
  /** 单渠道生成草稿时的渠道码；全平台或未识别时为 null */
  generationPlatform: string | null;
  createdByName: string | null;
  stats: ForecastVersionStats;
};

const emptyVersionStats = (): ForecastVersionStats => ({
  forecastRowCount: 0,
  skuCount: 0,
  monthCount: 0,
  reviewPending: 0,
  reviewPendingSkuCount: 0,
  reviewCritical: 0,
  accuracyWmape: null,
});

function applyGroupedReviewStats(
  stats: ForecastVersionStats,
  groups: Array<{ status: string; severityRank: number; skuId: string }>,
) {
  const pendingSkuIds = new Set<string>();
  for (const group of groups) {
    if (group.status !== 'pending') continue;
    stats.reviewPending++;
    pendingSkuIds.add(group.skuId);
    if (group.severityRank >= 3) stats.reviewCritical++;
  }
  stats.reviewPendingSkuCount = pendingSkuIds.size;
}

export type ForecastVersionStatsScope = 'list' | 'full';

async function loadVersionStatsMap(
  versionIds: string[],
  scope: ForecastVersionStatsScope = 'full',
): Promise<Map<string, ForecastVersionStats>> {
  const map = new Map<string, ForecastVersionStats>();
  if (versionIds.length === 0) return map;

  for (const id of versionIds) {
    map.set(id, emptyVersionStats());
  }

  const monthlyQuery = db
    .select({
      versionId: salesForecastMonthly.versionId,
      forecastRowCount: sql<number>`count(*)::int`,
      skuCount: sql<number>`count(distinct ${salesForecastMonthly.skuId})::int`,
      monthCount: sql<number>`count(distinct (${salesForecastMonthly.forecastYear}, ${salesForecastMonthly.month}))::int`,
    })
    .from(salesForecastMonthly)
    .where(
      and(
        inArray(salesForecastMonthly.versionId, versionIds),
        inArray(salesForecastMonthly.platform, [...FORECAST_V41_PLATFORM_CODES]),
      ),
    )
    .groupBy(salesForecastMonthly.versionId);

  if (scope === 'list') {
    const monthlyRows = await monthlyQuery;
    for (const row of monthlyRows) {
      if (!row.versionId) continue;
      const stats = map.get(row.versionId) ?? emptyVersionStats();
      stats.forecastRowCount = row.forecastRowCount;
      stats.skuCount = row.skuCount;
      stats.monthCount = row.monthCount;
      map.set(row.versionId, stats);
    }
    return map;
  }

  const [monthlyRows, reviewRows, accuracyRows] = await Promise.all([
    monthlyQuery,
    db
      .select({
        versionId: salesForecastReviewItems.versionId,
        skuId: salesForecastReviewItems.skuId,
        station: salesForecastReviewItems.station,
        platform: salesForecastReviewItems.platform,
        status: salesForecastReviewItems.status,
        severityRank: sql<number>`max(case ${salesForecastReviewItems.severity}
          when 'critical' then 3
          when 'warning' then 2
          else 1
        end)`.mapWith(Number),
      })
      .from(salesForecastReviewItems)
      .where(inArray(salesForecastReviewItems.versionId, versionIds))
      .groupBy(
        salesForecastReviewItems.versionId,
        salesForecastReviewItems.skuId,
        salesForecastReviewItems.station,
        salesForecastReviewItems.platform,
        salesForecastReviewItems.status,
      ),
    db
      .select({
        versionId: forecastAccuracyMonthly.versionId,
        accuracyWmape: sql<number | null>`avg(${forecastAccuracyMonthly.mape})::float`,
      })
      .from(forecastAccuracyMonthly)
      .where(inArray(forecastAccuracyMonthly.versionId, versionIds))
      .groupBy(forecastAccuracyMonthly.versionId),
  ]);

  for (const row of monthlyRows) {
    if (!row.versionId) continue;
    const stats = map.get(row.versionId) ?? emptyVersionStats();
    stats.forecastRowCount = row.forecastRowCount;
    stats.skuCount = row.skuCount;
    stats.monthCount = row.monthCount;
    map.set(row.versionId, stats);
  }

  const reviewGroupsByVersion = new Map<string, Array<{ status: string; severityRank: number; skuId: string }>>();
  for (const row of reviewRows) {
    if (!row.versionId) continue;
    const groups = reviewGroupsByVersion.get(row.versionId) ?? [];
    groups.push({
      status: row.status,
      severityRank: row.severityRank ?? 1,
      skuId: row.skuId,
    });
    reviewGroupsByVersion.set(row.versionId, groups);
  }

  for (const [versionId, groups] of reviewGroupsByVersion) {
    const stats = map.get(versionId) ?? emptyVersionStats();
    applyGroupedReviewStats(stats, groups);
    map.set(versionId, stats);
  }

  for (const row of accuracyRows) {
    if (!row.versionId) continue;
    const stats = map.get(row.versionId) ?? emptyVersionStats();
    stats.accuracyWmape = row.accuracyWmape != null ? Number(row.accuracyWmape) : null;
    map.set(row.versionId, stats);
  }

  return map;
}

/** 解析版本生成渠道：优先 version_name，否则在仅有一个分平台数据时回退 */
export async function resolveVersionGenerationPlatform(input: {
  versionId: string;
  versionName: string;
}): Promise<string | null> {
  const parsed = parseBaselinePlatformFromVersionName(input.versionName);
  if (parsed) return parsed;

  const rows = await db
    .selectDistinct({ platform: salesForecastMonthly.platform })
    .from(salesForecastMonthly)
    .where(
      and(
        eq(salesForecastMonthly.versionId, input.versionId),
        inArray(salesForecastMonthly.platform, [...FORECAST_V41_PLATFORM_CODES]),
      ),
    );

  if (rows.length === 1) return rows[0]!.platform;
  return null;
}

type ForecastVersionListRow = {
  id: string;
  versionNo: string;
  versionName: string;
  station: string | null;
  status: string;
  pipelineStatus: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  startMonth: string | null;
  createdByName?: string | null;
};

function toVersionListItem(
  version: ForecastVersionListRow,
  stats: ForecastVersionStats,
  generationPlatform: string | null = parseBaselinePlatformFromVersionName(version.versionName),
): ForecastVersionListItem {
  return {
    id: version.id,
    versionNo: version.versionNo,
    versionName: version.versionName,
    station: version.station,
    status: version.status as ForecastVersionStatus,
    pipelineStatus: (version.pipelineStatus as ForecastPipelineStatus | string) || 'ready',
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
    startMonth: version.startMonth ?? null,
    generationPlatform,
    createdByName: version.createdByName ?? null,
    stats,
  };
}

export async function listForecastVersionsPage(input: {
  status?: ForecastVersionStatus;
  q?: string;
  page?: number;
  pageSize?: number;
  includeStats?: boolean;
  statsScope?: ForecastVersionStatsScope;
}) {
  const { page, pageSize, offset } = parseListPagination(
    input.page != null ? String(input.page) : undefined,
    input.pageSize != null ? String(input.pageSize) : undefined,
  );
  const conditions = [];
  if (input.status) conditions.push(eq(salesForecastVersions.status, input.status));
  const q = input.q?.trim();
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(salesForecastVersions.versionNo, pattern),
        ilike(salesForecastVersions.versionName, pattern),
        ilike(salesForecastVersions.station, pattern),
      )!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, countRow] = await Promise.all([
    db
      .select({
        id: salesForecastVersions.id,
        versionNo: salesForecastVersions.versionNo,
        versionName: salesForecastVersions.versionName,
        station: salesForecastVersions.station,
        status: salesForecastVersions.status,
        pipelineStatus: salesForecastVersions.pipelineStatus,
        createdAt: salesForecastVersions.createdAt,
        publishedAt: salesForecastVersions.publishedAt,
        startMonth: salesForecastVersions.startMonth,
        createdByName: users.name,
      })
      .from(salesForecastVersions)
      .leftJoin(users, eq(salesForecastVersions.createdBy, users.id))
      .where(where)
      .orderBy(desc(salesForecastVersions.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(salesForecastVersions)
      .where(where),
  ]);

  const statsMap =
    input.includeStats === false
      ? new Map<string, ForecastVersionStats>()
      : await loadVersionStatsMap(
          rows.map((r) => r.id),
          input.statsScope ?? 'list',
        );

  const items = rows.map((r) =>
    toVersionListItem(r, statsMap.get(r.id) ?? emptyVersionStats()),
  );
  return { items, total: countRow[0]?.count ?? 0, page, pageSize };
}

export async function listForecastVersionsWithStats(
  status?: ForecastVersionStatus,
  options?: { statsScope?: ForecastVersionStatsScope },
): Promise<ForecastVersionListItem[]> {
  const statsScope = options?.statsScope ?? 'full';
  const versions = await listForecastVersions(status);
  const statsMap = await loadVersionStatsMap(
    versions.map((v) => v.id),
    statsScope,
  );
  return versions.map((v) => toVersionListItem(v, statsMap.get(v.id) ?? emptyVersionStats()));
}

export async function getForecastVersionWithStats(
  versionId: string,
): Promise<ForecastVersionListItem | null> {
  const version = await getForecastVersionById(versionId);
  if (!version) return null;
  const [statsMap, generationPlatform] = await Promise.all([
    loadVersionStatsMap([versionId]),
    resolveVersionGenerationPlatform({
      versionId: version.id,
      versionName: version.versionName,
    }),
  ]);
  return toVersionListItem(
    version,
    statsMap.get(versionId) ?? emptyVersionStats(),
    generationPlatform,
  );
}

export async function assertVersionIsDraft(versionId: string) {
  const [v] = await db
    .select({ status: salesForecastVersions.status })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, versionId))
    .limit(1);
  if (!v) throw new Error('Version not found');
  if (v.status !== 'draft') throw new Error('Only draft version accepts imports/edits');
}

export async function getForecastVersionById(versionId: string) {
  const [row] = await db
    .select()
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, versionId))
    .limit(1);
  return row ?? null;
}

/** 导入写入草稿版本；同站点（或全局 null 站点）复用最新 draft */
export async function findOrCreateDraftVersionForImport(station?: string | null) {
  const conditions = [eq(salesForecastVersions.status, 'draft')];
  if (station?.trim()) {
    conditions.push(eq(salesForecastVersions.station, station.trim().toUpperCase()));
  } else {
    conditions.push(isNull(salesForecastVersions.station));
  }

  const [draft] = await db
    .select()
    .from(salesForecastVersions)
    .where(and(...conditions))
    .orderBy(desc(salesForecastVersions.createdAt))
    .limit(1);

  if (draft) return draft;

  return getOrCreateDraftVersion({ station });
}

/** 取最新草稿（不自动创建），供单 SKU 局部更新挂载目标 */
export async function getLatestDraftVersion(station?: string | null) {
  const conditions = [eq(salesForecastVersions.status, 'draft')];
  if (station?.trim()) {
    conditions.push(eq(salesForecastVersions.station, station.trim().toUpperCase()));
  } else {
    conditions.push(isNull(salesForecastVersions.station));
  }

  const [draft] = await db
    .select()
    .from(salesForecastVersions)
    .where(and(...conditions))
    .orderBy(desc(salesForecastVersions.createdAt))
    .limit(1);

  return draft ?? null;
}
