import {
  daysUntilDate,
  resolveAlertAction,
  resolveAlertLevel,
  type AlertAction,
  type AlertActionView,
  type AlertLevel,
  type PriceReason,
  matchesInventoryRiskView,
} from './alert-action.js';
import {
  loadWarehouseShippingLeadMap,
  shippingLeadAcrossWarehouses,
} from './alert-ship-lead.js';
import { alertSupplyKey, loadAlertListSupply, type AlertListSupply } from './alert-list-supply.js';
import { finiteCoverageDays, resolveNetworkForecastCoverage } from './alert-network-coverage.js';
import { getShanghaiBusinessDate } from './inventory-daily-snapshot.js';

const LEVEL_RANK: Record<string, number> = { l3: 0, l2: 1, l1: 2 };

/** 与 alert-action-index ClassifiedAlert 同形，避免模块循环依赖。 */
export type SkuClassifyWarehouseRow = {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  warehouseCode: string | null;
  action: AlertAction;
  level: AlertLevel | null;
  hasShippableLots: boolean;
};

function pickRepresentativeRow(rows: SkuClassifyWarehouseRow[]): SkuClassifyWarehouseRow {
  return rows.reduce((best, row) => {
    const bestRank = LEVEL_RANK[best.level ?? ''] ?? 3;
    const rowRank = LEVEL_RANK[row.level ?? ''] ?? 3;
    return rowRank < bestRank ? row : best;
  });
}

function skuHasShippableLots(rows: SkuClassifyWarehouseRow[]): boolean {
  return rows.some((row) => row.hasShippableLots);
}

export function networkShippingLeadDays(
  warehouseCodes: Array<string | null | undefined>,
  configured: Map<string, number | null>,
): number {
  return shippingLeadAcrossWarehouses(warehouseCodes, configured);
}

function moreSevereLevel(current: AlertLevel | null, next: AlertLevel | null): AlertLevel | null {
  if (!next) return current;
  if (!current) return next;
  return (LEVEL_RANK[next] ?? 3) < (LEVEL_RANK[current] ?? 3) ? next : current;
}

function resolveNetworkCoverageForSupply(input: { today: string; supply: AlertListSupply }) {
  return resolveNetworkForecastCoverage({
    today: input.today,
    localQty: input.supply.networkLocalQty,
    overseasQty: input.supply.networkOverseasQty,
    inTransitQty: input.supply.networkInTransitQty,
    forecastDaily: input.supply.networkForecastDaily,
    flatDaily: input.supply.networkForecastDaily ? null : input.supply.networkAvgDaily,
    profileClass: input.supply.forecastProfileClass,
    forecastP90Daily: input.supply.forecastP90Daily,
    inTransitWithin45: input.supply.networkInTransitWithin45 ?? 0,
    inTransitWithin60: input.supply.networkInTransitWithin60 ?? 0,
  });
}

/** 与列表「在库+在途」列同一套：海外在库+在途按预测曲线（或周转日均）折算，不用飞书预计断货日。 */
export function networkOnHandTransitShipDays(input: {
  today: string;
  supply: AlertListSupply;
}): { shipDays: number | null; onHandTransitCoverageDays: number | null } {
  const network = resolveNetworkCoverageForSupply(input);
  const fromDate = daysUntilDate(input.today, network.onHandTransitStockoutDate);
  const cov = finiteCoverageDays(network.onHandTransitCoverageDays);
  const shipDays =
    fromDate ??
    (cov != null && Number.isFinite(cov) ? Math.floor(cov) : null);
  return { shipDays, onHandTransitCoverageDays: cov };
}

/** 全网 SKU 分档：可售/断货与列表「含本地、在库+在途」同口径。 */
export function resolveNetworkSkuAlertAction(input: {
  today: string;
  supply: AlertListSupply;
  shippingLeadDays: number;
  hasShippableLots: boolean;
  noise: boolean;
}): { action: AlertAction; priceReason: PriceReason | null } {
  const network = resolveNetworkCoverageForSupply({
    today: input.today,
    supply: input.supply,
  });
  const { shipDays } = networkOnHandTransitShipDays({
    today: input.today,
    supply: input.supply,
  });

  return resolveAlertAction({
    shipDays,
    fullDays: finiteCoverageDays(network.coverageDays),
    shippingLeadDays: input.shippingLeadDays,
    hasShippableLots: input.hasShippableLots,
    noise: input.noise,
    totalLeadDays: input.supply.totalLeadDays,
  });
}

