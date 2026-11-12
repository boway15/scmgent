/**
 * 履约区域 × 渠道补货规划：纯函数。
 *
 * 一期规则：履约区域码 = 销售区域码（1:1）。
 * - 区域库存 = 区域下仓库有效供给之和
 * - 渠道库存 = 区域库存 × 渠道占比（发布预测占比 → 近窗历史占比，最大余数法件数守恒）
 * - 需求 = 发布叶子 (sales_region=region, platform)，无叶子则同区同渠道历史日均
 * - `sales_region='ALL'` 遗留 Champion 不参与（叶子加载侧已排除）
 */
import {
  allocateRegionInventoryByChannel,
  CHANNEL_SHARE_HISTORY_DAYS,
  resolveChannelWeights,
} from './region-channel-inventory.js';
import { calcForwardAvgDaily } from './forecast-demand.js';
import {
  resolveFulfillmentRegion,
  resolveSalesRegion,
  type RegionMappingTables,
} from './region-mapping.js';
import { isMappableRegion, type RuntimeRegion } from './region-codes.js';
import { shouldDeferReplenishment } from './warehouse-domain.js';

export type ChannelShareSource = 'forecast' | 'history' | 'empty';
export type RegionDemandSource = 'published_leaf' | 'history';

export function regionPlatformKey(region: string, platform: string): string {
  return `${region}::${platform}`;
}

export type RegionPlatformLeaf = {
  /** 月 key → 日均（已含手工优先口径） */
  map: Map<string, number>;
  p90Map?: Map<string, number>;
  lifecycle?: string;
  profileSegment?: string;
  profileClass?: string | null;
  versionId?: string | null;
};

/** 按履约区域分组仓库；顺序按首次出现。未映射仓落入 UNMAPPED 桶。 */
export function groupWarehousesByFulfillmentRegion<T extends { code: string }>(
  warehouses: readonly T[],
  tables: RegionMappingTables,
): Map<RuntimeRegion, T[]> {
  const groups = new Map<RuntimeRegion, T[]>();
  for (const wh of warehouses) {
    const region = resolveFulfillmentRegion(wh.code, tables);
    const list = groups.get(region) ?? [];
    list.push(wh);
    groups.set(region, list);
  }
  return groups;
}

export type RegionPlatformSalesRow = {
  qtySold: number;
  saleDate: string;
  station?: string | null;
  salesRegion?: string | null;
  channel?: string | null;
};

/** 单行销量的销售区域：行上码优先，其次站点映射，未知为 UNMAPPED。 */
export function resolveSalesRowRegion(
  row: Pick<RegionPlatformSalesRow, 'salesRegion' | 'station'>,
  tables: RegionMappingTables,
): RuntimeRegion {
  const coded = row.salesRegion?.trim().toUpperCase();
  if (coded && (isMappableRegion(coded) || coded === 'UNMAPPED')) return coded as RuntimeRegion;
  return resolveSalesRegion(row.station ?? null, tables);
}

/** 销量按 区域::平台 分桶；一期销售区域 = 履约区域。 */
export function bucketSalesByRegionPlatform<T extends RegionPlatformSalesRow>(
  rows: readonly T[],
  tables: RegionMappingTables,
  platformOf: (channel: string | null | undefined) => string,
): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = regionPlatformKey(resolveSalesRowRegion(row, tables), platformOf(row.channel));
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }
  return buckets;
}

/** 近 N 天（含 asOf 前一日向前）销量合计，用于渠道占比的历史口径。 */
export function sumHistoryQty(
  rows: ReadonlyArray<{ qtySold: number; saleDate: string }>,
  asOf: Date,
  days = CHANNEL_SHARE_HISTORY_DAYS,
): number {
  const end = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const start = end - days * 86_400_000;
  let total = 0;
  for (const row of rows) {
    const ts = Date.parse(`${String(row.saleDate).slice(0, 10)}T00:00:00.000Z`);
    if (!Number.isFinite(ts) || ts < start || ts >= end) continue;
    total += Math.max(0, row.qtySold);
  }
  return total;
}

export type RegionPlatformUnitPlan = {
  platform: string;
  /** 分摊到本渠道的区域库存（件数守恒） */
  allocatedQty: number;
  /** 渠道占比（区域内） */
  weight: number;
  demandSource: RegionDemandSource;
  /** 发布叶子月曲线；无叶子时为空 Map */
  leaf: RegionPlatformLeaf | null;
  /** 未来 90 天叶子日均；无叶子为 0 */
  forwardDailyAvg: number;
  /** 同区同渠道历史日均（回退口径） */
  historyDailyAvg: number;
};

export type RegionChannelPlan = {
  fulfillmentRegion: string;
  regionQty: number;
  channelShareSource: ChannelShareSource;
  weights: Record<string, number>;
  /** 无叶子、占比由历史日均补入的渠道 */
  historyMergedPlatforms: string[];
  units: RegionPlatformUnitPlan[];
};

/**
 * 单个履约区域：解析渠道占比 → 分摊区域库存 → 每个渠道一份需求口径。
 * `empty` 表示该区域既无叶子也无历史销量，调用方应跳过。
 */
