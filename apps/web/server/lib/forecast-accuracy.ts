import { eq, and, sql } from 'drizzle-orm';
import {
  db,
  salesForecastMonthly,
  skus,
  forecastAccuracyMonthly,
  salesForecastReviewItems,
} from '@scm/db';
import { getPrimaryPublishedVersionId } from './forecast-version.js';
import { formatForecastMonth } from './forecast-demand.js';
import { segmentLabel } from './forecast-profile-class.js';
import { forecastPlatformCondition } from './forecast-platform-scope.js';
import { buildCsv } from './csv-export.js';
import {
  computeMonthlyAvgMape,
  computeMonthlyAvgWmape,
  capSkuWmapeForStats,
  summarizeAccuracyByTier,
  type AccuracyTierSummary,
} from './forecast-accuracy-tier.js';
import {
  summarizeAccuracyByHorizonBand,
  summarizeAccuracyMatrix,
  type SegmentMatrixSummary,
  type SegmentBandStats,
  type HorizonBandStats,
} from './forecast-horizon-band.js';
import {
  classifyForecastProfile,
  isComparableForAccuracy,
  type ProfileClass,
} from './forecast-profile-class.js';
import {
  buildCompletedCalendarMonths,
  resolveActualMonthlyDailyAvg,
} from './sales-history-monthly.js';
import {
  buildReviewItemIdentity,
  type ReviewItemDraft,
} from './forecast-collaboration.js';
import { isForecastRowIncludedInAccuracyStats } from './forecast-accuracy-comparable.js';

export type ForecastAccuracySummary = AccuracyTierSummary & {
  byHorizonBand: HorizonBandStats[];
  byProfileClass: Array<{
    profileClass: ProfileClass;
    skuCount: number;
    comparableRows: number;
    wmape: number | null;
    weightedBias: number | null;
  }>;
  bySegment: SegmentBandStats[];
  matrix: SegmentMatrixSummary;
  classificationSource: 'persisted' | 'estimated';
  dGhostCount: number;
  cPoolComparableRows: number;
};

type ReviewStatus = 'pending' | 'reviewed' | 'ignored';
type ReviewItemWriter = Pick<typeof db, 'insert' | 'update'>;

export function shouldRefreshLowAccuracyReviewItem(status: ReviewStatus): boolean {
  return status === 'pending';
}

export function shouldCreateLowAccuracyReviewItem(input: {
  mape: number | null;
  actualDaily: number;
  forecastDaily: number;
}): boolean {
  return (input.mape != null && input.mape > 0.3) || (input.actualDaily === 0 && input.forecastDaily > 0);
}

export function buildLowAccuracyReviewItem(input: {
  skuId: string;
  skuCode: string;
  station: string;
  platform: string;
  targetYear: number;
  targetMonth: number;
  mape: number | null;
  actualDaily: number;
  forecastDaily: number;
  profileClass?: ProfileClass | null;
}): ReviewItemDraft {
  const forecastMonth = formatForecastMonth(input.targetYear, input.targetMonth);
  const message =
    input.mape != null
      ? `${input.skuCode} ${forecastMonth} MAPE ${Math.round(input.mape * 100)}%，需复核下一轮预测`
      : `${input.skuCode} ${forecastMonth} 实际日均为 0，预测日均 ${input.forecastDaily.toFixed(2)}，需复核下一轮预测`;

  const biasRate =
    input.forecastDaily > 0 ? (input.actualDaily - input.forecastDaily) / input.forecastDaily : 0;
  const suggestCalibration =
    input.profileClass === 'A' && Math.abs(biasRate) > 0.15 && input.actualDaily > 0;

  return {
    skuId: input.skuId,
    station: input.station,
    platform: input.platform,
    issueType: 'low_accuracy',
    severity: 'warning',
    message,
    suggestedDailyAvg: suggestCalibration ? input.actualDaily : input.actualDaily,
  };
}

