import { addDaysIso } from './inventory-iso-date.js';
import { SHIP_SLACK_URGENT_DAYS, type AlertAction, type PriceReason } from './alert-action.js';

/** 预计断货（含本地）短于 150 天时，按全网日均拆需求窗口。发货缺口只扣海外在库和窗口内能上架的确定在途，不受「含本地≥150天」影响。 */

export const HORIZON_DETAIL_MAX_DAYS = 150;

/** 看板建议件数要盖住的天数：总提前期 + 安全库存。缺省交期 90、安全库存 14。 */
export function orderCoverDays(
  totalLeadDays: number | null | undefined,
  safetyStockDays = 14,
): number {
  const lead =
    totalLeadDays != null && Number.isFinite(totalLeadDays) && totalLeadDays > 0
      ? Math.ceil(totalLeadDays)
      : 90;
  const safety =
    Number.isFinite(safetyStockDays) && safetyStockDays > 0 ? Math.ceil(safetyStockDays) : 14;
  return lead + safety;
}

export type HorizonDemand = {
  demand150: number;
  demand120: number;
  demand90: number;
  ship60: number;
  urgent45: number;
  /** 下单缺口：窗口需求减去在库、在途、本地。已采购的供给都扣掉。 */
  gap90: number;
  gap120: number;
  gap150: number;
  /** 全网可售已盖过 150 天时，列表下单缺口记 0。 */
  windowCovered: boolean;
  /** 海外在库 + 全量在途已盖住 45/60 天发货窗时为 true。 */
  shipWindowCovered: boolean;
  /** 不含本地的下单缺口（windowCovered 时仍计算，供「货还不能发」补单）。 */
  gap90Overseas: number;
  gap150Overseas: number;
  /** 补到总提前期 + 安全库存的需求与缺口。未传 coverDays 时与 150 天窗口相同。 */
  demandCover: number;
  gapCover: number;
  gapCoverOverseas: number;
};

export type InTransitWindowQty = {
  within45: number;
  within60: number;
  undated: number;
};

/** 有上架日、且不是估算或未知日期的在途，才计入 45/60 天窗口。其余记为未定日期。晚于 60 天的确定在途两边都不计。 */
export function classifyInTransitArrival(input: {
  today: string;
  availableAt: string | null | undefined;
  etaEstimated?: boolean | null;
  dateUnknown?: boolean | null;
  qty: number;
}): InTransitWindowQty {
  const qty = Math.max(0, Math.round(input.qty) || 0);
  const empty = { within45: 0, within60: 0, undated: 0 };
  if (qty <= 0) return empty;
  const availableAt = input.availableAt?.slice(0, 10) ?? '';
  const dated =
    /^\d{4}-\d{2}-\d{2}$/.test(availableAt) && !input.etaEstimated && !input.dateUnknown;
  if (!dated) return { within45: 0, within60: 0, undated: qty };
  const within60 = availableAt <= addDaysIso(input.today, 60);
  const within45 = availableAt <= addDaysIso(input.today, 45);
  if (!within60) return empty;
  return {
    within45: within45 ? qty : 0,
    within60: qty,
    undated: 0,
  };
}

export function addInTransitWindow(left: InTransitWindowQty, right: InTransitWindowQty): InTransitWindowQty {
  return {
    within45: left.within45 + right.within45,
    within60: left.within60 + right.within60,
    undated: left.undated + right.undated,
  };
}

/** 日均为空或 0 时不当分母；有库存则封顶，避免 Infinity 被滤成未入档。 */
export const MAX_COVERAGE_DAYS = 9999;

export function capCoverageDays(days: number | null | undefined): number | null {
  if (days == null) return null;
  if (!Number.isFinite(days)) return days > 0 ? MAX_COVERAGE_DAYS : 0;
  if (days <= 0) return 0;
  return Math.min(days, MAX_COVERAGE_DAYS);
}

export function coverageDaysFromQty(qty: number, avgDaily: number | null | undefined): number | null {
  if (avgDaily == null || !Number.isFinite(avgDaily) || avgDaily <= 0) {
    return qty > 0 ? MAX_COVERAGE_DAYS : 0;
  }
  return capCoverageDays(qty / avgDaily);
}

