import { calcReorderPoint } from './replenishment.js';
import { calcSafetyStockQty, zFromServiceLevel } from './safety-stock-z.js';

export type SuggestionConfidence = 'high' | 'medium' | 'low';

export type SafetyStockSuggestion = {
  safetyStockQty: number | null;
  safetyStockDays: number | null;
  reorderPoint: number | null;
  method: 'z_demand' | 'z_demand_leadtime';
  serviceLevel: number;
  avgDaily: number;
  demandStdDev: number;
  totalLeadDays: number;
  z: number;
  confidence: SuggestionConfidence;
  flags: string[];
};

export const MAX_SUGGESTED_SAFETY_STOCK_DAYS = 180;
const DEFAULT_SERVICE_LEVEL = 0.95;
const LOW_SAMPLE_DAYS = 14;

function resolveConfidence(params: {
  avgDaily: number;
  inStockDays: number;
  effectiveSalesDays: number;
  stockoutAdjusted: boolean;
  daysCapped: boolean;
}): SuggestionConfidence {
  if (params.avgDaily <= 0) return 'low';
  if (params.stockoutAdjusted) return 'medium';
  if (params.inStockDays >= 30 && !params.daysCapped) return 'high';
  if (params.effectiveSalesDays >= LOW_SAMPLE_DAYS) return 'medium';
  return 'low';
}

export function calcSafetyStockSuggestion(params: {
  avgDaily: number;
  demandStdDev: number;
  totalLeadDays: number;
  serviceLevel?: number;
  inStockDays?: number;
  stockoutAdjusted?: boolean;
  demandSource?: 'forecast' | 'historical';
  effectiveSalesDays?: number;
  /** 已维护的交期标准差（天）。大于 0 时按需求+交期波动计算。 */
  leadTimeStdDev?: number | null;
}): SafetyStockSuggestion {
  const flags: string[] = [];
  const serviceLevel = params.serviceLevel ?? DEFAULT_SERVICE_LEVEL;
  const z = zFromServiceLevel(serviceLevel);
  const avgDaily = params.avgDaily;
  const demandStdDev = params.demandStdDev;
  let totalLeadDays = params.totalLeadDays;

  if (totalLeadDays <= 0) {
    totalLeadDays = 1;
    flags.push('lead_time_fallback');
  }

  if (params.demandSource === 'forecast') flags.push('forecast_demand');
  if (params.stockoutAdjusted) flags.push('stockout_adjusted');

  const effectiveSalesDays = params.effectiveSalesDays ?? params.inStockDays ?? 0;
  if (effectiveSalesDays > 0 && effectiveSalesDays < LOW_SAMPLE_DAYS) {
    flags.push('low_sample');
  }

  if (avgDaily <= 0) {
    flags.push('no_sales');
    return {
      safetyStockQty: null,
      safetyStockDays: null,
      reorderPoint: null,
      method: 'z_demand',
      serviceLevel,
      avgDaily,
      demandStdDev,
      totalLeadDays,
      z,
      confidence: 'low',
      flags,
    };
  }

  const leadTimeStdDev =
    params.leadTimeStdDev != null && Number.isFinite(params.leadTimeStdDev) && params.leadTimeStdDev > 0
      ? params.leadTimeStdDev
      : 0;
  const method = leadTimeStdDev > 0 ? 'z_demand_leadtime' : 'z_demand';
  if (method === 'z_demand_leadtime') flags.push('lead_time_uncertainty');
  const { safetyStockQty } = calcSafetyStockQty({
    method,
    serviceLevel,
    demandStdDev,
    totalLeadDays,
    avgDaily,
    leadTimeStdDev,
  });

  let safetyStockDays = Math.ceil(safetyStockQty / avgDaily);
  let daysCapped = false;
  if (safetyStockDays > MAX_SUGGESTED_SAFETY_STOCK_DAYS) {
    safetyStockDays = MAX_SUGGESTED_SAFETY_STOCK_DAYS;
    daysCapped = true;
    flags.push('days_capped');
  }

  const reorderPoint = calcReorderPoint(avgDaily, totalLeadDays, safetyStockQty);
  const confidence = resolveConfidence({
    avgDaily,
    inStockDays: params.inStockDays ?? 0,
    effectiveSalesDays,
    stockoutAdjusted: params.stockoutAdjusted === true,
    daysCapped,
  });

  return {
    safetyStockQty,
    safetyStockDays,
    reorderPoint,
    method,
    serviceLevel,
    avgDaily,
    demandStdDev,
    totalLeadDays,
    z,
    confidence,
    flags,
  };
}
