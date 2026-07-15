import { eq, and, desc, isNull, inArray, sql } from 'drizzle-orm';
import {
  db,
  salesForecastVersions,
  salesForecastMonthly,
  salesForecastReviewItems,
  forecastAccuracyMonthly,
  LEGACY_FORECAST_VERSION_ID,
} from '@scm/db';
import { FORECAST_V41_PLATFORM_CODES } from './forecast-platform-scope.js';
import { parseBaselinePlatformFromVersionName } from './forecast-version-label.js';

export type ForecastVersionStatus = 'draft' | 'published' | 'archived';

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
      createdBy: params.createdBy ?? null,
    })
    .returning();
  return row;
}

/** 在 version_no 全局唯一约束下分配可用草稿名（同日重复生成时追加 · #N） */
export async function allocateUniqueDraftVersionName(
  baseName: string,
  station?: string,
): Promise<string> {
  const trimmed = baseName.trim();
  const stationKey = station?.trim().toUpperCase();
  const stationClause = stationKey
    ? eq(salesForecastVersions.station, stationKey)
    : isNull(salesForecastVersions.station);

  const exists = async (candidate: string) => {
    const [row] = await db
      .select({ id: salesForecastVersions.id })
      .from(salesForecastVersions)
      .where(and(eq(salesForecastVersions.versionNo, candidate), stationClause))
      .limit(1);
    return Boolean(row);
  };

  if (!(await exists(trimmed))) return trimmed;

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = `${trimmed} · #${suffix}`;
    if (!(await exists(candidate))) return candidate;
  }

  return `${trimmed} · ${Date.now()}`;
}

export async function publishForecastVersion(versionId: string, publishedBy: string) {
  const [version] = await db
    .select()
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, versionId))
    .limit(1);

  if (!version) throw new Error('Forecast version not found');
  if (version.status !== 'draft') throw new Error('Only draft versions can be published');

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

  return published;
}

export async function archiveForecastVersion(versionId: string) {
  const [row] = await db
    .update(salesForecastVersions)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(salesForecastVersions.id, versionId))
    .returning();
  return row;
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
  createdAt: Date;
  publishedAt: Date | null;
  /** 单渠道生成草稿时的渠道码；全平台或未识别时为 null */
  generationPlatform: string | null;
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

async function loadVersionStatsMap(versionIds: string[]): Promise<Map<string, ForecastVersionStats>> {
  const map = new Map<string, ForecastVersionStats>();
  if (versionIds.length === 0) return map;

  for (const id of versionIds) {
    map.set(id, emptyVersionStats());
  }

  const [monthlyRows, reviewRows, accuracyRows] = await Promise.all([
    db
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
      .groupBy(salesForecastMonthly.versionId),
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

function toVersionListItem(
  version: Awaited<ReturnType<typeof listForecastVersions>>[number],
  stats: ForecastVersionStats,
  generationPlatform: string | null = parseBaselinePlatformFromVersionName(version.versionName),
): ForecastVersionListItem {
  return {
    id: version.id,
    versionNo: version.versionNo,
    versionName: version.versionName,
    station: version.station,
    status: version.status as ForecastVersionStatus,
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
    generationPlatform,
    stats,
  };
}

export async function listForecastVersionsWithStats(
  status?: ForecastVersionStatus,
): Promise<ForecastVersionListItem[]> {
  const versions = await listForecastVersions(status);
  const statsMap = await loadVersionStatsMap(versions.map((v) => v.id));
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