export function buildExogenousShockReviewItem(input: {
  skuId: string;
  skuCode: string;
  station: string;
  platform: string;
  reasonLabel: string;
  note?: string;
}): ReviewItemDraft {
  return {
    skuId: input.skuId,
    station: input.station,
    platform: input.platform,
    issueType: 'exogenous_shock',
    severity: 'info',
    message: `${input.skuCode} 外生冲击（${input.reasonLabel}）${input.note ? `：${input.note}` : ''}，统计时已从核心 KPI 剔除`,
    suggestedDailyAvg: 0,
  };
}

async function upsertLowAccuracyReviewItem(
  writer: ReviewItemWriter,
  versionId: string,
  item: ReviewItemDraft,
) {
  const identity = buildReviewItemIdentity(versionId, item);

  const values = {
    severity: item.severity,
    message: item.message,
    suggestedDailyAvg:
      item.suggestedDailyAvg != null ? String(item.suggestedDailyAvg) : undefined,
  };

  await writer
    .insert(salesForecastReviewItems)
    .values({
      versionId: identity.versionId,
      skuId: identity.skuId,
      station: identity.station,
      platform: identity.platform,
      issueType: identity.issueType,
      ...values,
    })
    .onConflictDoNothing({
      target: [
        salesForecastReviewItems.versionId,
        salesForecastReviewItems.skuId,
        salesForecastReviewItems.station,
        salesForecastReviewItems.platform,
        salesForecastReviewItems.issueType,
      ],
    });

  await writer
    .update(salesForecastReviewItems)
    .set(values)
    .where(
      and(
        eq(salesForecastReviewItems.versionId, identity.versionId),
        eq(salesForecastReviewItems.skuId, identity.skuId),
        eq(salesForecastReviewItems.station, identity.station),
        eq(salesForecastReviewItems.platform, identity.platform),
        eq(salesForecastReviewItems.issueType, identity.issueType),
        eq(salesForecastReviewItems.status, 'pending'),
      ),
    );
}