export function horizonDemand(input: {
  coverageDays: number | null;
  avgDaily: number | null;
  overseasQty: number;
  /** 已采购、尚未出海的本地件数。下单缺口会扣掉。 */
  localQty?: number;
  /** 全部在途件数。下单缺口会扣掉，不看有没有上架日。 */
  inTransitQty?: number;
  /** 45 天内能上架的确定在途。无日期、估算日期不传入。 */
  inTransitWithin45?: number;
  /** 60 天内能上架的确定在途。 */
  inTransitWithin60?: number;
  /** 建议件数要覆盖的天数。缺省 150，与旧窗口一致。 */
  coverDays?: number;
  /** 已按月/周日均逐日累加的窗口需求；有值时不再用单一日均乘天数。 */
  demandQty?: {
    d150: number;
    d120: number;
    d90: number;
    d60: number;
    d45: number;
    dCover?: number;
  };
}): HorizonDemand | null {
  const days = input.coverageDays;
  const covered =
    days === Number.POSITIVE_INFINITY ||
    (days != null && Number.isFinite(days) && days >= HORIZON_DETAIL_MAX_DAYS);
  const overseas = Math.max(0, input.overseasQty);
  const pipeline =
    overseas + Math.max(0, input.localQty ?? 0) + Math.max(0, input.inTransitQty ?? 0);
  const within45 = Math.max(0, input.inTransitWithin45 ?? 0);
  const within60 = Math.max(0, input.inTransitWithin60 ?? 0);
  const windows = demandWindows(input.avgDaily, input.demandQty);
  if (!windows && !covered) return null;
  const demand = windows ?? { d150: 0, d120: 0, d90: 0, d60: 0, d45: 0 };
  const coverDays =
    input.coverDays != null && input.coverDays > 0
      ? Math.ceil(input.coverDays)
      : HORIZON_DETAIL_MAX_DAYS;
  const demandCover =
    input.demandQty?.dCover != null
      ? input.demandQty.dCover
      : coverDays === HORIZON_DETAIL_MAX_DAYS
        ? demand.d150
        : Math.round((input.avgDaily ?? 0) * coverDays);
  const inTransitAll = Math.max(0, input.inTransitQty ?? 0);
  const overseasPipeline = overseas + inTransitAll;
  const overseasGap = (need: number) => Math.max(0, need - overseasPipeline);
  const orderGap = (need: number) => (covered ? 0 : Math.max(0, need - pipeline));
  const coverReached =
    days === Number.POSITIVE_INFINITY ||
    (days != null && Number.isFinite(days) && days >= coverDays);
  const ship60 = Math.max(0, demand.d60 - overseas - within60);
  const urgent45 = Math.max(0, demand.d45 - overseas - within45);
  return {
    demand150: demand.d150,
    demand120: demand.d120,
    demand90: demand.d90,
    ship60,
    urgent45,
    gap90: orderGap(demand.d90),
    gap120: orderGap(demand.d120),
    gap150: orderGap(demand.d150),
    windowCovered: covered,
    shipWindowCovered: ship60 <= 0 && urgent45 <= 0,
    gap90Overseas: overseasGap(demand.d90),
    gap150Overseas: overseasGap(demand.d150),
    demandCover,
    gapCover: coverReached ? 0 : Math.max(0, Math.round(demandCover) - pipeline),
    gapCoverOverseas: overseasGap(demandCover),
  };
}

function demandWindows(
  avgDaily: number | null,
  demandQty: { d150: number; d120: number; d90: number; d60: number; d45: number } | undefined,
): { d150: number; d120: number; d90: number; d60: number; d45: number } | null {
  if (demandQty) return demandQty;
  const daily = avgDaily ?? 0;
  if (daily <= 0) return null;
  const demand = (horizon: number) => Math.round(daily * horizon);
  return {
    d150: demand(150),
    d120: demand(120),
    d90: demand(90),
    d60: demand(60),
    d45: demand(45),
  };
}

export type OrderRecommendation = {
  orderByDate: string | null;
  orderQty: number;
  orderNow: boolean;
  /** 含本地已覆盖 150 天时，按海外侧缺口给出的参考下单量（即将断货）。 */
  orderOverseasReference?: boolean;
};

