/**
 * 库存时间轴：按 available_at 投影未来海外可售，计算缺口与断货日。
 * 调用方应只传入 isLotEligibleForTimeline === true 的批次。
 */

import { addDaysIso } from './inventory-supply-lots.js';

export const DEFAULT_TIMELINE_HORIZONS = [0, 7, 15, 30, 45] as const;

export type TimelineLot = {
  pool: 'overseas' | 'in_transit' | 'local';
  qty: number;
  availableAt: string;
};

export type TimelinePoint = {
  horizonDays: number;
  asOf: string;
  projectedOverseas: number;
  cumulativeDemand: number;
  projectedBalance: number;
  supplyEvents: Array<{ pool: string; qty: number; availableAt: string }>;
};

export type InventoryTimelineResult = {
  today: string;
  points: TimelinePoint[];
  stockoutDate: string | null;
};

export type SupplyClass = 'confirmed' | 'expected' | 'planned' | 'excluded';

export type ClassifySupplyLotInput = {
  pool: 'overseas' | 'in_transit' | 'local';
  availableAt: string | null;
  productionStatus?: 'in_production' | 'qc_pending' | 'completed' | null;
  shipReadyAt?: string | null;
  etaEstimated?: boolean;
  dateUnknown?: boolean;
  today: string;
};

export function classifySupplyLot(input: ClassifySupplyLotInput): SupplyClass {
  if (!input.availableAt) {
    return 'excluded';
  }

  if (input.pool === 'overseas') {
    return 'confirmed';
  }

  if (input.pool === 'in_transit') {
    if (input.etaEstimated === true || input.dateUnknown === true) {
      return 'planned';
    }
    return 'confirmed';
  }

  // local
  if (
    input.productionStatus === 'completed' &&
    input.shipReadyAt != null &&
    input.shipReadyAt <= input.today
  ) {
    return 'expected';
  }

  return 'planned';
}

function horizonDate(today: string, horizonDays: number): string {
  return addDaysIso(today, horizonDays);
}

export function calcProjectedOverseas(params: {
  lots: TimelineLot[];
  today: string;
  horizonDays: number;
  reservedQty?: number;
}): {
  projectedOverseas: number;
  supplyEvents: Array<{ pool: string; qty: number; availableAt: string }>;
} {
  const asOf = horizonDate(params.today, params.horizonDays);
  const reserved = Math.max(0, params.reservedQty ?? 0);
  const supplyEvents: Array<{ pool: string; qty: number; availableAt: string }> = [];
  let total = 0;
  for (const lot of params.lots) {
    if (lot.availableAt <= asOf) {
      total += lot.qty;
      supplyEvents.push({
        pool: lot.pool,
        qty: lot.qty,
        availableAt: lot.availableAt,
      });
    }
  }
  // reserved 在今日一次性扣除
  return {
    projectedOverseas: Math.max(0, total - reserved),
    supplyEvents,
  };
}

export function calcProjectedBalance(params: {
  lots: TimelineLot[];
  today: string;
  horizonDays: number;
  reservedQty?: number;
  cumulativeDemand: number;
}): {
  projectedOverseas: number;
  cumulativeDemand: number;
  projectedBalance: number;
  supplyEvents: Array<{ pool: string; qty: number; availableAt: string }>;
} {
  const { projectedOverseas, supplyEvents } = calcProjectedOverseas(params);
  return {
    projectedOverseas,
    cumulativeDemand: params.cumulativeDemand,
    projectedBalance: projectedOverseas - params.cumulativeDemand,
    supplyEvents,
  };
}

export function projectInventoryTimeline(params: {
  lots: TimelineLot[];
  today: string;
  reservedQty?: number;
  horizons?: readonly number[];
  cumulativeDemandFn: (horizonDays: number) => number;
  avgDaily?: number;
  maxStockoutScanDays?: number;
}): InventoryTimelineResult {
  const horizons = params.horizons ?? DEFAULT_TIMELINE_HORIZONS;
  const points: TimelinePoint[] = [];
  for (const horizonDays of horizons) {
    const asOf = horizonDate(params.today, horizonDays);
    const balance = calcProjectedBalance({
      lots: params.lots,
      today: params.today,
      horizonDays,
      reservedQty: params.reservedQty,
      cumulativeDemand: params.cumulativeDemandFn(horizonDays),
    });
    points.push({
      horizonDays,
      asOf,
      ...balance,
    });
  }

  const stockoutDate =
    params.avgDaily != null && params.avgDaily > 0
      ? findStockoutDate({
          lots: params.lots,
          today: params.today,
          reservedQty: params.reservedQty,
          avgDaily: params.avgDaily,
          maxDays: params.maxStockoutScanDays ?? 180,
        })
      : points.find((p) => p.projectedBalance <= 0)?.asOf ?? null;

  return { today: params.today, points, stockoutDate };
}

export function findStockoutDate(params: {
  lots: TimelineLot[];
  today: string;
  reservedQty?: number;
  avgDaily: number;
  maxDays?: number;
}): string | null {
  if (params.avgDaily <= 0) return null;
  const maxDays = params.maxDays ?? 180;
  for (let d = 0; d <= maxDays; d++) {
    const balance = calcProjectedBalance({
      lots: params.lots,
      today: params.today,
      horizonDays: d,
      reservedQty: params.reservedQty,
      cumulativeDemand: params.avgDaily * d,
    });
    if (balance.projectedBalance <= 0) {
      return horizonDate(params.today, d);
    }
  }
  return null;
}

/**
 * 建议补货量 = max(0, ceil(目标期末累计需求 + 安全库存 − 该时点 projectedOverseas))，再抬升 MOQ
 */
export function calcSuggestedQtyFromTimeline(params: {
  projectedOverseasAtTarget: number;
  cumulativeDemandAtTarget: number;
  safetyStockQty: number;
  moq?: number;
}): number {
  const raw = Math.max(
    0,
    Math.ceil(
      params.cumulativeDemandAtTarget +
        params.safetyStockQty -
        params.projectedOverseasAtTarget,
    ),
  );
  if (raw <= 0) return 0;
  const moq = params.moq ?? 0;
  return moq > 0 ? Math.max(raw, moq) : raw;
}
