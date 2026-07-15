import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, salesForecastReviewItems, skus } from '@scm/db';
import { getForecastVersionById } from './forecast-version.js';

export type ReviewItemStats = {
  /** 原始复核记录行数（同 SKU×渠道 多类型时可能 > total） */
  totalRecords: number;
  /** SKU×渠道 维度分组数（全状态） */
  total: number;
  /** 待复核的 SKU×渠道 数 */
  pending: number;
  /** 待复核涉及的去重 SKU 数 */
  pendingSkuCount: number;
  reviewed: number;
  ignored: number;
  pendingBySeverity: { critical: number; warning: number; info: number };
};

export type GroupedReviewItem = {
  skuId: string;
  skuCode: string;
  skuName: string;
  station: string;
  platform: string;
  status: 'pending' | 'reviewed' | 'ignored';
  severity: 'critical' | 'warning' | 'info';
  issueTypes: string[];
  messages: string[];
  itemIds: string[];
  suggestedDailyAvg: number | null;
};

const severityRankSql = sql`max(case ${salesForecastReviewItems.severity}
  when 'critical' then 3
  when 'warning' then 2
  else 1
end)`;

function mapGroupedSeverity(rank: number): GroupedReviewItem['severity'] {
  if (rank >= 3) return 'critical';
  if (rank >= 2) return 'warning';
  return 'info';
}

function reviewWhere(versionId?: string, status?: string) {
  const conditions = [];
  if (versionId?.trim()) {
    conditions.push(eq(salesForecastReviewItems.versionId, versionId.trim()));
  }
  if (status) {
    conditions.push(eq(salesForecastReviewItems.status, status));
  }
  return conditions.length ? and(...conditions) : undefined;
}

export async function getReviewItemStats(versionId?: string): Promise<ReviewItemStats> {
  const where = reviewWhere(versionId);

  const [recordCountRow, groupedRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(salesForecastReviewItems)
      .where(where),
    db
      .select({
        status: salesForecastReviewItems.status,
        severityRank: severityRankSql.mapWith(Number),
        skuId: salesForecastReviewItems.skuId,
        platform: salesForecastReviewItems.platform,
      })
      .from(salesForecastReviewItems)
      .where(where)
      .groupBy(
        salesForecastReviewItems.versionId,
        salesForecastReviewItems.skuId,
        salesForecastReviewItems.station,
        salesForecastReviewItems.platform,
        salesForecastReviewItems.status,
      ),
  ]);

  const stats: ReviewItemStats = {
    totalRecords: recordCountRow[0]?.count ?? 0,
    total: groupedRows.length,
    pending: 0,
    pendingSkuCount: 0,
    reviewed: 0,
    ignored: 0,
    pendingBySeverity: { critical: 0, warning: 0, info: 0 },
  };

  const pendingSkuIds = new Set<string>();
  for (const row of groupedRows) {
    if (row.status === 'pending') {
      stats.pending++;
      pendingSkuIds.add(row.skuId);
      const severity = mapGroupedSeverity(row.severityRank ?? 1);
      if (severity === 'critical') stats.pendingBySeverity.critical++;
      else if (severity === 'warning') stats.pendingBySeverity.warning++;
      else stats.pendingBySeverity.info++;
    } else if (row.status === 'reviewed') {
      stats.reviewed++;
    } else if (row.status === 'ignored') {
      stats.ignored++;
    }
  }
  stats.pendingSkuCount = pendingSkuIds.size;

  return stats;
}