/** 数量补到总提前期 + 安全库存。90 天已经不够，或可售短于交期加安全库存，则今天就下。 */
export function recommendOrder(input: {
  today: string;
  coverageDays: number | null;
  totalLeadDays: number | null;
  safetyStockDays?: number;
  gap90: number;
  gap150: number;
  /** 补到总提前期 + 安全库存的缺口。缺省时仍用 150 天缺口。 */
  gapCover?: number;
  windowCovered: boolean;
}): OrderRecommendation {
  const orderGapQty = Math.max(0, Math.round(input.gapCover ?? input.gap150) || 0);
  const gap90 = Math.max(0, Math.round(input.gap90) || 0);
  const lead = input.totalLeadDays != null && input.totalLeadDays > 0 ? input.totalLeadDays : 90;
  const safety = input.safetyStockDays ?? 14;
  const targetDays = orderCoverDays(input.totalLeadDays, safety);
  const coverage = input.coverageDays;
  const targetCovered =
    input.gapCover == null
      ? input.windowCovered
      : coverage === Number.POSITIVE_INFINITY ||
        (coverage != null && Number.isFinite(coverage) && coverage >= targetDays);
  if (targetCovered || orderGapQty <= 0) {
    return { orderByDate: null, orderQty: 0, orderNow: false };
  }
  const slack =
    coverage != null && Number.isFinite(coverage) ? Math.floor(coverage - lead - safety) : 0;
  const orderNow = gap90 > 0 || slack <= 0;
  return {
    orderNow,
    orderQty: orderGapQty,
    orderByDate: orderNow ? input.today : addDaysIso(input.today, slack),
  };
}

/** 即将断货时，在全网已覆盖 150 天仍可按海外侧缺口给出补单参考（船期来不及 / 货还不能发）。 */
export function recommendOrderForNetworkAlert(input: {
  today: string;
  coverageDays: number | null;
  totalLeadDays: number | null;
  safetyStockDays?: number;
  horizons: HorizonDemand | null;
  networkAction: AlertAction | null;
  priceReason: PriceReason | null;
}): OrderRecommendation {
  const h = input.horizons;
  const base = recommendOrder({
    today: input.today,
    coverageDays: input.coverageDays,
    totalLeadDays: input.totalLeadDays,
    safetyStockDays: input.safetyStockDays,
    gap90: h?.gap90 ?? 0,
    gap150: h?.gap150 ?? 0,
    gapCover: h?.gapCover,
    windowCovered: h?.windowCovered ?? false,
  });
  if (base.orderQty > 0) return base;
  const useOverseasGap =
    input.networkAction === 'price' &&
    (input.priceReason === 'not_ready' || input.priceReason === 'ship_late');
  if (!useOverseasGap) return base;
  const gap150 = h?.gap150Overseas ?? 0;
  const gapCover = h?.gapCoverOverseas ?? gap150;
  if (gapCover <= 0 && gap150 <= 0) return base;
  const overseas = recommendOrder({
    today: input.today,
    // 全网可售含本地，不能用来判断海外侧是否已经盖住交期。
    coverageDays: null,
    totalLeadDays: input.totalLeadDays,
    safetyStockDays: input.safetyStockDays,
    gap90: h?.gap90Overseas ?? 0,
    gap150,
    gapCover,
    windowCovered: false,
  });
  return { ...overseas, orderOverseasReference: true };
}

export type ShipRecommendation = {
  shipByDate: string | null;
  shipQty: number;
  shipNow: boolean;
};

/** 发货数量优先按分档取 45d 紧急 / 60d 窗口；最晚开船日由确定断货日与海运交期推算。 */
export function recommendShip(input: {
  today: string;
  shipWindowCovered: boolean;
  urgent45: number;
  ship60: number;
  action: AlertAction | null;
  daysToStockout: number | null;
  shippingLeadDays: number;
}): ShipRecommendation {
  if (input.shipWindowCovered) {
    return { shipByDate: null, shipQty: 0, shipNow: false };
  }
  const u45 = Math.max(0, Math.round(input.urgent45) || 0);
  const s60 = Math.max(0, Math.round(input.ship60) || 0);
  let shipQty = 0;
  if (input.action === 'ship_urgent') shipQty = u45 || s60;
  else if (input.action === 'ship') shipQty = s60 || u45;
  else shipQty = Math.max(u45, s60);
  if (shipQty <= 0) {
    return { shipByDate: null, shipQty: 0, shipNow: false };
  }
  const lead = input.shippingLeadDays > 0 ? input.shippingLeadDays : 45;
  const slack =
    input.daysToStockout != null && Number.isFinite(input.daysToStockout)
      ? input.daysToStockout - lead
      : null;
  const shipNow =
    input.action === 'ship_urgent' ||
    input.action === 'price' ||
    (slack != null && slack <= SHIP_SLACK_URGENT_DAYS);
  const shipByDate =
    shipNow || slack == null || slack <= 0
      ? input.today
      : addDaysIso(input.today, slack);
  return { shipQty, shipNow, shipByDate: shipNow ? input.today : shipByDate };
}