export function buildRegionChannelPlan(params: {
  fulfillmentRegion: string;
  regionQty: number;
  /** 平台 → 发布叶子 */
  leaves: ReadonlyMap<string, RegionPlatformLeaf>;
  /** 平台 → 近 CHANNEL_SHARE_HISTORY_DAYS 天销量 */
  historyQtyByPlatform: Record<string, number>;
  /** 平台 → 历史日均（需求回退口径） */
  historyDailyByPlatform: Record<string, number>;
  asOf?: Date;
}): RegionChannelPlan {
  const asOf = params.asOf ?? new Date();
  const forwardByPlatform: Record<string, number> = {};
  for (const [platform, leaf] of params.leaves) {
    forwardByPlatform[platform] = leaf.map.size ? calcForwardAvgDaily(leaf.map, asOf, 90, 0) : 0;
  }

  // 有叶子占比时，缺叶子但有历史动销的渠道用历史日均补权，避免该渠道被排除后库存守恒失真
  const forecastQty: Record<string, number> = { ...forwardByPlatform };
  const historyMerged: string[] = [];
  const hasLeafDemand = Object.values(forwardByPlatform).some((v) => v > 0);
  if (hasLeafDemand) {
    for (const [platform, daily] of Object.entries(params.historyDailyByPlatform)) {
      if (platform in forwardByPlatform) continue;
      if (daily > 0) {
        forecastQty[platform] = daily;
        historyMerged.push(platform);
      }
    }
  }

  const { source, weights } = resolveChannelWeights({
    forecastQtyByPlatform: forecastQty,
    historyQtyByPlatform: params.historyQtyByPlatform,
  });
  const allocated = allocateRegionInventoryByChannel({
    regionQty: params.regionQty,
    channelWeights: weights,
  });

  const units: RegionPlatformUnitPlan[] = Object.keys(weights)
    .sort()
    .map((platform) => {
      const leaf = params.leaves.get(platform) ?? null;
      return {
        platform,
        allocatedQty: allocated[platform] ?? 0,
        weight: weights[platform]!,
        demandSource: leaf?.map.size ? ('published_leaf' as const) : ('history' as const),
        leaf: leaf?.map.size ? leaf : null,
        forwardDailyAvg: forwardByPlatform[platform] ?? 0,
        historyDailyAvg: params.historyDailyByPlatform[platform] ?? 0,
      };
    });

  return {
    fulfillmentRegion: params.fulfillmentRegion,
    regionQty: Math.max(0, Math.floor(params.regionQty)),
    channelShareSource: source,
    weights,
    historyMergedPlatforms: historyMerged.sort(),
    units,
  };
}

/** 区域需求日均（叶子日均优先，无叶子用历史日均），用于把未分仓的共享供给按区域摊开。 */
export function regionDemandDaily(plan: RegionChannelPlan): number {
  let total = 0;
  for (const unit of plan.units) {
    total += unit.demandSource === 'published_leaf' ? unit.forwardDailyAvg : unit.historyDailyAvg;
  }
  return total;
}

type LotLike = { qty: number };

/**
 * 把一批供给批次按权重分摊给某个 key（区域或渠道）。每批用最大余数法取整，跨 key 件数守恒；分摊为 0 的批次丢弃。
 */
export function scaleLotsByWeights<T extends LotLike>(
  lots: readonly T[],
  weights: Record<string, number>,
  key: string,
): T[] {
  const out: T[] = [];
  for (const lot of lots) {
    const qty =
      allocateRegionInventoryByChannel({ regionQty: lot.qty, channelWeights: weights })[key] ?? 0;
    if (qty > 0) out.push({ ...lot, qty });
  }
  return out;
}

/** 区域需求权重（用于把未分仓的在产/海外池供给摊到各区域）。 */
export function regionDemandWeights(plans: readonly RegionChannelPlan[]): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const plan of plans) {
    const daily = regionDemandDaily(plan);
    if (daily > 0) weights[plan.fulfillmentRegion] = daily;
  }
  return weights;
}

/**
 * US 区内互调延后：仅在 fulfillmentRegion==='US' 的物理仓集合上生效。
 * 与旧逻辑一致：任一缺口仓都可由仓网余量互调，且区域覆盖天数已达目标时才延后。
 */
export function shouldDeferUsRegionUnit(input: {
  fulfillmentRegion: string;
  enabled: boolean;
  warehouses: Array<{
    effectiveQty: number;
    reorderPoint: number;
  }>;
  networkEffective: number;
  networkRop: number;
  networkCoverageDays: number;
  targetCoverageDays: number;
}): boolean {
  if (input.fulfillmentRegion !== 'US' || !input.enabled) return false;
  if (!input.warehouses.length) return false;
  const allDefer = input.warehouses.every((wh) =>
    shouldDeferReplenishment({
      warehouseEffective: wh.effectiveQty,
      warehouseRop: wh.reorderPoint,
      networkEffective: input.networkEffective,
      networkRop: input.networkRop,
    }),
  );
  return allDefer && input.networkCoverageDays >= input.targetCoverageDays;
}
