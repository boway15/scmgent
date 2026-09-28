import type { InventoryHealth } from './inventory-light.js';

/** 补货建议网络口径：出货前不定目的仓，一条 SKU 一条采购建议 */
export const NETWORK_SUGGESTION_LABEL = '网络';

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

const HEALTH_PRIORITY: Record<InventoryHealth, number> = {
  red: 5,
  yellow: 4,
  green: 3,
  blue: 2,
  gray: 1,
};

function pickWorstHealth(items: ReplenishmentCandidate[]): InventoryHealth {
  return items.reduce(
    (worst, item) =>
      HEALTH_PRIORITY[item.healthStatus] > HEALTH_PRIORITY[worst] ? item.healthStatus : worst,
    items[0]!.healthStatus,
  );
}

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

  const suggestedQty =
    networkTimeline?.suggestedQty ?? Math.max(...items.map((item) => item.suggestedQty));
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

  const triggerNote = networkTimeline
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
    healthStatus: pickWorstHealth(items),
    reason: `${anchor.reason}${triggerNote}`,
    metrics: {
      ...anchor.metrics,
      networkCollapsed: true,
      networkTimeline: Boolean(networkTimeline),
      triggerWarehouses,
      perWarehouseQty,
      ...(networkTimeline?.metrics ?? {}),
      ...(networkTimeline?.stockoutDate
        ? { timelineStockoutDate: networkTimeline.stockoutDate }
        : {}),
    },
  };
}
