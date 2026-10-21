import {
  pickWorstInventoryHealth,
  type InventoryHealth,
} from './inventory-light.js';

/** 补货建议网络口径：出货前不定目的仓，一条 SKU 一条采购建议 */
export const NETWORK_SUGGESTION_LABEL = '网络';

export type NetworkAvgDailyRow = {
  warehouseCode: string;
  avgDaily: number;
  demandShareFallback?: boolean;
};

/**
 * 网络日均。有全站预测前向日均时直接用它，不再把各仓相加。
 * 没有预测时，跳过无销售占比、已回退成全站需求的仓，避免同一份需求被加两次。
 */
export function sumNetworkAvgDaily(input: {
  rows: NetworkAvgDailyRow[];
  forecastForwardAvg?: number | null;
}): { avgDaily: number; excludedWarehouses: string[] } {
  const excludedWarehouses = input.rows
    .filter((row) => row.demandShareFallback)
    .map((row) => row.warehouseCode);
  const forecast = input.forecastForwardAvg;
  if (forecast != null && Number.isFinite(forecast) && forecast > 0) {
    return { avgDaily: forecast, excludedWarehouses };
  }
  const avgDaily = input.rows.reduce(
    (sum, row) => (row.demandShareFallback ? sum : sum + row.avgDaily),
    0,
  );
  return { avgDaily, excludedWarehouses };
}

/**
 * 网络安全库存件数 = 网络日均 × 各仓安全天数的最大值。
 * 各仓件数相加会把同一份需求的缓冲算多次。
 */
export function poolNetworkSafetyStockQty(input: {
  networkAvgDaily: number;
  safetyStockDays: number;
}): number {
  const daily = Number.isFinite(input.networkAvgDaily) ? Math.max(0, input.networkAvgDaily) : 0;
  const days = Number.isFinite(input.safetyStockDays) ? Math.max(0, input.safetyStockDays) : 0;
  return Math.ceil(daily * days);
}

export type ReplenishmentCandidate = {
  skuId: string;
  skuCode: string;
  spuId: string | null;
  replenishLight: string;
  warehouseCode: string | null;
  suggestedQty: number;
  suggestedDate: string;
  reason: string;
  healthStatus: InventoryHealth;
  coverageDays: number;
  totalLeadDays: number;
  latestOrderDays: number;
  metrics: Record<string, unknown>;
};

export type NetworkTimelineOverride = {
  suggestedQty: number;
  suggestedDate: string;
  totalLeadDays: number;
  stockoutDate?: string | null;
  metrics?: Record<string, unknown>;
};

/**
 * 同一 SKU 多仓同时出建议时，优先采用网络时间轴建议量；否则取 max(各仓) 避免重复下单。
 * 保留触发仓明细于 metrics.triggerWarehouses。
 */
export function collapseSkuReplenishmentCandidates(
  items: ReplenishmentCandidate[],
  networkTimeline?: NetworkTimelineOverride | null,
): ReplenishmentCandidate | null {
  if (!items.length) return null;

  const perWarehouseMax = Math.max(...items.map((item) => item.suggestedQty));
  const networkQty = networkTimeline?.suggestedQty;
  const networkQtyFallback = networkTimeline != null && (networkQty ?? 0) <= 0 && perWarehouseMax > 0;
  const suggestedQty = networkQtyFallback
    ? perWarehouseMax
    : (networkQty ?? perWarehouseMax);
  if (suggestedQty <= 0) return null;

  const anchor =
    items.find((item) => item.suggestedQty === suggestedQty) ??
    items.reduce((best, cur) => (cur.suggestedQty > best.suggestedQty ? cur : best));

  const suggestedDate =
    networkTimeline?.suggestedDate ??
    items.reduce(
      (earliest, item) => (item.suggestedDate < earliest ? item.suggestedDate : earliest),
      items[0]!.suggestedDate,
    );

  const triggerWarehouses = [...new Set(items.map((item) => item.warehouseCode))].sort();
  const perWarehouseQty = Object.fromEntries(
    items.map((item) => [item.warehouseCode, item.suggestedQty]),
  );

  const triggerNote = networkQtyFallback
    ? `；网络时间轴建议量为 0，回退各仓较大值（触发仓 ${triggerWarehouses.join('、')}，各仓建议 ${JSON.stringify(perWarehouseQty)}）`
    : networkTimeline
    ? `；网络时间轴（触发仓 ${triggerWarehouses.join('、')}，各仓建议 ${JSON.stringify(perWarehouseQty)}）`
    : triggerWarehouses.length > 1
      ? `；网络汇总（触发仓 ${triggerWarehouses.join('、')}，各仓建议 ${JSON.stringify(perWarehouseQty)}）`
      : triggerWarehouses[0]
        ? `；网络口径（参考仓 ${triggerWarehouses[0]}）`
        : '';

  return {
    ...anchor,
    warehouseCode: null,
    suggestedQty,
    suggestedDate,
    totalLeadDays: networkTimeline?.totalLeadDays ?? anchor.totalLeadDays,
    healthStatus: pickWorstInventoryHealth(items.map((item) => item.healthStatus))!,
    reason: `${anchor.reason}${triggerNote}`,
    metrics: {
      ...anchor.metrics,
      networkCollapsed: true,
      networkTimeline: Boolean(networkTimeline) && !networkQtyFallback,
      networkQtyFallback,
      triggerWarehouses,
      perWarehouseQty,
      ...(networkTimeline?.metrics ?? {}),
      ...(networkTimeline?.stockoutDate
        ? { timelineStockoutDate: networkTimeline.stockoutDate }
        : {}),
    },
  };
}
