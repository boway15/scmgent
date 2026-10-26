import { DEFAULT_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';
import { addDaysIso } from './inventory-iso-date.js';

/** 库存概览分档。同一行只取最紧急的一档。发货档按确定供给的开船窗口，不要求本仓已经可发。 */

export const ALERT_DEMAND_FLOOR = 0.1;
export const SHIP_SLACK_URGENT_DAYS = 7;
export const SHIP_SLACK_MAX_DAYS = 15;
export const ORDER_TIGHT_MAX_DAYS = 90;
export const ORDER_MAX_DAYS = 120;
export const HEALTHY_MAX_DAYS = 150;
export const MILD_OVERSTOCK_MAX_DAYS = 180;

export type AlertCoverageBands = {
  orderTightMax: number;
  orderMax: number;
  healthyMax: number;
  mildOverstockMax: number;
};

/** 未传总提前期时保持 90/120/150/180。传入后按下单窗口上移，避免长交期仓在交期内仍显示健康。 */
export function alertCoverageBands(input?: {
  totalLeadDays?: number | null;
  safetyStockDays?: number | null;
}): AlertCoverageBands {
  const total =
    input?.totalLeadDays != null && Number.isFinite(input.totalLeadDays) && input.totalLeadDays > 0
      ? input.totalLeadDays
      : null;
  if (total == null) {
    return {
      orderTightMax: ORDER_TIGHT_MAX_DAYS,
      orderMax: ORDER_MAX_DAYS,
      healthyMax: HEALTHY_MAX_DAYS,
      mildOverstockMax: MILD_OVERSTOCK_MAX_DAYS,
    };
  }
  const safety =
    input?.safetyStockDays != null && input.safetyStockDays > 0
      ? input.safetyStockDays
      : DEFAULT_SAFETY_STOCK_DAYS;
  const orderTightMax = Math.max(ORDER_TIGHT_MAX_DAYS, total);
  const orderMax = Math.max(ORDER_MAX_DAYS, total + safety);
  const healthyMax = Math.max(HEALTHY_MAX_DAYS, orderMax + 30);
  const mildOverstockMax = Math.max(MILD_OVERSTOCK_MAX_DAYS, healthyMax + 30);
  return { orderTightMax, orderMax, healthyMax, mildOverstockMax };
}
export const OVERSTOCK_MAX_DAYS = 300;
export const NEAR_STOCKOUT_GUARD_DAYS = 120;

export type AlertAction =
  | 'price'
  | 'ship_urgent'
  | 'ship'
  | 'order_tight'
  | 'order'
  | 'healthy'
  | 'mild_overstock'
  | 'overstock'
  | 'confirmed_slow'
  | 'none';

export type PriceReason = 'already_out' | 'ship_late' | 'not_ready';

export type AlertLevel = 'l3' | 'l2' | 'l1';

/** 驾驶舱 / 列表 view；`price` 保留为两档合计（兼容旧链接）。 */
export const ALERT_ACTION_VIEWS = [
  'stockout_now',
  'stockout_imminent',
  'price',
  'ship_urgent',
  'ship',
  'order_tight',
  'order',
  'healthy',
  'mild_overstock',
  'overstock',
  'confirmed_slow',
] as const;

export type AlertActionView = (typeof ALERT_ACTION_VIEWS)[number];

export function isAlertActionView(value: string | undefined | null): value is AlertActionView {
  return ALERT_ACTION_VIEWS.includes(value as AlertActionView);
}

/** 调价档拆成驾驶舱两卡：已断货 vs 即将断货（船期来不及 / 货还不能发）。 */
export function inventoryRiskViewFromPrice(priceReason: PriceReason | null): 'stockout_now' | 'stockout_imminent' {
  return priceReason === 'already_out' ? 'stockout_now' : 'stockout_imminent';
}

export function inventoryRiskViewLabel(input: {
  action: AlertAction;
  priceReason: PriceReason | null;
}): AlertActionView | null {
  if (input.action === 'none') return null;
  if (input.action === 'price') return inventoryRiskViewFromPrice(input.priceReason);
  return input.action;
}

export function matchesInventoryRiskView(input: {
  action: AlertAction;
  priceReason: PriceReason | null;
  view: AlertActionView | 'all';
}): boolean {
  if (input.view === 'all') return input.action !== 'none';
  if (input.view === 'price') return input.action === 'price';
  if (input.view === 'stockout_now') {
    return input.action === 'price' && input.priceReason === 'already_out';
  }
  if (input.view === 'stockout_imminent') {
    return input.action === 'price' && input.priceReason !== 'already_out';
  }
  return input.action === input.view;
}

export function daysUntilDate(today: string, stockout: string | null | undefined): number | null {
  if (!stockout) return null;
  const date = stockout.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const start = Date.parse(`${today}T00:00:00Z`);
  const end = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

/** 日均极低、没有销售占比、本仓也没有开放批次：不进任何档。 */
export function isAlertNoise(input: {
  avgDaily: number | null;
  demandShare: number | null;
  hasOpenLots: boolean;
}): boolean {
  const avg = input.avgDaily ?? 0;
  const share = input.demandShare ?? 0;
  return avg <= ALERT_DEMAND_FLOOR && share <= 0 && !input.hasOpenLots;
}

/** 含本地天数 = 确定断货天数 + 本地开放件数 / 日均。 */
export function fullCoverageDays(input: {
  shipDays: number | null;
  confirmedCoverageDays: number | null;
  localQty: number;
  avgDaily: number | null;
}): number | null {
  const base = input.shipDays ?? input.confirmedCoverageDays;
  if (base == null || !Number.isFinite(base)) return base ?? null;
  const avg = input.avgDaily ?? 0;
  if (avg <= 0 || input.localQty <= 0) return base;
  return base + input.localQty / avg;
}

export function resolveAlertAction(input: {
  shipDays: number | null;
  fullDays: number | null;
  shippingLeadDays: number;
  hasShippableLots: boolean;
  noise: boolean;
  totalLeadDays?: number | null;
  safetyStockDays?: number | null;
}): { action: AlertAction; priceReason: PriceReason | null } {
  if (input.noise) return { action: 'none', priceReason: null };

  const ship = finiteDays(input.shipDays);
  const full = finiteDays(input.fullDays) ?? ship;
  const lead = input.shippingLeadDays;

  if (ship != null && ship < lead) {
    if (ship <= 0) return { action: 'price', priceReason: 'already_out' };
    if (input.hasShippableLots) return { action: 'price', priceReason: 'ship_late' };
    return { action: 'price', priceReason: 'not_ready' };
  }

  if (ship != null) {
    const slack = ship - lead;
    if (slack >= 0 && slack <= SHIP_SLACK_MAX_DAYS) {
      return {
        action: slack <= SHIP_SLACK_URGENT_DAYS ? 'ship_urgent' : 'ship',
        priceReason: null,
      };
    }
  }

  if (full == null) return { action: 'none', priceReason: null };

  const bands = alertCoverageBands({
    totalLeadDays: input.totalLeadDays,
    safetyStockDays: input.safetyStockDays,
  });
  const nearStockout = ship != null && ship <= NEAR_STOCKOUT_GUARD_DAYS;
  if (full > OVERSTOCK_MAX_DAYS && !nearStockout) {
    return { action: 'confirmed_slow', priceReason: null };
  }
  if (full > bands.mildOverstockMax && !nearStockout) {
    return { action: 'overstock', priceReason: null };
  }
  if (nearStockout && full > bands.mildOverstockMax) {
    return orderBand(ship ?? full, bands.orderTightMax);
  }
  if (full <= bands.orderTightMax) return { action: 'order_tight', priceReason: null };
  if (full <= bands.orderMax) return { action: 'order', priceReason: null };
  if (full <= bands.healthyMax) return { action: 'healthy', priceReason: null };
  if (full <= bands.mildOverstockMax) return { action: 'mild_overstock', priceReason: null };
  return { action: 'healthy', priceReason: null };
}

function orderBand(
  days: number,
  orderTightMax: number,
): { action: AlertAction; priceReason: null } {
  if (days <= orderTightMax) return { action: 'order_tight', priceReason: null };
  return { action: 'order', priceReason: null };
}

function finiteDays(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

export function resolveAlertLevel(input: {
  action: AlertAction;
  shipDays: number | null;
  profileClass: string | null;
  fullDays?: number | null;
  totalLeadDays?: number | null;
}): AlertLevel | null {
  if (input.action === 'none' || input.action === 'healthy') return null;
  const klass = input.profileClass?.trim().toUpperCase() ?? '';
  if (input.action === 'price' && klass === 'A') return 'l3';
  if (
    (input.action === 'overstock' || input.action === 'confirmed_slow') &&
    (klass === 'A' || klass === 'B')
  ) {
    return 'l3';
  }
  const ship = finiteDays(input.shipDays);
  if (
    input.action === 'price' ||
    input.action === 'ship_urgent' ||
    (ship != null && ship <= 7)
  ) {
    return 'l2';
  }
  const cover = finiteDays(input.fullDays ?? null) ?? ship;
  if (
    input.action === 'order_tight' &&
    input.totalLeadDays != null &&
    input.totalLeadDays > 0 &&
    cover != null &&
    cover <= input.totalLeadDays
  ) {
    return 'l2';
  }
  return 'l1';
}

/** 调价 / 紧急发货 / 发货用确定断货日；其余分档用含本地的 bandDays 推算缺货日。 */
export function alertUsesShipCoverageBand(action: AlertAction): boolean {
  return action === 'price' || action === 'ship_urgent' || action === 'ship';
}

export function stockoutDateFromBandDays(today: string, bandDays: number | null | undefined): string | null {
  if (bandDays == null || !Number.isFinite(bandDays) || bandDays < 0) return null;
  return addDaysIso(today, Math.floor(bandDays));
}

export function alertOwnerLabel(action: AlertAction, level: AlertLevel | null): string {
  if (level === 'l3') return '运营负责人 + PMC 负责人';
  if (action === 'price') return '运营 / PMC 负责人';
  if (action === 'ship_urgent' || action === 'ship') return '发运';
  if (action === 'order_tight' || action === 'order') return 'PMC 计划员';
  if (action === 'overstock' || action === 'confirmed_slow' || action === 'mild_overstock') return '运营';
  return '';
}
