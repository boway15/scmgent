/**
 * 履约区域 × 渠道决策单元编排（补货任务与缺货预警共用）。
 *
 * 输入为某 SKU 已算好的物理仓健康行（取有效供给 / 交期 / ROP），输出每个 (履约区域, 渠道) 单元的
 * 健康行与时间轴。物理仓健康仍用于快照、安全库存回写与区内追溯，不再作为建议/预警粒度。
 */
import type { PublishedLeafEntry } from './forecast-published-resolve.js';
import {
  computeRegionChannelHealth,
  resolveHistoricalDemand,
  type RegionChannelHealthRow,
  type SkuHealthRow,
} from './inventory-health-service.js';
import { assembleRegionChannelTimeline } from './inventory-timeline-service.js';
import type { OpenTimelineLot } from './inventory-supply-lot-sync.js';
import type { InventorySnapshot } from './inventory-snapshot.js';
import {
  IN_PRODUCTION_WAREHOUSE,
  UNALLOCATED_TRANSIT_WAREHOUSE,
} from './inventory-constants.js';
import { profileClassFromSegment } from './forecast-profile-class.js';
import { CHANNEL_SHARE_HISTORY_DAYS } from './region-channel-inventory.js';
import {
  bucketSalesByRegionPlatform,
  buildRegionChannelPlan,
  groupWarehousesByFulfillmentRegion,
  regionDemandDaily,
  regionDemandWeights,
  regionPlatformKey,
  scaleLotsByWeights,
  sumHistoryQty,
  type RegionChannelPlan,
  type RegionPlatformLeaf,
  type RegionPlatformSalesRow,
  type RegionPlatformUnitPlan,
} from './region-channel-planning.js';
import type { RegionMappingTables } from './region-mapping.js';
import { replenishmentSalesLookbackDays } from './sales-history-config.js';

export type RegionChannelUnit = {
  fulfillmentRegion: string;
  platform: string;
  plan: RegionChannelPlan;
  planUnit: RegionPlatformUnitPlan;
  regionWarehouseHealth: SkuHealthRow[];
  health: RegionChannelHealthRow;
};

export type SkuRegionChannelResult = {
  plans: RegionChannelPlan[];
  units: RegionChannelUnit[];
  /** 有需求（叶子/销量）但没有任何仓库映射到的区域：一期不出建议，仅记录 */
  demandRegionsWithoutWarehouse: string[];
};

type HealthPolicyMap = Parameters<typeof computeRegionChannelHealth>[0]['policyMap'];

/** 单 SKU：履约区域 × 渠道单元（健康行 + 渠道分摊后的有效供给与需求口径）。 */
export function buildSkuRegionChannelUnits(params: {
  sku: Parameters<typeof computeRegionChannelHealth>[0]['sku'];
  /** 该 SKU 在各物理仓的健康行 */
  warehouseHealth: SkuHealthRow[];
  tables: RegionMappingTables;
  /** 最新发布版叶子（已排除 sales_region='ALL'） */
  leaves: ReadonlyMap<string, PublishedLeafEntry>;
  salesRows: ReadonlyArray<RegionPlatformSalesRow>;
  platformOf: (channel: string | null | undefined) => string;
  policyMap: HealthPolicyMap;
  forecastErrorStdDev?: number | null;
  moq?: number;
  ruleDefaults?: { safetyStockDays: number; overstockThresholdDays: number };
  now?: Date;
}): SkuRegionChannelResult {
  const now = params.now ?? new Date();
  const regionGroups = groupWarehousesByFulfillmentRegion(
    params.warehouseHealth.map((h) => ({ code: h.warehouseCode, health: h })),
    params.tables,
  );
  const salesBuckets = bucketSalesByRegionPlatform(params.salesRows, params.tables, params.platformOf);
  const demandWindowDays = replenishmentSalesLookbackDays();

  // region → platform → ...
  const leavesByRegion = new Map<string, Map<string, RegionPlatformLeaf>>();
  for (const leaf of params.leaves.values()) {
    const m = leavesByRegion.get(leaf.salesRegion) ?? new Map<string, RegionPlatformLeaf>();
    m.set(leaf.platform, leaf);
    leavesByRegion.set(leaf.salesRegion, m);
  }
  const salesPlatformsByRegion = new Map<string, Set<string>>();
  for (const key of salesBuckets.keys()) {
    const [region, platform] = key.split('::') as [string, string];
    const set = salesPlatformsByRegion.get(region) ?? new Set<string>();
    set.add(platform);
    salesPlatformsByRegion.set(region, set);
  }

  const plans: RegionChannelPlan[] = [];
  const whHealthByRegion = new Map<string, SkuHealthRow[]>();
  for (const [region, group] of regionGroups) {
    const regionHealth = group.map((g) => g.health);
    whHealthByRegion.set(region, regionHealth);
    const regionQty = regionHealth.reduce((sum, h) => sum + Math.max(0, h.effectiveQty), 0);
    const historyQtyByPlatform: Record<string, number> = {};
    const historyDailyByPlatform: Record<string, number> = {};
    for (const platform of salesPlatformsByRegion.get(region) ?? []) {
      const rows = salesBuckets.get(regionPlatformKey(region, platform)) ?? [];
      historyQtyByPlatform[platform] = sumHistoryQty(rows, now, CHANNEL_SHARE_HISTORY_DAYS);
      historyDailyByPlatform[platform] = resolveHistoricalDemand({
        sales: rows.map((r) => ({ qtySold: r.qtySold, saleDate: String(r.saleDate) })),
        inventoryRows: [],
        windowDays: demandWindowDays,
        asOf: now,
      }).avgDaily;
    }
    plans.push(
      buildRegionChannelPlan({
        fulfillmentRegion: region,
        regionQty,
        leaves: leavesByRegion.get(region) ?? new Map(),
        historyQtyByPlatform,
        historyDailyByPlatform,
        asOf: now,
      }),
    );
  }

  const demandRegionsWithoutWarehouse = [
    ...new Set([...leavesByRegion.keys(), ...salesPlatformsByRegion.keys()]),
  ]
    .filter((region) => !regionGroups.has(region as never))
    .sort();

  const totalDemand = plans.reduce((sum, plan) => sum + regionDemandDaily(plan), 0);
  const units: RegionChannelUnit[] = [];
  for (const plan of plans) {
    if (plan.channelShareSource === 'empty') continue;
    const regionHealth = whHealthByRegion.get(plan.fulfillmentRegion) ?? [];
    if (!regionHealth.length) continue;
    const regionDemandShare = totalDemand > 0 ? regionDemandDaily(plan) / totalDemand : null;
    for (const planUnit of plan.units) {
      const salesRows =
        salesBuckets.get(regionPlatformKey(plan.fulfillmentRegion, planUnit.platform)) ?? [];
      const health = computeRegionChannelHealth({
        sku: params.sku,
        fulfillmentRegion: plan.fulfillmentRegion,
        platform: planUnit.platform,
        unit: planUnit,
        channelShareSource: plan.channelShareSource,
        regionQty: plan.regionQty,
        regionWarehouseHealth: regionHealth,
        salesRows,
        policyMap: params.policyMap,
        forecastErrorStdDev: params.forecastErrorStdDev,
        moq: params.moq,
        ruleDefaults: params.ruleDefaults,
        regionDemandShare,
        now,
      });
      health.metrics.historyMergedPlatforms = plan.historyMergedPlatforms;
      units.push({
        fulfillmentRegion: plan.fulfillmentRegion,
        platform: planUnit.platform,
        plan,
        planUnit,
        regionWarehouseHealth: regionHealth,
        health,
      });
    }
  }

  return { plans, units, demandRegionsWithoutWarehouse };
}

