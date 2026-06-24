/** 跨境补货覆盖天数与健康灯计算（阶段一） */

export type {
  InventoryHealth,
} from './inventory-light.js';
export {
  INVENTORY_HEALTH_LABEL,
  INVENTORY_HEALTH_MECHANISM,
  calcInventoryHealth,
  isGrayLifecycle,
  isSlowMovingStock,
  needsReplenishmentByHealth,
  normalizeInventoryHealth,
} from './inventory-light.js';

import {
  calcInventoryHealth,
  needsReplenishmentByHealth,
  INVENTORY_HEALTH_LABEL,
  type InventoryHealth,
} from './inventory-light.js';

export const DEFAULT_PRODUCTION_LEAD_DAYS = 50;
export const DEFAULT_INBOUND_BUFFER_DAYS = 7;
export const DEFAULT_SAFETY_STOCK_DAYS = 14;
export const DEFAULT_OVERSTOCK_THRESHOLD_DAYS = 180;

/** 目的仓默认海运周期（天） */
export const DEFAULT_SHIPPING_LEAD_BY_WAREHOUSE: Record<string, number> = {
  'US-WEST': 45,
  'US-EAST': 60,
  'US-SOUTH': 60,
  'US-SOUTHEAST': 60,
  DE: 80,
  UK: 75,
};

export type LeadTimeBreakdown = {
  productionDays: number;
  shippingDays: number;
  inboundBufferDays: number;
  totalLeadDays: number;
};

export function resolveShippingLeadDays(warehouseCode: string, configured?: number | null): number {
  if (configured != null && configured > 0) return configured;
  return DEFAULT_SHIPPING_LEAD_BY_WAREHOUSE[warehouseCode] ?? 60;
}

export function resolveProductionLeadDays(
  ...candidates: Array<number | null | undefined>
): number {
  for (const value of candidates) {
    if (value != null && value > 0) return value;
  }
  return DEFAULT_PRODUCTION_LEAD_DAYS;
}

export function calcTotalLeadTime(params: {
  productionDays: number;
  shippingDays: number;
  inboundBufferDays?: number;
}): LeadTimeBreakdown {
  const productionDays = Math.max(0, params.productionDays);
  const shippingDays = Math.max(0, params.shippingDays);
  const inboundBufferDays = Math.max(0, params.inboundBufferDays ?? DEFAULT_INBOUND_BUFFER_DAYS);
  return {
    productionDays,
    shippingDays,
    inboundBufferDays,
    totalLeadDays: productionDays + shippingDays + inboundBufferDays,
  };
}

export function calcCoverageDays(effectiveQty: number, avgDaily: number): number {
  if (avgDaily <= 0) return effectiveQty > 0 ? Number.POSITIVE_INFINITY : 0;
  return effectiveQty / avgDaily;
}

export function calcLatestOrderDays(params: {
  coverageDays: number;
  totalLeadDays: number;
  safetyStockDays: number;
}): number {
  return params.coverageDays - params.totalLeadDays - params.safetyStockDays;
}

export function calcSuggestedOrderDate(latestOrderDays: number, today = new Date()): string {
  const base = new Date(today);
  if (!Number.isFinite(latestOrderDays) || latestOrderDays <= 0) {
    return base.toISOString().slice(0, 10);
  }
  base.setDate(base.getDate() + Math.ceil(latestOrderDays));
  return base.toISOString().slice(0, 10);
}

export function calcSuggestedReplenishmentQty(params: {
  effectiveQty: number;
  avgDaily: number;
  targetCoverageDays: number;
  moq?: number;
}): number {
  if (params.avgDaily <= 0) return 0;
  const targetQty = Math.ceil(params.avgDaily * params.targetCoverageDays);
  const raw = Math.max(0, targetQty - params.effectiveQty);
  if (raw <= 0) return 0;
  const moq = params.moq ?? 0;
  if (moq > 0) return Math.max(raw, moq);
  return raw;
}

