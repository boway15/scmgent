import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions, salesHistory, salesHistoryMonthly, skus } from '@scm/db';
import { daysInCalendarMonth, roundDaily } from './forecast-baseline.js';
import { mapForecastDailyFields } from './forecast-demand.js';
import type { ForecastValidationIssue } from './forecast-validation.js';
import {
  buildSeasonalIndexContext,
  historyCapEndFromStartMonth,
  meanSeasonalIndex,
  monthOf,
} from './forecast-seasonal-index.js';

export const AGGREGATE_GUARD_CODE = 'aggregate_vs_seasonal_baseline';
export const AGGREGATE_GUARD_MIN_BASELINE_QTY = 300;

export type AggregateGuardGroup = {
  projectGroup: string;
  station: string;
  forecastYear: number;
  month: number;
  forecastQty: number;
  baselineQty: number;
};

export function classifyAggregateGuardRatio(ratio: number): 'ok' | 'warning' | 'error' {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'error';
  if (ratio >= 0.8 && ratio <= 1.25) return 'ok';
  if ((ratio >= 0.65 && ratio < 0.8) || (ratio > 1.25 && ratio <= 1.5)) return 'warning';
  return 'error';
}

export function buildAggregateGuardIssues(
  groups: AggregateGuardGroup[],
  minBaselineQty = AGGREGATE_GUARD_MIN_BASELINE_QTY,
): ForecastValidationIssue[] {
  const issues: ForecastValidationIssue[] = [];
  for (const group of groups) {
    const monthLabel = `${group.forecastYear}-${String(group.month).padStart(2, '0')}`;
    const label = `${group.projectGroup || '(未分组)'} / ${group.station || 'ALL'} / ${monthLabel}`;
    if (group.baselineQty <= 0 && group.forecastQty <= 0) continue;
    if (group.baselineQty < minBaselineQty) {
      issues.push({
        level: 'info',
        code: AGGREGATE_GUARD_CODE,
        message: `${label} 季节基准 ${Math.round(group.baselineQty)} 件，低于 ${minBaselineQty} 件，不拦截`,
        station: group.station,
        forecastMonth: monthLabel,
      });
      continue;
    }
    const ratio = group.forecastQty / group.baselineQty;
    const level = classifyAggregateGuardRatio(ratio);
    if (level === 'ok') continue;
    issues.push({
      level,
      code: AGGREGATE_GUARD_CODE,
      message:
        `${label} 预测 ${Math.round(group.forecastQty)} 件，季节基准 ${Math.round(group.baselineQty)} 件，` +
        `比值 ${ratio.toFixed(2)}（通过区间 0.80–1.25）`,
      station: group.station,
      forecastMonth: monthLabel,
    });
  }
  return issues;
}