/** 区域单元时间轴：区域仓 lots + 按区域需求摊开的未分仓池，再按渠道占比分摊。 */
export function projectRegionChannelUnit(params: {
  skuId: string;
  unit: RegionChannelUnit;
  plans: readonly RegionChannelPlan[];
  snapshots: ReadonlyMap<string, InventorySnapshot>;
  lotsByKey: ReadonlyMap<string, OpenTimelineLot[]>;
  coverDays?: number;
  moq?: number;
  now?: Date;
}) {
  const { unit } = params;
  const regionLots: OpenTimelineLot[] = [];
  const regionSnapshots: InventorySnapshot[] = [];
  for (const wh of unit.regionWarehouseHealth) {
    const key = `${params.skuId}::${wh.warehouseCode}`;
    regionLots.push(...(params.lotsByKey.get(key) ?? []));
    const snap = params.snapshots.get(key);
    if (snap) regionSnapshots.push(snap);
  }
  const regionWeights = regionDemandWeights(params.plans);
  const sharedLots: OpenTimelineLot[] = [];
  for (const code of [IN_PRODUCTION_WAREHOUSE, UNALLOCATED_TRANSIT_WAREHOUSE]) {
    sharedLots.push(...(params.lotsByKey.get(`${params.skuId}::${code}`) ?? []));
  }
  const apportioned = apportionSharedLots(sharedLots, regionWeights, unit.fulfillmentRegion);

  const leaf = unit.planUnit.leaf as (RegionPlatformLeaf & PublishedLeafEntry) | null;
  const historyDaily = unit.planUnit.historyDailyAvg;
  const fallbackDaily =
    unit.planUnit.forwardDailyAvg > 0 ? unit.planUnit.forwardDailyAvg : historyDaily;
  return assembleRegionChannelTimeline({
    today: params.now,
    fulfillmentRegion: unit.fulfillmentRegion,
    platform: unit.platform,
    channelWeights: unit.plan.weights,
    regionSnapshots,
    regionLots: [...regionLots, ...apportioned],
    avgDaily: unit.health.avgDaily,
    demandMap: leaf?.map ?? new Map(),
    fallbackDaily,
    totalLeadDays: unit.health.totalLeadDays,
    safetyStockDays: unit.health.coverage.safetyStockDays,
    safetyStockQty: (unit.health.metrics.safetyStockQty as number) ?? 0,
    moq: params.moq,
    farHorizon: leaf
      ? {
          profileClass: leaf.profileClass ?? profileClassFromSegment(leaf.profileSegment),
          p90: leaf.p90Map,
        }
      : null,
    coverDays: params.coverDays,
  });
}

/** 未分仓池（在产/海外）按区域需求权重摊给某区域。 */
export function apportionSharedLots(
  lots: readonly OpenTimelineLot[],
  regionWeights: Record<string, number>,
  region: string,
): OpenTimelineLot[] {
  if (!lots.length || !(region in regionWeights)) return [];
  return scaleLotsByWeights(lots, regionWeights, region);
}