export async function listGroupedReviewItems(input: {
  versionId?: string;
  status?: 'pending' | 'reviewed' | 'ignored';
  severity?: 'critical' | 'warning' | 'info';
  page: number;
  pageSize: number;
}): Promise<{ items: GroupedReviewItem[]; total: number }> {
  const where = reviewWhere(input.versionId, input.status);
  const offset = (input.page - 1) * input.pageSize;

  const [countRow] = await db
    .select({
      count: sql<number>`count(distinct (${salesForecastReviewItems.skuId}, ${salesForecastReviewItems.station}, ${salesForecastReviewItems.platform}))::int`,
    })
    .from(salesForecastReviewItems)
    .where(where);

  const rows = await db
    .select({
      skuId: salesForecastReviewItems.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      station: salesForecastReviewItems.station,
      platform: salesForecastReviewItems.platform,
      status: salesForecastReviewItems.status,
      severityRank: severityRankSql.mapWith(Number),
      itemIds: sql<string[]>`array_agg(${salesForecastReviewItems.id}::text order by ${salesForecastReviewItems.createdAt} desc)`,
      issueTypes: sql<string[]>`array_agg(distinct ${salesForecastReviewItems.issueType})`,
      messages: sql<string[]>`array_agg(distinct ${salesForecastReviewItems.message})`,
      suggestedDailyAvg: sql<string | null>`max(${salesForecastReviewItems.suggestedDailyAvg})`,
    })
    .from(salesForecastReviewItems)
    .innerJoin(skus, eq(skus.id, salesForecastReviewItems.skuId))
    .where(where)
    .groupBy(
      salesForecastReviewItems.skuId,
      skus.code,
      skus.name,
      salesForecastReviewItems.station,
      salesForecastReviewItems.platform,
      salesForecastReviewItems.status,
    )
    .orderBy(sql`max(${salesForecastReviewItems.createdAt}) desc`)
    .limit(input.pageSize)
    .offset(offset);

  let items = rows.map((row) => ({
    skuId: row.skuId,
    skuCode: row.skuCode,
    skuName: row.skuName ?? '',
    station: row.station,
    platform: row.platform,
    status: row.status as GroupedReviewItem['status'],
    severity: mapGroupedSeverity(row.severityRank ?? 1),
    issueTypes: row.issueTypes ?? [],
    messages: row.messages ?? [],
    itemIds: row.itemIds ?? [],
    suggestedDailyAvg:
      row.suggestedDailyAvg != null && row.suggestedDailyAvg !== ''
        ? Number(row.suggestedDailyAvg)
        : null,
  }));

  if (input.severity) {
    items = items.filter((item) => item.severity === input.severity);
  }

  return {
    items,
    total: countRow?.count ?? 0,
  };
}

export async function updateReviewItemsStatus(
  ids: string[],
  status: 'pending' | 'reviewed' | 'ignored',
): Promise<number> {
  if (ids.length === 0) return 0;
  const updated = await db
    .update(salesForecastReviewItems)
    .set({ status })
    .where(inArray(salesForecastReviewItems.id, ids))
    .returning({ id: salesForecastReviewItems.id });
  return updated.length;
}

export async function clearReviewItems(input: {
  versionId?: string;
  scope: 'all' | 'version' | 'completed';
}): Promise<{ deleted: number }> {
  const versionId = input.versionId?.trim();

  if (input.scope === 'version') {
    if (!versionId) throw new Error('versionId is required when scope is version');
    const deleted = await db
      .delete(salesForecastReviewItems)
      .where(eq(salesForecastReviewItems.versionId, versionId))
      .returning({ id: salesForecastReviewItems.id });
    return { deleted: deleted.length };
  }

  if (input.scope === 'completed') {
    const conditions = [inArray(salesForecastReviewItems.status, ['reviewed', 'ignored'])];
    if (versionId) {
      conditions.push(eq(salesForecastReviewItems.versionId, versionId));
    }
    const deleted = await db
      .delete(salesForecastReviewItems)
      .where(and(...conditions))
      .returning({ id: salesForecastReviewItems.id });
    return { deleted: deleted.length };
  }

  const deleted = await db.delete(salesForecastReviewItems).returning({ id: salesForecastReviewItems.id });
  return { deleted: deleted.length };
}

export type BatchReviewAction = 'accept_suggested' | 'ignore_info' | 'ignore_all_pending';

export async function batchProcessReviewItems(input: {
  versionId: string;
  action: BatchReviewAction;
  reviewerId: string;
}): Promise<{ updated: number; skipped: number }> {
  const versionId = input.versionId.trim();
  const version = await getForecastVersionById(versionId);
  if (!version) throw new Error('Forecast version not found');
  if (version.status !== 'draft') {
    throw new Error('Only draft version accepts batch review actions');
  }

  const pendingRows = await db
    .select()
    .from(salesForecastReviewItems)
    .where(
      and(
        eq(salesForecastReviewItems.versionId, versionId),
        eq(salesForecastReviewItems.status, 'pending'),
      ),
    );

  let targetRows = pendingRows;
  if (input.action === 'ignore_info') {
    targetRows = pendingRows.filter((row) => row.severity === 'info');
  }

  let updated = 0;
  let skipped = pendingRows.length - targetRows.length;

  const now = new Date();

  for (const row of targetRows) {
    if (input.action === 'accept_suggested') {
      await db
        .update(salesForecastReviewItems)
        .set({
          status: 'reviewed',
          reviewerId: input.reviewerId,
          reviewedAt: now,
        })
        .where(eq(salesForecastReviewItems.id, row.id));
      updated++;
      continue;
    }

    await db
      .update(salesForecastReviewItems)
      .set({
        status: 'ignored',
        reviewerId: input.reviewerId,
        reviewedAt: now,
      })
      .where(eq(salesForecastReviewItems.id, row.id));
    updated++;
  }

  return { updated, skipped };
}