export type SkuNetworkClassified = SkuClassifyWarehouseRow & {
  networkAction: AlertAction;
  networkPriceReason: PriceReason | null;
  shippingLeadDays: number;
};

/** 按 SKU 聚合后做全网分档；用于 SKU 全网列表与概览卡片计数。 */
export async function classifyAlertsBySkuNetwork(
  warehouseRows: SkuClassifyWarehouseRow[],
): Promise<SkuNetworkClassified[]> {
  const bySku = new Map<string, SkuClassifyWarehouseRow[]>();
  for (const row of warehouseRows) {
    const bucket = bySku.get(row.skuId);
    if (bucket) bucket.push(row);
    else bySku.set(row.skuId, [row]);
  }
  if (!bySku.size) return [];

  const supplyRows = [...bySku.entries()].map(([skuId, rows]) => {
    const rep = pickRepresentativeRow(rows);
    return {
      skuId,
      warehouseCode: rep.warehouseCode,
      projectedStockoutDate: null as string | null,
    };
  });
  const [supplyByKey, shippingLead] = await Promise.all([
    loadAlertListSupply(supplyRows),
    loadWarehouseShippingLeadMap(),
  ]);
  const today = getShanghaiBusinessDate();

  const out: SkuNetworkClassified[] = [];
  for (const [skuId, rows] of bySku) {
    const rep = pickRepresentativeRow(rows);
    const supply = supplyByKey.get(alertSupplyKey(skuId, rep.warehouseCode));
    if (!supply) continue;
    const shippingLeadDays = networkShippingLeadDays(
      rows.map((row) => row.warehouseCode),
      shippingLead,
    );
    const resolved = resolveNetworkSkuAlertAction({
      today,
      supply,
      shippingLeadDays,
      hasShippableLots: skuHasShippableLots(rows),
      noise: false,
    });
    if (resolved.action === 'none') continue;
    const { shipDays } = networkOnHandTransitShipDays({ today, supply });
    const level = moreSevereLevel(
      rep.level,
      resolveAlertLevel({
        action: resolved.action,
        shipDays,
        fullDays: finiteCoverageDays(resolveNetworkCoverageForSupply({ today, supply }).coverageDays),
        profileClass: null,
        totalLeadDays: supply.totalLeadDays,
      }),
    );
    out.push({
      ...rep,
      level,
      networkAction: resolved.action,
      networkPriceReason: resolved.priceReason,
      shippingLeadDays,
    });
  }

  return out.sort((a, b) => {
    const levelDelta = (LEVEL_RANK[a.level ?? ''] ?? 3) - (LEVEL_RANK[b.level ?? ''] ?? 3);
    if (levelDelta !== 0) return levelDelta;
    return a.skuCode.localeCompare(b.skuCode);
  });
}

export function filterSkuNetworkByView(
  rows: SkuNetworkClassified[],
  view: AlertActionView | 'all',
): SkuNetworkClassified[] {
  if (view === 'all') return rows;
  return rows.filter((row) =>
    matchesInventoryRiskView({
      action: row.networkAction,
      priceReason: row.networkPriceReason,
      view,
    }),
  );
}

export function countSkuNetworkRisk(rows: SkuNetworkClassified[]): Record<AlertActionView, number> {
  const sets: Record<AlertActionView, Set<string>> = {
    stockout_now: new Set(),
    stockout_imminent: new Set(),
    price: new Set(),
    ship_urgent: new Set(),
    ship: new Set(),
    order_tight: new Set(),
    order: new Set(),
    healthy: new Set(),
    mild_overstock: new Set(),
    overstock: new Set(),
    confirmed_slow: new Set(),
  };
  for (const row of rows) {
    if (row.networkAction === 'none') continue;
    if (row.networkAction === 'price') {
      sets.price.add(row.skuId);
      if (row.networkPriceReason === 'already_out') sets.stockout_now.add(row.skuId);
      else sets.stockout_imminent.add(row.skuId);
      continue;
    }
    sets[row.networkAction].add(row.skuId);
  }
  return {
    stockout_now: sets.stockout_now.size,
    stockout_imminent: sets.stockout_imminent.size,
    price: sets.price.size,
    ship_urgent: sets.ship_urgent.size,
    ship: sets.ship.size,
    order_tight: sets.order_tight.size,
    order: sets.order.size,
    healthy: sets.healthy.size,
    mild_overstock: sets.mild_overstock.size,
    overstock: sets.overstock.size,
    confirmed_slow: sets.confirmed_slow.size,
  };
}
