import { allocateByShare, type ShareParseResult } from './inventory-share-allocation.js';
import { isGrayLifecycle, isSlowMovingStock } from './inventory-light.js';
import { REPLENISHMENT_DEFAULTS } from '../rules/replenishment/params.js';

export type InventorySalesRiskTag =
  | 'stockout_risk'
  | 'slow_moving'
  | 'imbalance'
  | 'unallocated';

export function allocateSalesWindows(params: {
  sales7d: number;
  sales14d: number;
  sales30d: number;
  share: ShareParseResult;
}): Map<string, { sales7d: number; sales14d: number; sales30d: number; shareWeight: number }> {
  if (params.share.method !== 'sales_share' || params.share.weights.length === 0) {
    return new Map();
  }
  const a7 = allocateByShare(params.sales7d, params.share);
  const a14 = allocateByShare(params.sales14d, params.share);
  const a30 = allocateByShare(params.sales30d, params.share);
  const out = new Map<
    string,
    { sales7d: number; sales14d: number; sales30d: number; shareWeight: number }
  >();
  for (const w of params.share.weights) {
    out.set(w.warehouse, {
      sales7d: a7.get(w.warehouse) ?? 0,
      sales14d: a14.get(w.warehouse) ?? 0,
      sales30d: a30.get(w.warehouse) ?? 0,
      shareWeight: w.weight,
    });
  }
  return out;
}

export function calcCoverDays(effectiveQty: number, avgDaily30d: number): number | null {
  if (!(avgDaily30d > 0)) return null;
  return effectiveQty / avgDaily30d;
}

export function calcSellThrough30d(sales30d: number, effectiveQty: number): number | null {
  const denom = sales30d + effectiveQty;
  if (!(denom > 0)) return null;
  return sales30d / denom;
}

export function buildRiskTags(params: {
  shareMethod: 'sales_share' | 'unallocated' | 'native_warehouse';
  effectiveQty: number;
  coverDays: number | null;
  avgDaily30d: number;
  lifecycle?: string | null;
  totalLeadDays: number;
  peerCoverDays: Array<number | null>;
  overstockThresholdDays?: number;
}): { tags: InventorySalesRiskTag[]; primaryRisk: InventorySalesRiskTag | null } {
  const overstock =
    params.overstockThresholdDays ?? REPLENISHMENT_DEFAULTS.overstockThresholdDays;
  const tags: InventorySalesRiskTag[] = [];

  if (
    params.coverDays != null &&
    Number.isFinite(params.coverDays) &&
    params.coverDays <= params.totalLeadDays
  ) {
    tags.push('stockout_risk');
  }

  if (
    isGrayLifecycle(params.lifecycle) ||
    (params.coverDays != null &&
      isSlowMovingStock({
        effectiveQty: params.effectiveQty,
        avgDaily: params.avgDaily30d,
        coverageDays: params.coverDays,
      }))
  ) {
    tags.push('slow_moving');
  }

  const coverDaysForImbalance = [...params.peerCoverDays, params.coverDays];
  const hasLow = coverDaysForImbalance.some(
    (d) => d != null && Number.isFinite(d) && d <= params.totalLeadDays,
  );
  const hasHigh = coverDaysForImbalance.some(
    (d) => d != null && Number.isFinite(d) && d >= overstock,
  );
  if (hasLow && hasHigh) tags.push('imbalance');

  if (params.shareMethod === 'unallocated' && params.effectiveQty > 0) {
    tags.push('unallocated');
  }

  const order: InventorySalesRiskTag[] = [
    'stockout_risk',
    'slow_moving',
    'imbalance',
    'unallocated',
  ];
  const primaryRisk = order.find((t) => tags.includes(t)) ?? null;
  return { tags, primaryRisk };
}