export async function computeForecastAccuracyForMonth(
  targetYear: number,
  targetMonth: number,
  options?: {
    versionId?: string;
    createReviewItems?: boolean;
    station?: string;
    platform?: string;
  },
) {
  const versionId = options?.versionId ?? (await getPrimaryPublishedVersionId());
  if (!versionId) {
    return {
      upserted: 0,
      highMapeCount: 0,
      targetMonth: formatForecastMonth(targetYear, targetMonth),
      skipped: true as const,
    };
  }

  const station = options?.station?.trim().toUpperCase();

  const forecastConditions = [
    eq(salesForecastMonthly.versionId, versionId),
    eq(salesForecastMonthly.forecastYear, targetYear),
    eq(salesForecastMonthly.month, targetMonth),
  ];
  if (station) forecastConditions.push(eq(salesForecastMonthly.station, station));
  const platformCond = forecastPlatformCondition(salesForecastMonthly.platform, options?.platform);
  if (platformCond) forecastConditions.push(platformCond);

  const forecastRows = await db
    .select({
      skuId: salesForecastMonthly.skuId,
      skuCode: skus.code,
      station: salesForecastMonthly.station,
      platform: salesForecastMonthly.platform,
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      forecastProfileClass: salesForecastMonthly.forecastProfileClass,
      profileSegment: salesForecastMonthly.profileSegment,
      forecastDailyP10: salesForecastMonthly.forecastDailyP10,
      forecastDailyP90: salesForecastMonthly.forecastDailyP90,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .where(and(...forecastConditions));

  let upserted = 0;
  let highMapeCount = 0;

  for (const row of forecastRows) {
    const forecastDaily = Number(row.forecastDailyAvg);
    if (forecastDaily <= 0) continue;

    const { actualDaily } = await resolveActualMonthlyDailyAvg({
      skuId: row.skuId,
      channel: row.platform,
      year: targetYear,
      month: targetMonth,
    });

    if (!isForecastRowIncludedInAccuracyStats({ forecastDaily })) {
      continue;
    }

    const profileClass = (row.forecastProfileClass as ProfileClass | null) ?? null;

    const biasRate = forecastDaily > 0 ? (actualDaily - forecastDaily) / forecastDaily : 0;
    const mape =
      actualDaily > 0 ? Math.abs(actualDaily - forecastDaily) / actualDaily : null;

    if (shouldCreateLowAccuracyReviewItem({ mape, actualDaily, forecastDaily })) {
      highMapeCount++;
    }

    const values = {
      forecastDailyAvg: String(forecastDaily),
      actualDailyAvg: String(actualDaily),
      biasRate: biasRate != null ? String(biasRate) : null,
      mape: mape != null ? String(mape) : null,
      computedAt: new Date(),
    };

    await db.transaction(async (tx) => {
      await tx
        .insert(forecastAccuracyMonthly)
        .values({
          skuId: row.skuId,
          station: row.station,
          platform: row.platform,
          forecastYear: targetYear,
          month: targetMonth,
          versionId,
          ...values,
        })
        .onConflictDoUpdate({
          target: [
            forecastAccuracyMonthly.skuId,
            forecastAccuracyMonthly.station,
            forecastAccuracyMonthly.platform,
            forecastAccuracyMonthly.forecastYear,
            forecastAccuracyMonthly.month,
            forecastAccuracyMonthly.versionId,
          ],
          set: values,
        });

      if (
        options?.createReviewItems !== false &&
        shouldCreateLowAccuracyReviewItem({ mape, actualDaily, forecastDaily })
      ) {
        await upsertLowAccuracyReviewItem(
          tx,
          versionId,
          buildLowAccuracyReviewItem({
            skuId: row.skuId,
            skuCode: row.skuCode,
            station: row.station,
            platform: row.platform,
            targetYear,
            targetMonth,
            mape,
            actualDaily,
            forecastDaily,
            profileClass,
          }),
        );
      }
    });
    upserted++;
  }

  return {
    upserted,
    highMapeCount,
    targetMonth: formatForecastMonth(targetYear, targetMonth),
    skipped: false as const,
  };
}

export function buildForecastAccuracyBacktestSummary(input: {
  monthResults: Array<{
    year: number;
    month: number;
    upserted: number;
    highMapeCount: number;
    skipped?: boolean;
  }>;
  totalUpserted: number;
  totalHighMapeCount: number;
}): string {
  const lines = [
    '【批量准确率回测】',
    `回测月份数：${input.monthResults.length}`,
    `写入准确率记录：${input.totalUpserted}`,
    `高偏差 SKU 次数（MAPE>30%）：${input.totalHighMapeCount}`,
  ];

  if (input.monthResults.length) {
    lines.push('', '分月统计：');
    for (const month of input.monthResults) {
      const label = formatForecastMonth(month.year, month.month);
      if (month.skipped) {
        lines.push(`- ${label}：跳过（无可用预测版本）`);
        continue;
      }
      lines.push(`- ${label}：${month.upserted} 条记录，高偏差 ${month.highMapeCount} 次`);
    }
  }

  return lines.join('\n');
}

export async function computeForecastAccuracyBacktest(input?: {
  monthCount?: number;
  versionId?: string;
  createReviewItems?: boolean;
  today?: Date;
}) {
  const monthCount = Math.min(24, Math.max(1, Math.floor(input?.monthCount ?? 6)));
  const months = buildCompletedCalendarMonths(monthCount, input?.today ?? new Date());
  const monthResults: Array<{
    year: number;
    month: number;
    upserted: number;
    highMapeCount: number;
    skipped?: boolean;
  }> = [];

  let totalUpserted = 0;
  let totalHighMapeCount = 0;

  for (const { year, month } of months) {
    const result = await computeForecastAccuracyForMonth(year, month, {
      versionId: input?.versionId,
      createReviewItems: input?.createReviewItems,
    });
    monthResults.push({
      year,
      month,
      upserted: result.upserted,
      highMapeCount: result.highMapeCount,
      skipped: result.skipped,
    });
    totalUpserted += result.upserted;
    totalHighMapeCount += result.highMapeCount;
  }

  const summary = buildForecastAccuracyBacktestSummary({
    monthResults,
    totalUpserted,
    totalHighMapeCount,
  });

  return {
    monthCount,
    monthResults,
    totalUpserted,
    totalHighMapeCount,
    summary,
  };
}

export async function getVersionAccuracyWmape(versionId: string): Promise<number | null> {
  const [row] = await db
    .select({ wmape: sql<number | null>`avg(${forecastAccuracyMonthly.mape})::float` })
    .from(forecastAccuracyMonthly)
    .where(eq(forecastAccuracyMonthly.versionId, versionId));
  return row?.wmape != null ? Number(row.wmape) : null;
}

export async function listForecastAccuracy(params?: {
  year?: number;
  month?: number;
  station?: string;
  platform?: string;
  versionId?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
}) {
  const page = Math.max(1, params?.page ?? 1);
  const pageSize = Math.min(
    100,
    Math.max(1, params?.pageSize ?? params?.limit ?? 20),
  );
  const offset = (page - 1) * pageSize;
  const conditions = [];
  if (params?.year) conditions.push(eq(forecastAccuracyMonthly.forecastYear, params.year));
  if (params?.month) conditions.push(eq(forecastAccuracyMonthly.month, params.month));
  if (params?.station) conditions.push(eq(forecastAccuracyMonthly.station, params.station));
  const platformCond = forecastPlatformCondition(forecastAccuracyMonthly.platform, params?.platform);
  if (platformCond) conditions.push(platformCond);
  if (params?.versionId) conditions.push(eq(forecastAccuracyMonthly.versionId, params.versionId));
  const where = conditions.length ? and(...conditions) : undefined;

  const base = db
    .select({
      id: forecastAccuracyMonthly.id,
      skuId: forecastAccuracyMonthly.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      station: forecastAccuracyMonthly.station,
      platform: forecastAccuracyMonthly.platform,
      forecastYear: forecastAccuracyMonthly.forecastYear,
      month: forecastAccuracyMonthly.month,
      forecastDailyAvg: forecastAccuracyMonthly.forecastDailyAvg,
      actualDailyAvg: forecastAccuracyMonthly.actualDailyAvg,
      biasRate: forecastAccuracyMonthly.biasRate,
      mape: forecastAccuracyMonthly.mape,
      computedAt: forecastAccuracyMonthly.computedAt,
      profileSegment: salesForecastMonthly.profileSegment,
    })
    .from(forecastAccuracyMonthly)
    .innerJoin(skus, eq(skus.id, forecastAccuracyMonthly.skuId))
    .leftJoin(
      salesForecastMonthly,
      and(
        eq(salesForecastMonthly.versionId, forecastAccuracyMonthly.versionId),
        eq(salesForecastMonthly.skuId, forecastAccuracyMonthly.skuId),
        eq(salesForecastMonthly.station, forecastAccuracyMonthly.station),
        eq(salesForecastMonthly.platform, forecastAccuracyMonthly.platform),
        eq(salesForecastMonthly.forecastYear, forecastAccuracyMonthly.forecastYear),
        eq(salesForecastMonthly.month, forecastAccuracyMonthly.month),
      ),
    )
    .$dynamic();

  const [rows, countRow] = await Promise.all([
    base
      .where(where)
      .orderBy(skus.code, forecastAccuracyMonthly.forecastYear, forecastAccuracyMonthly.month)
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(forecastAccuracyMonthly)
      .where(where),
  ]);

  return {
    items: rows.map((r) => {
      const forecastDailyAvg = Number(r.forecastDailyAvg);
      const actualDailyAvg = Number(r.actualDailyAvg);
      const biasVsActual =
        actualDailyAvg > 0 ? (forecastDailyAvg - actualDailyAvg) / actualDailyAvg : null;
      const profileSegment = r.profileSegment?.trim() || null;
      return {
        ...r,
        forecastMonth: formatForecastMonth(r.forecastYear, r.month),
        forecastDailyAvg,
        actualDailyAvg,
        biasRate: r.biasRate != null ? Number(r.biasRate) : null,
        biasVsActual,
        mape: r.mape != null ? Number(r.mape) : null,
        profileSegment,
        profileSegmentLabel: profileSegment ? segmentLabel(profileSegment) : null,
      };
    }),
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  };
}

export async function buildForecastAccuracyExportCsv(params: {
  versionId: string;
  station?: string;
  platform?: string;
  year?: number;
  month?: number;
  limit?: number;
}): Promise<{ csv: string; rowCount: number }> {
  const limit = Math.min(Math.max(1, params.limit ?? 100_000), 100_000);
  const conditions = [eq(forecastAccuracyMonthly.versionId, params.versionId)];
  if (params.year) conditions.push(eq(forecastAccuracyMonthly.forecastYear, params.year));
  if (params.month) conditions.push(eq(forecastAccuracyMonthly.month, params.month));
  if (params.station) conditions.push(eq(forecastAccuracyMonthly.station, params.station));
  const platformCond = forecastPlatformCondition(forecastAccuracyMonthly.platform, params.platform);
  if (platformCond) conditions.push(platformCond);
  const where = and(...conditions);

  const rows = await db
    .select({
      skuCode: skus.code,
      skuName: skus.name,
      station: forecastAccuracyMonthly.station,
      platform: forecastAccuracyMonthly.platform,
      forecastYear: forecastAccuracyMonthly.forecastYear,
      month: forecastAccuracyMonthly.month,
      forecastDailyAvg: forecastAccuracyMonthly.forecastDailyAvg,
      actualDailyAvg: forecastAccuracyMonthly.actualDailyAvg,
      mape: forecastAccuracyMonthly.mape,
      profileSegment: salesForecastMonthly.profileSegment,
    })
    .from(forecastAccuracyMonthly)
    .innerJoin(skus, eq(skus.id, forecastAccuracyMonthly.skuId))
    .leftJoin(
      salesForecastMonthly,
      and(
        eq(salesForecastMonthly.versionId, forecastAccuracyMonthly.versionId),
        eq(salesForecastMonthly.skuId, forecastAccuracyMonthly.skuId),
        eq(salesForecastMonthly.station, forecastAccuracyMonthly.station),
        eq(salesForecastMonthly.platform, forecastAccuracyMonthly.platform),
        eq(salesForecastMonthly.forecastYear, forecastAccuracyMonthly.forecastYear),
        eq(salesForecastMonthly.month, forecastAccuracyMonthly.month),
      ),
    )
    .where(where)
    .orderBy(skus.code, forecastAccuracyMonthly.forecastYear, forecastAccuracyMonthly.month)
    .limit(limit);

  const csv = buildCsv(
    [
      'sku_code',
      'sku_name',
      'profile_segment',
      'profile_segment_label',
      'station',
      'platform',
      'forecast_month',
      'forecast_daily_avg',
      'actual_daily_avg',
      'bias_vs_actual_pct',
      'mape_pct',
    ],
    rows.map((r) => {
      const forecastDailyAvg = Number(r.forecastDailyAvg);
      const actualDailyAvg = Number(r.actualDailyAvg);
      const biasVsActual =
        actualDailyAvg > 0 ? (forecastDailyAvg - actualDailyAvg) / actualDailyAvg : null;
      const profileSegment = r.profileSegment?.trim() || '';
      return [
        r.skuCode,
        r.skuName ?? '',
        profileSegment,
        profileSegment ? segmentLabel(profileSegment) : '',
        r.station,
        r.platform,
        formatForecastMonth(r.forecastYear, r.month),
        forecastDailyAvg.toFixed(4),
        actualDailyAvg.toFixed(4),
        biasVsActual != null ? (biasVsActual * 100).toFixed(2) : '',
        r.mape != null ? (Number(r.mape) * 100).toFixed(2) : '',
      ];
    }),
  );

  return { csv, rowCount: rows.length };
}

export async function buildForecastAccuracySkuExportCsv(params: {
  versionId: string;
  station?: string;
  platform?: string;
  year?: number;
  month?: number;
  limit?: number;
}): Promise<{ csv: string; rowCount: number }> {
  const limit = Math.min(Math.max(1, params.limit ?? 100_000), 100_000);
  const conditions = [eq(forecastAccuracyMonthly.versionId, params.versionId)];
  if (params.year) conditions.push(eq(forecastAccuracyMonthly.forecastYear, params.year));
  if (params.month) conditions.push(eq(forecastAccuracyMonthly.month, params.month));
  if (params.station) conditions.push(eq(forecastAccuracyMonthly.station, params.station));
  const platformCond = forecastPlatformCondition(forecastAccuracyMonthly.platform, params.platform);
  if (platformCond) conditions.push(platformCond);
  const where = and(...conditions);

  const rows = await db
    .select({
      skuCode: skus.code,
      skuName: skus.name,
      station: forecastAccuracyMonthly.station,
      platform: forecastAccuracyMonthly.platform,
      forecastDailyAvg: forecastAccuracyMonthly.forecastDailyAvg,
      actualDailyAvg: forecastAccuracyMonthly.actualDailyAvg,
      profileSegment: salesForecastMonthly.profileSegment,
    })
    .from(forecastAccuracyMonthly)
    .innerJoin(skus, eq(skus.id, forecastAccuracyMonthly.skuId))
    .leftJoin(
      salesForecastMonthly,
      and(
        eq(salesForecastMonthly.versionId, forecastAccuracyMonthly.versionId),
        eq(salesForecastMonthly.skuId, forecastAccuracyMonthly.skuId),
        eq(salesForecastMonthly.station, forecastAccuracyMonthly.station),
        eq(salesForecastMonthly.platform, forecastAccuracyMonthly.platform),
        eq(salesForecastMonthly.forecastYear, forecastAccuracyMonthly.forecastYear),
        eq(salesForecastMonthly.month, forecastAccuracyMonthly.month),
      ),
    )
    .where(where)
    .orderBy(skus.code, forecastAccuracyMonthly.station, forecastAccuracyMonthly.platform);

  type SkuAgg = {
    skuCode: string;
    skuName: string;
    station: string;
    platform: string;
    profileSegment: string;
    comparableRows: number;
    ghostRows: number;
    zeroForecastMissRows: number;
    actualSum: number;
    forecastSum: number;
    absErrSum: number;
    signedErrSum: number;
  };

  const byKey = new Map<string, SkuAgg>();
  for (const row of rows) {
    const key = `${row.skuCode}|${row.station}|${row.platform}`;
    const forecastDaily = Number(row.forecastDailyAvg);
    const actualDaily = Number(row.actualDailyAvg);
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        skuCode: row.skuCode,
        skuName: row.skuName ?? '',
        station: row.station,
        platform: row.platform,
        profileSegment: row.profileSegment?.trim() || '',
        comparableRows: 0,
        ghostRows: 0,
        zeroForecastMissRows: 0,
        actualSum: 0,
        forecastSum: 0,
        absErrSum: 0,
        signedErrSum: 0,
      };
      byKey.set(key, agg);
    }
    if (!agg.profileSegment && row.profileSegment?.trim()) {
      agg.profileSegment = row.profileSegment.trim();
    }
    if (forecastDaily > 0) {
      agg.comparableRows += 1;
      if (actualDaily > 0) {
        agg.actualSum += actualDaily;
        agg.forecastSum += forecastDaily;
        agg.absErrSum += Math.abs(forecastDaily - actualDaily);
        agg.signedErrSum += forecastDaily - actualDaily;
      } else {
        agg.ghostRows += 1;
      }
    } else if (actualDaily > 0) {
      agg.zeroForecastMissRows += 1;
    }
  }

  const skuRows = [...byKey.values()]
    .map((agg) => {
      const rawWmape = agg.actualSum > 0 ? agg.absErrSum / agg.actualSum : null;
      const wmape = capSkuWmapeForStats(rawWmape);
      const bias = agg.actualSum > 0 ? agg.signedErrSum / agg.actualSum : null;
      return { ...agg, rawWmape, wmape, bias };
    })
    .sort((a, b) => (b.wmape ?? 0) - (a.wmape ?? 0))
    .slice(0, limit);

  const csv = buildCsv(
    [
      'sku_code',
      'sku_name',
      'profile_segment',
      'profile_segment_label',
      'station',
      'platform',
      'comparable_rows',
      'ghost_rows',
      'zero_forecast_miss_rows',
      'actual_daily_sum',
      'forecast_daily_sum',
      'wmape_pct',
      'wmape_raw_pct',
      'bias_pct',
    ],
    skuRows.map((r) => [
      r.skuCode,
      r.skuName,
      r.profileSegment,
      r.profileSegment ? segmentLabel(r.profileSegment) : '',
      r.station,
      r.platform,
      r.comparableRows,
      r.ghostRows,
      r.zeroForecastMissRows,
      r.actualSum.toFixed(4),
      r.forecastSum.toFixed(4),
      r.wmape != null ? (r.wmape * 100).toFixed(2) : '',
      r.rawWmape != null ? (r.rawWmape * 100).toFixed(2) : '',
      r.bias != null ? (r.bias * 100).toFixed(2) : '',
    ]),
  );

  return { csv, rowCount: skuRows.length };
}