/** 填写放行原因后，只把总量护栏的 error 降为 warning。 */
export function applyAggregateGuardOverride(
  issues: ForecastValidationIssue[],
  reason?: string | null,
): ForecastValidationIssue[] {
  const text = reason?.trim() ?? '';
  if (!text) return issues;
  return issues.map((issue) => {
    if (issue.level !== 'error' || issue.code !== AGGREGATE_GUARD_CODE) return issue;
    return {
      ...issue,
      level: 'warning',
      message: `${issue.message} 人工放行：${text}`,
    };
  });
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export async function loadAggregateGuardIssues(versionId: string): Promise<ForecastValidationIssue[]> {
  const [version] = await db
    .select({ startMonth: salesForecastVersions.startMonth })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, versionId))
    .limit(1);
  if (!version?.startMonth) return [];

  const cap = historyCapEndFromStartMonth(version.startMonth);
  const capMonth = monthOf(cap);
  const context = await buildSeasonalIndexContext({ historyCapEnd: cap });
  const rows = await db
    .select({
      skuId: salesForecastMonthly.skuId,
      station: salesForecastMonthly.station,
      platform: salesForecastMonthly.platform,
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      manualDailyAvg: salesForecastMonthly.manualDailyAvg,
      category: skus.category,
      projectGroup: skus.projectGroup,
      salesCountry: skus.salesCountry,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .where(eq(salesForecastMonthly.versionId, versionId));

  const hasSpecificPlatform = rows.some((row) => row.platform !== 'ALL');
  const kept = hasSpecificPlatform ? rows.filter((row) => row.platform !== 'ALL') : rows;
  if (kept.length === 0) return [];

  const skuIds = [...new Set(kept.map((row) => row.skuId))];
  const recentDaily = await loadRecentDailyBySkuPlatform(skuIds, cap);
  const monthlyDaily = await loadRecentMonthlyDailyBySkuPlatform(skuIds, capMonth.year, capMonth.month);

  const grouped = new Map<string, AggregateGuardGroup>();
  for (const row of kept) {
    const days = daysInCalendarMonth(row.forecastYear, row.month);
    const effective = mapForecastDailyFields({
      forecastDailyAvg: row.forecastDailyAvg,
      manualDailyAvg: row.manualDailyAvg,
    }).effectiveDailyAvg;
    const pairKey = `${row.skuId}::${row.platform}`;
    const recent = recentDaily.get(pairKey) || monthlyDaily.get(pairKey) || 0;
    const seasonal = context.resolve({
      category: row.category,
      projectGroup: row.projectGroup,
      salesCountry: row.salesCountry,
    });
    const mean3 = meanSeasonalIndex(seasonal.byMonth, capMonth.year, capMonth.month, 3);
    const target = seasonal.byMonth[row.month] ?? 1;
    const baselineDaily = mean3 > 0 ? recent * (target / mean3) : recent;
    const key = `${row.projectGroup ?? ''}::${row.station}::${row.forecastYear}::${row.month}`;
    const current = grouped.get(key) ?? {
      projectGroup: row.projectGroup?.trim() || '(未分组)',
      station: row.station,
      forecastYear: row.forecastYear,
      month: row.month,
      forecastQty: 0,
      baselineQty: 0,
    };
    current.forecastQty += effective * days;
    current.baselineQty += baselineDaily * days;
    grouped.set(key, current);
  }

  return buildAggregateGuardIssues(
    [...grouped.values()].map((group) => ({
      ...group,
      forecastQty: roundDaily(group.forecastQty),
      baselineQty: roundDaily(group.baselineQty),
    })),
  );
}

async function loadRecentDailyBySkuPlatform(skuIds: string[], cap: Date): Promise<Map<string, number>> {
  const end = cap.toISOString().slice(0, 10);
  const startDate = new Date(cap.getTime());
  startDate.setUTCDate(startDate.getUTCDate() - 89);
  const start = startDate.toISOString().slice(0, 10);
  const rows = await db
    .select({
      skuId: salesHistory.skuId,
      channel: salesHistory.channel,
      qty: sql<number>`sum(${salesHistory.qtySold})::float`,
    })
    .from(salesHistory)
    .where(
      and(
        inArray(salesHistory.skuId, skuIds),
        gte(salesHistory.saleDate, start),
        lte(salesHistory.saleDate, end),
      ),
    )
    .groupBy(salesHistory.skuId, salesHistory.channel);

  const map = new Map<string, number>();
  for (const row of rows) {
    const channel = (row.channel ?? 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
    map.set(`${row.skuId}::${channel}`, (Number(row.qty) || 0) / 90);
  }
  return map;
}

async function loadRecentMonthlyDailyBySkuPlatform(
  skuIds: string[],
  capYear: number,
  capMonth: number,
): Promise<Map<string, number>> {
  const months = [0, 1, 2].map((delta) => shiftMonth(capYear, capMonth, -delta));
  const keys = new Set(months.map((item) => item.year * 100 + item.month));
  const rows = await db
    .select({
      skuId: salesHistoryMonthly.skuId,
      channel: salesHistoryMonthly.channel,
      year: salesHistoryMonthly.saleYear,
      month: salesHistoryMonthly.month,
      qty: salesHistoryMonthly.qtySold,
    })
    .from(salesHistoryMonthly)
    .where(
      and(
        inArray(salesHistoryMonthly.skuId, skuIds),
        gte(salesHistoryMonthly.saleYear, capYear - 1),
      ),
    );

  const qty = new Map<string, number>();
  const days = new Map<string, number>();
  for (const row of rows) {
    if (!keys.has(row.year * 100 + row.month)) continue;
    const key = `${row.skuId}::${row.channel.trim().toUpperCase()}`;
    qty.set(key, (qty.get(key) ?? 0) + Number(row.qty));
    days.set(key, (days.get(key) ?? 0) + daysInCalendarMonth(row.year, row.month));
  }
  const map = new Map<string, number>();
  for (const [key, total] of qty) {
    const dayCount = days.get(key) ?? 0;
    if (dayCount > 0) map.set(key, total / dayCount);
  }
  return map;
}