export type CoverageReplenishmentResult = {
  coverageDays: number;
  leadTime: LeadTimeBreakdown;
  safetyStockDays: number;
  targetCoverageDays: number;
  overstockThresholdDays: number;
  latestOrderDays: number;
  healthStatus: InventoryHealth;
  suggestedQty: number;
  suggestedDate: string;
  needsReplenishment: boolean;
};

export function calcCoverageReplenishment(params: {
  effectiveQty: number;
  avgDaily: number;
  productionDays: number;
  shippingDays: number;
  inboundBufferDays?: number;
  safetyStockDays?: number;
  targetCoverageDays?: number;
  overstockThresholdDays?: number;
  moq?: number;
  lifecycle?: string | null;
  today?: Date;
}): CoverageReplenishmentResult {
  const leadTime = calcTotalLeadTime({
    productionDays: params.productionDays,
    shippingDays: params.shippingDays,
    inboundBufferDays: params.inboundBufferDays,
  });
  const safetyStockDays = params.safetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS;
  const overstockThresholdDays =
    params.overstockThresholdDays ?? DEFAULT_OVERSTOCK_THRESHOLD_DAYS;
  const targetCoverageDays =
    params.targetCoverageDays ?? leadTime.totalLeadDays + safetyStockDays + safetyStockDays;
  const coverageDays = calcCoverageDays(params.effectiveQty, params.avgDaily);
  const latestOrderDays = calcLatestOrderDays({
    coverageDays,
    totalLeadDays: leadTime.totalLeadDays,
    safetyStockDays,
  });
  const healthStatus = calcInventoryHealth({
    coverageDays,
    totalLeadDays: leadTime.totalLeadDays,
    safetyStockDays,
    overstockThresholdDays,
    lifecycle: params.lifecycle,
    effectiveQty: params.effectiveQty,
    avgDaily: params.avgDaily,
  });
  const suggestedQty = needsReplenishmentByHealth(healthStatus)
    ? calcSuggestedReplenishmentQty({
        effectiveQty: params.effectiveQty,
        avgDaily: params.avgDaily,
        targetCoverageDays,
        moq: params.moq,
      })
    : 0;
  const suggestedDate = calcSuggestedOrderDate(latestOrderDays, params.today);
  const needsReplenishment = needsReplenishmentByHealth(healthStatus) && suggestedQty > 0;

  return {
    coverageDays,
    leadTime,
    safetyStockDays,
    targetCoverageDays,
    overstockThresholdDays,
    latestOrderDays,
    healthStatus,
    suggestedQty,
    suggestedDate,
    needsReplenishment,
  };
}

export function formatCoverageReason(params: {
  warehouseCode: string;
  effectiveQty: number;
  avgDaily: number;
  result: CoverageReplenishmentResult;
  poolNote?: string;
  moqNote?: string;
}): string {
  const { result: r } = params;
  const coverageLabel = Number.isFinite(r.coverageDays)
    ? r.coverageDays.toFixed(1)
    : '∞';
  const parts = [
    `[${params.warehouseCode}] 有效 ${params.effectiveQty}，覆盖 ${coverageLabel} 天`,
    `日均 ${params.avgDaily.toFixed(1)}`,
    `生产 ${r.leadTime.productionDays} + 海运 ${r.leadTime.shippingDays} + 入仓 ${r.leadTime.inboundBufferDays} = ${r.leadTime.totalLeadDays} 天`,
    `${INVENTORY_HEALTH_LABEL[r.healthStatus]}：${r.healthStatus === 'gray' ? '暂停补货' : '健康评估'}`,
    `最晚下单余量 ${Number.isFinite(r.latestOrderDays) ? r.latestOrderDays.toFixed(1) : '-'} 天`,
  ];
  if (params.poolNote) parts.push(params.poolNote);
  if (params.moqNote) parts.push(params.moqNote);
  return parts.join('，');
}
