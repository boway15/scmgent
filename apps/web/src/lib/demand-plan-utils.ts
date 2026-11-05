import type { DemandPlanVersionListItem, DemandPlanWeekRow } from '@/lib/api';
import { appendPlatformBreakdownToTitle } from '@/lib/forecast-platform-breakdown';
import { formatIsoWeekMondayMd, isIsoWeekPeriod } from '@/lib/iso-week';

export const DEMAND_PLAN_HORIZON_WEEKS = 26;

/** 周预测暂未接入补货计算；采用位仅登记意图 */
export const DEMAND_PLAN_REPLENISHMENT_DEFER_NOTICE =
  '补货链路暂未接入：发布/采用仅冻结或登记周预测意图，当前补货计算仍以月预测为准。';

/** 周周期表头：周一 MM-DD；月周期原样 */
export function formatDemandPlanPeriodLabel(period: string, grain: 'week' | 'month'): string {
  if (grain === 'week' && isIsoWeekPeriod(period)) {
    return formatIsoWeekMondayMd(period);
  }
  return period;
}

export function demandPlanPeriodHeaderTitle(period: string, grain: 'week' | 'month'): string | undefined {
  if (grain === 'week' && isIsoWeekPeriod(period)) {
    return `${period} · 周一 ${formatIsoWeekMondayMd(period)}`;
  }
  return undefined;
}

export const DEMAND_PLAN_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pilot_published: '已发布',
  archived: '已归档',
};

export const DEMAND_PLAN_STATUS_CLASS: Record<string, string> = {
  draft: 'border-amber-500/30 bg-amber-500/10 text-amber-800',
  pilot_published: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800',
  archived: 'border-border bg-muted text-text-sub',
};

export function formatDemandPlanDaily(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : value;
}

export function formatDemandPlanProjectGroup(projectGroup: string | null | undefined): string {
  if (!projectGroup || projectGroup === 'ALL') return '全量 SKU';
  return projectGroup;
}

export function formatDemandPlanHorizon(version: {
  startWeek?: string | null;
  horizonWeeks?: number | null;
}): string {
  const weeks = version.horizonWeeks ?? 26;
  if (!version.startWeek) return `固定 ${weeks} 周`;
  const monday = formatIsoWeekMondayMd(version.startWeek);
  return `${weeks} 周 · 周一 ${monday} 起（${version.startWeek}）`;
}

export function demandPlanPeriodGrain(version: Pick<DemandPlanVersionListItem, 'startWeek'>): 'week' | 'month' {
  return version.startWeek ? 'week' : 'month';
}

export function formatDemandPlanVersionTitle(
  versionNo: string,
  versionName?: string | null,
): string {
  const name = versionName?.trim();
  if (!name || name === versionNo) return versionNo;
  return `${versionNo} · ${name}`;
}

export function buildDemandPlanVersionDetailSearch(input?: { view?: string }): string {
  const params = new URLSearchParams();
  if (input?.view?.trim()) params.set('view', input.view.trim());
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function effectiveDemandPlanDaily(row: {
  systemDailyAvg: string;
  manualDailyAvg?: string | null;
}): string {
  return row.manualDailyAvg ?? row.systemDailyAvg;
}

export function demandPlanCellTitle(row: {
  systemDailyAvg: string;
  manualDailyAvg?: string | null;
  championForecastDaily?: string | null;
  source?: string;
}): string {
  const parts = [`生效 ${formatDemandPlanDaily(effectiveDemandPlanDaily(row))}`];
  if (row.manualDailyAvg != null) {
    parts.push(`人工 ${formatDemandPlanDaily(row.manualDailyAvg)}`);
    parts.push(`系统 ${formatDemandPlanDaily(row.systemDailyAvg)}`);
  }
  if (row.championForecastDaily != null) {
    parts.push(`Champion ${formatDemandPlanDaily(row.championForecastDaily)}`);
  }
  if (row.source) parts.push(`来源 ${row.source}`);
  return parts.join(' · ');
}

export function demandPlanMergedCellTitle(input: {
  cell: DemandPlanWeekRow;
  profileSegment?: string | null;
  mergedChannel: boolean;
}): string {
  let base = demandPlanCellTitle(input.cell);
  if (input.profileSegment) {
    base = `${base} · 分层 ${input.profileSegment}`;
  }
  if (!input.mergedChannel || !input.cell.platformBreakdown?.length) {
    return base;
  }
  return appendPlatformBreakdownToTitle(
    base,
    input.cell.platformBreakdown.map((row) => ({
      platform: row.platform,
      forecastDailyAvg: row.systemDailyAvg,
      manualDailyAvg: null,
      effectiveDailyAvg: row.effectiveDailyAvg,
    })),
  );
}

export const DEMAND_PLAN_SKIP_REASON_LABEL: Record<string, string> = {
  cross_group_spu: '跨项目组 SPU',
  accessory: '配件 SKU 不参与备货预测',
  no_share: '无仓占比',
  no_forecast: '无可用月预测形状',
  no_recent_demand: '近 90 天无销量',
};
