import { weekWeightedForecastDaily } from './demand-plan-reconstruct.js';
import {
  formatForecastChannelLabel,
  resolveForecastChannelQuery,
  type ForecastChannelQuery,
} from './forecast-channel-view.js';
import { profileSegmentSortRank } from './forecast-horizon.js';
import { FORECAST_V41_PLATFORM_CODES } from './forecast-platform-scope.js';
import type { PublishedForecastSkuMeta } from './forecast-published-resolve.js';

export type DemandPlanPlatformBreakdown = {
  platform: string;
  systemDailyAvg: number;
  effectiveDailyAvg: number;
};

export type DemandPlanPeriodRowBase = {
  id: string;
  skuId: string;
  skuCode: string | null;
  warehouseCode: string;
  period: string;
  systemDailyAvg: string;
  manualDailyAvg: string | null;
  adjustReason: string | null;
  unconstrainedRecentDaily: string | null;
  championForecastDaily: string | null;
  source: string;
};

export type DemandPlanEnrichedCell = DemandPlanPeriodRowBase & {
  platformBreakdown?: DemandPlanPlatformBreakdown[];
};

export type DemandPlanWideRow = {
  skuId: string;
  skuCode: string;
  skuName: string | null;
  platform: string;
  profileSegment: string | null;
  lifecycle: string | null;
  cells: Record<string, DemandPlanEnrichedCell>;
};

export type DemandPlanSkuRef = {
  skuId: string;
  skuCode: string | null;
  skuName?: string | null;
};

export type DemandPlanStoredRowMeta = {
  lifecycle: string | null;
  profileSegment: string | null;
};

