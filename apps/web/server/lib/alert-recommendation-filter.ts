import type { AlertAction } from './alert-action.js';
import { orderCoverDays, recommendOrderForNetworkAlert, recommendShip } from './alert-horizon-demand.js';
import type { PriceReason } from './alert-action.js';
import { alertSupplyKey, loadAlertListSupply } from './alert-list-supply.js';
import { resolveNetworkForecastCoverage } from './alert-network-coverage.js';
import { loadWarehouseShippingLeadMap, shippingLeadFor } from './alert-ship-lead.js';
import { DEFAULT_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';

export type RecommendYesNoFilter = boolean | undefined;

export function parseRecommendYesNoQuery(raw: string | undefined): RecommendYesNoFilter {
  const value = raw?.trim().toLowerCase();
  if (value === 'yes' || value === 'y' || value === '1' || value === 'true') return true;
  if (value === 'no' || value === 'n' || value === '0' || value === 'false') return false;
  return undefined;
}

export function orderRecommendYes(input: {
  orderWindowCovered?: boolean;
  orderQty?: number | null;
  orderOverseasReference?: boolean;
}): boolean {
  if ((input.orderQty ?? 0) <= 0) return false;
  if (input.orderOverseasReference) return true;
  return !(input.orderWindowCovered ?? false);
}

export function shipRecommendYes(input: {
  shipWindowCovered?: boolean;
  shipQty?: number | null;
}): boolean {
  return !(input.shipWindowCovered ?? false) && (input.shipQty ?? 0) > 0;
}

export type AlertRecommendFilterRow = {
  id: string;
  skuId: string;
  warehouseCode: string | null;
  action: AlertAction;
  daysToStockout: number | null;
  /** SKU 全网分档；有值时建议发货分档与 ship 数量按此计算。 */
  networkAction?: AlertAction;
  networkPriceReason?: PriceReason | null;
  shippingLeadDays?: number;
};

/** 在分页前按建议下单 / 建议发货是否=yes 过滤，口径与列表列一致。 */
export async function filterAlertsByRecommendation<T extends AlertRecommendFilterRow>(
  rows: T[],
  input: {
    today: string;
    suggestOrder?: RecommendYesNoFilter;
    suggestShip?: RecommendYesNoFilter;
  },
): Promise<T[]> {
  if (input.suggestOrder === undefined && input.suggestShip === undefined) return rows;
  if (!rows.length) return rows;

  const [supplyByKey, shippingLead] = await Promise.all([
    loadAlertListSupply(
      rows.map((row) => ({
        skuId: row.skuId,
        warehouseCode: row.warehouseCode,
        projectedStockoutDate: null,
      })),
    ),
    loadWarehouseShippingLeadMap(),
  ]);

  return rows.filter((row) => {
    const supply = supplyByKey.get(alertSupplyKey(row.skuId, row.warehouseCode));
    if (!supply) return false;

    const network = resolveNetworkForecastCoverage({
      today: input.today,
      localQty: supply.networkLocalQty,
      overseasQty: supply.networkOverseasQty,
      inTransitQty: supply.networkInTransitQty,
      forecastDaily: supply.networkForecastDaily,
      flatDaily: supply.networkForecastDaily ? null : supply.networkAvgDaily,
      profileClass: supply.forecastProfileClass,
      forecastP90Daily: supply.forecastP90Daily,
      inTransitWithin45: supply.networkInTransitWithin45 ?? 0,
      inTransitWithin60: supply.networkInTransitWithin60 ?? 0,
      coverDays: orderCoverDays(supply.totalLeadDays, DEFAULT_SAFETY_STOCK_DAYS),
    });

    const orderWindowCovered = network.horizons?.windowCovered ?? false;
    const shipWindowCovered = network.horizons?.shipWindowCovered ?? false;
    const shipAction = row.networkAction ?? row.action;
    const order = recommendOrderForNetworkAlert({
      today: input.today,
      coverageDays: network.coverageDays,
      totalLeadDays: supply.totalLeadDays ?? null,
      safetyStockDays: DEFAULT_SAFETY_STOCK_DAYS,
      horizons: network.horizons,
      networkAction: shipAction === 'none' ? null : shipAction,
      priceReason: row.networkPriceReason ?? null,
    });
    const ship = recommendShip({
      today: input.today,
      shipWindowCovered,
      urgent45: network.horizons?.urgent45 ?? 0,
      ship60: network.horizons?.ship60 ?? 0,
      action: shipAction === 'none' ? null : shipAction,
      daysToStockout: row.daysToStockout,
      shippingLeadDays:
        row.shippingLeadDays ?? shippingLeadFor(row.warehouseCode ?? '', shippingLead),
    });

    const orderYes = orderRecommendYes({
      orderWindowCovered,
      orderQty: order.orderQty,
      orderOverseasReference: order.orderOverseasReference,
    });
    const shipYes = shipRecommendYes({ shipWindowCovered, shipQty: ship.shipQty });

    if (input.suggestOrder !== undefined && orderYes !== input.suggestOrder) return false;
    if (input.suggestShip !== undefined && shipYes !== input.suggestShip) return false;
    return true;
  });
}
