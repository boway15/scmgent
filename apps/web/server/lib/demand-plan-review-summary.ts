/** 周预测发布复核摘要 */

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import {
  db,
  demandPlanVersions,
  demandPlanWeekly,
  skus,
  type DemandPlanGenerationMeta,
} from '@scm/db';
import { loadPublishedForecastSkuMetaBySkuIds } from './forecast-published-resolve.js';

function isT99Segment(segment: string | null | undefined): boolean {
  return Boolean(segment && /^T99/i.test(segment.trim()));
}

export type DemandPlanReviewSummary = {
  skuTotal: number;
  rowTotal: number;
  calibratedCellCount: number;
  pendingT99SkuCount: number;
  skuWithoutChampionCount: number;
  skippedByReason: Record<string, number>;
  championForecastVersionId: string | null;
  startWeek: string | null;
};

export async function buildDemandPlanReviewSummary(versionId: string): Promise<DemandPlanReviewSummary> {
  const [version] = await db
    .select()
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, versionId))
    .limit(1);
  if (!version) {
    throw Object.assign(new Error('需求计划版本不存在'), { status: 404 });
  }

  const [[statsRow], [calibratedRow], skuRows] = await Promise.all([
    db
      .select({
        rowTotal: sql<number>`count(*)::int`,
        skuTotal: sql<number>`count(distinct ${demandPlanWeekly.skuId})::int`,
      })
      .from(demandPlanWeekly)
      .where(eq(demandPlanWeekly.versionId, versionId)),
    db
      .select({
        calibratedCellCount: sql<number>`count(*)::int`,
      })
      .from(demandPlanWeekly)
      .where(
        and(eq(demandPlanWeekly.versionId, versionId), isNotNull(demandPlanWeekly.manualDailyAvg)),
      ),
    db
      .selectDistinct({
        skuId: demandPlanWeekly.skuId,
        skuCode: skus.code,
      })
      .from(demandPlanWeekly)
      .innerJoin(skus, eq(skus.id, demandPlanWeekly.skuId))
      .where(eq(demandPlanWeekly.versionId, versionId)),
  ]);

  const skuIds = skuRows.map((row) => row.skuId);
  const metaBySku = skuIds.length
    ? await loadPublishedForecastSkuMetaBySkuIds(skuIds)
    : new Map();

  let pendingT99SkuCount = 0;
  let skuWithoutChampionCount = 0;
  for (const row of skuRows) {
    const meta = metaBySku.get(row.skuId);
    if (!meta?.versionId) {
      skuWithoutChampionCount += 1;
      continue;
    }
    if (isT99Segment(meta.profileSegment)) pendingT99SkuCount += 1;
  }

  const generationMeta = (version.generationMeta ?? null) as DemandPlanGenerationMeta | null;

  return {
    skuTotal: statsRow?.skuTotal ?? 0,
    rowTotal: statsRow?.rowTotal ?? 0,
    calibratedCellCount: calibratedRow?.calibratedCellCount ?? 0,
    pendingT99SkuCount,
    skuWithoutChampionCount,
    skippedByReason: generationMeta?.skippedByReason ?? {},
    championForecastVersionId: version.championForecastVersionId ?? null,
    startWeek: version.startWeek ?? null,
  };
}