/** 周计划行 blend_meta 兜底（矩阵 T 分层 / 生命周期不依赖二次查已发布版本） */
export function demandPlanStoredRowMetaBySku(
  rows: Array<{
    skuId: string;
    blendMeta?: { lifecycle?: string; profileSegment?: string } | null;
  }>,
): Map<string, DemandPlanStoredRowMeta> {
  const result = new Map<string, DemandPlanStoredRowMeta>();
  for (const row of rows) {
    if (result.has(row.skuId)) continue;
    const blend = row.blendMeta;
    result.set(row.skuId, {
      lifecycle: blend?.lifecycle?.trim() || null,
      profileSegment: blend?.profileSegment?.trim() || null,
    });
  }
  return result;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function toNum(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 按已发布月形状，将合计周计划拆到各平台 */
export function splitMergedWeeklyDailyByPlatform(input: {
  period: string;
  mergedSystemDaily: number;
  mergedManualDaily: number | null;
  monthByPlatform: Map<string, Map<string, number>>;
  platforms: string[];
}): {
  breakdown: DemandPlanPlatformBreakdown[];
  byPlatformEffective: Map<string, number>;
} {
  const merged = Math.max(0, input.mergedSystemDaily);
  const manual = input.mergedManualDaily;
  const platformScope = input.platforms.length
    ? input.platforms
    : [...FORECAST_V41_PLATFORM_CODES];
  const activePlatforms = platformScope.filter((code) => input.monthByPlatform.has(code));
  let targets = activePlatforms.length ? activePlatforms : [...input.monthByPlatform.keys()];
  if (!targets.length && merged > 0) {
    targets = platformScope;
  }
  if (!targets.length || merged <= 0) {
    return { breakdown: [], byPlatformEffective: new Map() };
  }

  const weights = new Map<string, number>();
  let weightSum = 0;
  for (const platform of targets) {
    const monthMap = input.monthByPlatform.get(platform);
    const weight = monthMap ? weekWeightedForecastDaily(input.period, monthMap) : 0;
    weights.set(platform, Math.max(0, weight));
    weightSum += Math.max(0, weight);
  }
  if (weightSum <= 0) {
    const even = merged / targets.length;
    const byPlatformEffective = new Map<string, number>();
    const breakdown: DemandPlanPlatformBreakdown[] = [];
    for (const platform of targets) {
      const effective = round4(manual != null ? even : even);
      byPlatformEffective.set(platform, effective);
      breakdown.push({ platform, systemDailyAvg: round4(even), effectiveDailyAvg: effective });
    }
    return { breakdown, byPlatformEffective };
  }

  const breakdown: DemandPlanPlatformBreakdown[] = [];
  const byPlatformEffective = new Map<string, number>();
  for (const platform of targets) {
    const share = (weights.get(platform) ?? 0) / weightSum;
    const systemDailyAvg = round4(merged * share);
    const effectiveDailyAvg =
      manual != null ? round4(toNum(String(manual)) * share) : systemDailyAvg;
    breakdown.push({ platform, systemDailyAvg, effectiveDailyAvg });
    byPlatformEffective.set(platform, effectiveDailyAvg);
  }
  return { breakdown, byPlatformEffective };
}

export function resolveDemandPlanChannelQuery(input: {
  channelView?: string | null;
  platforms?: string[] | null;
}): ForecastChannelQuery {
  return resolveForecastChannelQuery({
    channelView: input.channelView,
    platforms: input.platforms,
    platform: null,
  });
}

function resolveDemandPlanProfileSegment(
  skuId: string,
  metaBySku: Map<string, PublishedForecastSkuMeta>,
  storedMetaBySku?: Map<string, DemandPlanStoredRowMeta>,
): string | null | undefined {
  return (
    metaBySku.get(skuId)?.profileSegment ??
    storedMetaBySku?.get(skuId)?.profileSegment ??
    null
  );
}

export function filterSkusByProfileSegment(
  skus: DemandPlanSkuRef[],
  metaBySku: Map<string, PublishedForecastSkuMeta>,
  profileSegment?: string | null,
  storedMetaBySku?: Map<string, DemandPlanStoredRowMeta>,
): DemandPlanSkuRef[] {
  const filter = profileSegment?.trim().toUpperCase();
  if (!filter) return skus;
  return skus.filter((sku) => {
    const segment =
      resolveDemandPlanProfileSegment(sku.skuId, metaBySku, storedMetaBySku)?.trim().toUpperCase() ??
      '';
    return segment === filter;
  });
}

export function sortDemandPlanSkus(
  skus: DemandPlanSkuRef[],
  metaBySku: Map<string, PublishedForecastSkuMeta>,
  storedMetaBySku?: Map<string, DemandPlanStoredRowMeta>,
): DemandPlanSkuRef[] {
  return [...skus].sort((left, right) => {
    const rankLeft = profileSegmentSortRank(
      resolveDemandPlanProfileSegment(left.skuId, metaBySku, storedMetaBySku),
    );
    const rankRight = profileSegmentSortRank(
      resolveDemandPlanProfileSegment(right.skuId, metaBySku, storedMetaBySku),
    );
    if (rankLeft !== rankRight) return rankLeft - rankRight;
    return (left.skuCode ?? '').localeCompare(right.skuCode ?? '');
  });
}

export type DemandPlanListRowKey = { skuId: string; platform: string };

export function buildDemandPlanListRowKeys(
  skus: DemandPlanSkuRef[],
  channel: ForecastChannelQuery,
): DemandPlanListRowKey[] {
  if (channel.channelView === 'merged') {
    return skus.map((sku) => ({ skuId: sku.skuId, platform: 'ALL' }));
  }
  const platforms = channel.platforms.length ? channel.platforms : [...FORECAST_V41_PLATFORM_CODES];
  const keys: DemandPlanListRowKey[] = [];
  for (const sku of skus) {
    for (const platform of platforms) {
      keys.push({ skuId: sku.skuId, platform });
    }
  }
  return keys;
}

export function enrichDemandPlanWideRows(input: {
  rowKeys: DemandPlanListRowKey[];
  skuCodeById: Map<string, string>;
  skuNameById?: Map<string, string | null>;
  rows: DemandPlanPeriodRowBase[];
  metaBySku: Map<string, PublishedForecastSkuMeta>;
  storedMetaBySku?: Map<string, DemandPlanStoredRowMeta>;
  channel: ForecastChannelQuery;
}): DemandPlanWideRow[] {
  const rowsBySku = new Map<string, DemandPlanPeriodRowBase[]>();
  for (const row of input.rows) {
    const list = rowsBySku.get(row.skuId) ?? [];
    list.push(row);
    rowsBySku.set(row.skuId, list);
  }

  return input.rowKeys.map(({ skuId, platform }) => {
    const meta = input.metaBySku.get(skuId);
    const stored = input.storedMetaBySku?.get(skuId);
    const periodRows = rowsBySku.get(skuId) ?? [];
    const cells: Record<string, DemandPlanEnrichedCell> = {};
    for (const row of periodRows) {
      const mergedSystem = toNum(row.systemDailyAvg);
      const mergedManual = row.manualDailyAvg;
      const split = splitMergedWeeklyDailyByPlatform({
        period: row.period,
        mergedSystemDaily: mergedSystem,
        mergedManualDaily: mergedManual,
        monthByPlatform: meta?.monthByPlatform ?? new Map(),
        platforms: input.channel.platforms.length
          ? input.channel.platforms
          : [...FORECAST_V41_PLATFORM_CODES],
      });

      if (input.channel.channelView === 'merged' || platform === 'ALL') {
        cells[row.period] = {
          ...row,
          platformBreakdown: split.breakdown.length ? split.breakdown : undefined,
        };
        continue;
      }

      const platformEffective = split.byPlatformEffective.get(platform) ?? 0;
      const platformSystem =
        split.breakdown.find((item) => item.platform === platform)?.systemDailyAvg ?? 0;
      cells[row.period] = {
        ...row,
        id: `${row.id}::${platform}`,
        systemDailyAvg: String(platformSystem),
        manualDailyAvg: null,
        adjustReason: null,
      };
      if (platformEffective <= 0 && platformSystem <= 0) {
        cells[row.period].systemDailyAvg = '0';
      }
    }

    return {
      skuId,
      skuCode: input.skuCodeById.get(skuId) ?? '—',
      skuName: input.skuNameById?.get(skuId) ?? null,
      platform,
      profileSegment: stored?.profileSegment ?? meta?.profileSegment ?? null,
      lifecycle: stored?.lifecycle ?? meta?.lifecycle ?? null,
      cells,
    };
  });
}

export type DemandPlanLongRow = DemandPlanEnrichedCell & {
  skuCode: string;
  skuName: string | null;
  platform: string;
  profileSegment: string | null;
  lifecycle: string | null;
};

export function flattenDemandPlanWideToLongRows(wideRows: DemandPlanWideRow[]): DemandPlanLongRow[] {
  const items: DemandPlanLongRow[] = [];
  for (const row of wideRows) {
    for (const cell of Object.values(row.cells)) {
      items.push({
        ...cell,
        skuCode: row.skuCode,
        skuName: row.skuName,
        platform: row.platform,
        profileSegment: row.profileSegment,
        lifecycle: row.lifecycle,
      });
    }
  }
  return items.sort((left, right) => {
    const sku = (left.skuCode ?? '').localeCompare(right.skuCode ?? '');
    if (sku !== 0) return sku;
    const platform = left.platform.localeCompare(right.platform);
    if (platform !== 0) return platform;
    return left.period.localeCompare(right.period);
  });
}

export function paginateDemandPlanLongPairs(input: {
  rowKeys: DemandPlanListRowKey[];
  periods: string[];
  offset: number;
  pageSize: number;
}): {
  pairs: Array<{ rowKey: DemandPlanListRowKey; period: string }>;
  total: number;
} {
  const total = input.rowKeys.length * input.periods.length;
  const pairs: Array<{ rowKey: DemandPlanListRowKey; period: string }> = [];
  if (input.pageSize <= 0 || input.periods.length === 0) {
    return { pairs, total };
  }
  const end = Math.min(total, input.offset + input.pageSize);
  for (let index = input.offset; index < end; index += 1) {
    const keyIndex = Math.floor(index / input.periods.length);
    const periodIndex = index % input.periods.length;
    const rowKey = input.rowKeys[keyIndex];
    const period = input.periods[periodIndex];
    if (rowKey && period) {
      pairs.push({ rowKey, period });
    }
  }
  return { pairs, total };
}

export function demandPlanCellDisplayTitle(input: {
  cell: DemandPlanEnrichedCell;
  mergedChannel: boolean;
  profileSegment?: string | null;
}): string {
  const effective = input.cell.manualDailyAvg ?? input.cell.systemDailyAvg;
  const parts = [`生效 ${effective}`, `系统 ${input.cell.systemDailyAvg}`];
  if (input.cell.manualDailyAvg != null) {
    parts.push(`人工 ${input.cell.manualDailyAvg}`);
  }
  if (input.cell.championForecastDaily != null) {
    parts.push(`Champion ${input.cell.championForecastDaily}`);
  }
  if (input.cell.source) parts.push(`来源 ${input.cell.source}`);
  if (input.profileSegment) parts.push(`分层 ${input.profileSegment}`);
  let title = parts.join(' · ');
  if (input.mergedChannel && input.cell.platformBreakdown?.length) {
    const lines = input.cell.platformBreakdown.map((row) => {
      const label = formatForecastChannelLabel(row.platform);
      return `${label}：生效 ${row.effectiveDailyAvg.toFixed(2)} · 系统 ${row.systemDailyAvg.toFixed(2)}`;
    });
    title = `${title}\n—— 分平台 ——\n${lines.join('\n')}`;
  }
  return title;
}
