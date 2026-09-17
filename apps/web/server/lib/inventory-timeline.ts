/**
 * 库存时间轴：按 available_at 投影未来海外可售，计算缺口与断货日。
 * 调用方应只传入 isLotEligibleForTimeline === true 的批次。
 */

import { addDaysIso, subtractDaysIso } from './inventory-supply-lots.js';

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

export type DailyLot = {
  supplyClass: 'confirmed' | 'expected' | 'planned';
  pool: string;
  qty: number;
  availableAt: string;
};

export type DailyTimelinePoint = {
  horizonDays: number;
  asOf: string;
  confirmedEnding: number;
  expectedEnding: number;
  plannedInbound: number;
  cumulativeDemand: number;
  supplyEvents: Array<{ pool: string; qty: number; availableAt: string; supplyClass: string }>;
};

export type DailyInventoryResult = {
  today: string;
  windowDays: number;
  totalLeadDays: number;
  stockoutDateConfirmed: string | null;
  stockoutDateExpected: string | null;
  safetyBreachDateConfirmed: string | null;
  reorderDate: string | null;
  tooLateForNewPo: boolean;
  uncoverableByNewPo: boolean;
  suggestedQty: number;
  points: DailyTimelinePoint[];
};

export function calcTimelineWindowDays(totalLeadDays: number, safetyStockDays: number): number {
  const raw = Math.ceil(totalLeadDays) + Math.ceil(safetyStockDays);
  return Math.min(180, Math.max(90, raw));
}

export function displayHorizonDays(totalLeadDays: number, windowDays: number): number[] {
  const leadHorizon = Math.min(totalLeadDays, windowDays);
  return [...new Set([0, 7, 15, 30, leadHorizon].filter((d) => d <= windowDays))].sort(
    (a, b) => a - b,
  );
}

export function projectDailyInventory(params: {
  lots: DailyLot[];
  today: string;
  reservedQty?: number;
  totalLeadDays: number;
  safetyStockDays: number;
  safetyStockQty: number;
  moq?: number;
  dailyDemandFn: (horizonDays: number) => number;
}): DailyInventoryResult {
  const windowDays = calcTimelineWindowDays(params.totalLeadDays, params.safetyStockDays);
  const reserved = Math.max(0, params.reservedQty ?? 0);
  const horizons = displayHorizonDays(params.totalLeadDays, windowDays);
  const horizonSet = new Set(horizons);
  const kT = Math.min(params.totalLeadDays, windowDays);

  const points: DailyTimelinePoint[] = [];
  let demandCum = 0;
  let allDemandZero = true;
  let demandCumAtTarget = 0;
  let supplyExpectedAtTarget = 0;
  let stockoutDateConfirmed: string | null = null;
  let stockoutDateExpected: string | null = null;
  let safetyBreachDateConfirmed: string | null = null;
  let confirmedStockoutK: number | null = null;

  for (let k = 0; k <= windowDays; k++) {
    const asOf = horizonDate(params.today, k);
    const dayDemand = params.dailyDemandFn(k);
    if (dayDemand !== 0) allDemandZero = false;
    demandCum += dayDemand;

    let confirmedQty = 0;
    let expectedQty = 0;
    let plannedQty = 0;
    const supplyEvents: DailyTimelinePoint['supplyEvents'] = [];
    for (const lot of params.lots) {
      if (lot.availableAt <= asOf) {
        supplyEvents.push({
          pool: lot.pool,
          qty: lot.qty,
          availableAt: lot.availableAt,
          supplyClass: lot.supplyClass,
        });
        if (lot.supplyClass === 'confirmed') confirmedQty += lot.qty;
        else if (lot.supplyClass === 'expected') expectedQty += lot.qty;
        else if (lot.supplyClass === 'planned') plannedQty += lot.qty;
      }
    }

    const supplyConfirmed = Math.max(0, confirmedQty - reserved);
    const supplyExpected = supplyConfirmed + expectedQty;
    const confirmedEnding = supplyConfirmed - demandCum;
    const expectedEnding = supplyExpected - demandCum;

    if (k === kT) {
      demandCumAtTarget = demandCum;
      supplyExpectedAtTarget = supplyExpected;
    }

    if (stockoutDateConfirmed == null && confirmedEnding <= 0) {
      stockoutDateConfirmed = asOf;
      confirmedStockoutK = k;
    }
    if (stockoutDateExpected == null && expectedEnding <= 0) {
      stockoutDateExpected = asOf;
    }
    if (safetyBreachDateConfirmed == null && confirmedEnding < params.safetyStockQty) {
      safetyBreachDateConfirmed = asOf;
    }

    if (horizonSet.has(k)) {
      points.push({
        horizonDays: k,
        asOf,
        confirmedEnding,
        expectedEnding,
        plannedInbound: plannedQty,
        cumulativeDemand: demandCum,
        supplyEvents,
      });
    }
  }

  let suggestedQty = 0;
  let reorderDate: string | null = null;
  let tooLateForNewPo = false;
  let uncoverableByNewPo = false;

  if (allDemandZero) {
    stockoutDateConfirmed = null;
    stockoutDateExpected = null;
    safetyBreachDateConfirmed = null;
  } else {
    suggestedQty = calcSuggestedQtyFromTimeline({
      projectedOverseasAtTarget: supplyExpectedAtTarget,
      cumulativeDemandAtTarget: demandCumAtTarget,
      safetyStockQty: params.safetyStockQty,
      moq: params.moq,
    });
    if (stockoutDateExpected) {
      const unclamped = subtractDaysIso(stockoutDateExpected, params.totalLeadDays);
      if (unclamped < params.today) {
        reorderDate = params.today;
        tooLateForNewPo = true;
      } else {
        reorderDate = unclamped;
      }
    }
    if (confirmedStockoutK != null && confirmedStockoutK < params.totalLeadDays) {
      uncoverableByNewPo = true;
    }
  }

  return {
    today: params.today,
    windowDays,
    totalLeadDays: params.totalLeadDays,
    stockoutDateConfirmed,
    stockoutDateExpected,
    safetyBreachDateConfirmed,
    reorderDate,
    tooLateForNewPo,
    uncoverableByNewPo,
    suggestedQty,
    points,
  };
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