export async function summarizeForecastAccuracy(
  params?: AccuracySummaryOptions,
): Promise<ForecastAccuracySummary> {
  const conditions = [];
  if (params?.versionId) {
    conditions.push(eq(forecastAccuracyMonthly.versionId, params.versionId));
  }
  if (params?.year) conditions.push(eq(forecastAccuracyMonthly.forecastYear, params.year));
  if (params?.month) conditions.push(eq(forecastAccuracyMonthly.month, params.month));
  if (params?.station) conditions.push(eq(forecastAccuracyMonthly.station, params.station));
  const platformCond = forecastPlatformCondition(forecastAccuracyMonthly.platform, params?.platform);
  if (platformCond) conditions.push(platformCond);
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      skuId: forecastAccuracyMonthly.skuId,
      skuCode: skus.code,
      category: skus.category,
      actualDailyAvg: forecastAccuracyMonthly.actualDailyAvg,
      forecastDailyAvg: forecastAccuracyMonthly.forecastDailyAvg,
      biasRate: forecastAccuracyMonthly.biasRate,
      mape: forecastAccuracyMonthly.mape,
      forecastYear: forecastAccuracyMonthly.forecastYear,
      month: forecastAccuracyMonthly.month,
      profileSegment: salesForecastMonthly.profileSegment,
      forecastDailyP10: salesForecastMonthly.forecastDailyP10,
      forecastDailyP90: salesForecastMonthly.forecastDailyP90,
      forecastProfileClass: salesForecastMonthly.forecastProfileClass,
    })
    .from(forecastAccuracyMonthly)
    .innerJoin(skus, eq(skus.id, forecastAccuracyMonthly.skuId))
    .leftJoin(
      salesForecastMonthly,
      and(
        eq(salesForecastMonthly.versionId, forecastAccuracyMonthly.versionId),
        eq(salesForecastMonthly.skuId, forecastAccuracyMonthly.skuId),
        eq(salesForecastMonthly.station, forecastAccuracyMonthly.station),
        eq(salesForecastMonthly.platform, forecastAccuracyMonthly.platform),
        eq(salesForecastMonthly.forecastYear, forecastAccuracyMonthly.forecastYear),
        eq(salesForecastMonthly.month, forecastAccuracyMonthly.month),
      ),
    )
    .where(where);

  let persistedSegments = 0;
  const accuracyInputs = rows.map((row) => {
    const hasPersisted = Boolean(row.profileSegment);
    if (hasPersisted) persistedSegments += 1;
    return {
      skuId: row.skuId,
      skuCode: row.skuCode,
      category: row.category,
      actualDaily: Number(row.actualDailyAvg),
      forecastDaily: Number(row.forecastDailyAvg),
      mape: row.mape != null ? Number(row.mape) : null,
      biasRate: row.biasRate != null ? Number(row.biasRate) : null,
      forecastYear: row.forecastYear,
      month: row.month,
      profileSegment: row.profileSegment ?? undefined,
      forecastDailyP10: row.forecastDailyP10 != null ? Number(row.forecastDailyP10) : null,
      forecastDailyP90: row.forecastDailyP90 != null ? Number(row.forecastDailyP90) : null,
      classificationEstimated: !hasPersisted,
    };
  });

  const classificationSource: 'persisted' | 'estimated' =
    accuracyInputs.length > 0 && persistedSegments === accuracyInputs.length
      ? 'persisted'
      : persistedSegments > 0
        ? 'persisted'
        : 'estimated';

  const segmentBySku = new Map<string, string>();
  for (const row of accuracyInputs) {
    if (row.profileSegment) {
      segmentBySku.set(row.skuCode, row.profileSegment);
    }
  }

  const tierSummary = summarizeAccuracyByTier(accuracyInputs);
  const matrix = summarizeAccuracyMatrix(accuracyInputs, {
    asOf: params?.asOf,
    segmentBySku: segmentBySku.size > 0 ? (segmentBySku as Map<string, import('./forecast-profile-class.js').ProfileSegment>) : undefined,
  });
  const byHorizonBand = summarizeAccuracyByHorizonBand(accuracyInputs, params?.asOf);

  const byProfileClass = (['A', 'B', 'C', 'D'] as ProfileClass[]).map((profileClass) => {
    const classRows = accuracyInputs.filter((row) => {
      if (row.profileSegment) {
        return row.profileSegment.startsWith(`${profileClass}:`);
      }
      const monthly = [row.actualDaily];
      return classifyForecastProfile(monthly) === profileClass;
    });
    const comparable = classRows.filter((r) => r.actualDaily > 0);
    const wmape = computeMonthlyAvgWmape(classRows);
    const weightedBias = computeMonthlyAvgMape(classRows);
    return {
      profileClass,
      skuCount: new Set(classRows.map((r) => r.skuCode)).size,
      comparableRows: comparable.length,
      wmape,
      weightedBias,
    };
  });

  const dGhostCount = accuracyInputs.filter(
    (row) =>
      (row.profileSegment?.startsWith('D:') || row.profileSegment === 'D:floor') &&
      row.actualDaily === 0 &&
      row.forecastDaily > 0,
  ).length;

  const cPoolComparableRows = accuracyInputs.filter(
    (row) => row.profileSegment === 'C:pool' && row.actualDaily > 0,
  ).length;

  return {
    ...tierSummary,
    byHorizonBand,
    byProfileClass,
    bySegment: matrix.bySegment,
    matrix,
    classificationSource,
    dGhostCount,
    cPoolComparableRows,
  };
}

export type AccuracySummaryOptions = {
  versionId?: string;
  year?: number;
  month?: number;
  station?: string;
  platform?: string;
  asOf?: Date;
};
