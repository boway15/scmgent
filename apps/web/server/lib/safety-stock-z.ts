/** Optional Z-value safety stock methods (P3). Default remains coverage_days elsewhere. */

export type SafetyStockMethod = 'coverage_days' | 'z_demand' | 'z_demand_leadtime';

export const DEFAULT_PLANNING_SAFETY_STOCK_DAYS = 14;

export type PlanningSafetyStockPolicy = {
  safetyStockMethod?: string | null;
  safetyStockDays?: number | null;
  safetyStockQty?: number | null;
  serviceLevel?: number | string | null;
  leadTimeStdDev?: number | string | null;
  calcMethod?: string | null;
};

function toFiniteNumber(value: number | string | null | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 规划主路径安全库存（健康 / 时间轴 / 补货任务同源），按 safety_stock_config 生效：
 * - calcMethod=manual 且件数 >0：沿用人工件数
 * - coverage_days（默认）：日均 × 安全天数
 * - z_demand / z_demand_leadtime：按配置服务水平与交期标准差实时计算
 */
export function resolvePlanningSafetyStock(params: {
  policy?: PlanningSafetyStockPolicy | null;
  avgDaily: number;
  demandStdDev: number;
  totalLeadDays: number;
}): { safetyStockQty: number; reorderPoint: number; method: SafetyStockMethod | 'manual' } {
  const policy = params.policy ?? null;
  const reorderPointFor = (safetyStockQty: number) =>
    Math.ceil(params.avgDaily * params.totalLeadDays + safetyStockQty);

  const manualQty = policy?.safetyStockQty ?? 0;
  if (policy?.calcMethod === 'manual' && manualQty > 0) {
    return { safetyStockQty: manualQty, reorderPoint: reorderPointFor(manualQty), method: 'manual' };
  }

  const method: SafetyStockMethod =
    policy?.safetyStockMethod === 'z_demand' || policy?.safetyStockMethod === 'z_demand_leadtime'
      ? policy.safetyStockMethod
      : 'coverage_days';
  const { safetyStockQty } = calcSafetyStockQty({
    method,
    serviceLevel: toFiniteNumber(policy?.serviceLevel),
    demandStdDev: params.demandStdDev,
    totalLeadDays: params.totalLeadDays,
    avgDaily: params.avgDaily,
    leadTimeStdDev: toFiniteNumber(policy?.leadTimeStdDev),
    safetyStockDays: policy?.safetyStockDays ?? DEFAULT_PLANNING_SAFETY_STOCK_DAYS,
  });
  return { safetyStockQty, reorderPoint: reorderPointFor(safetyStockQty), method };
}

const SERVICE_LEVEL_Z_TABLE: ReadonlyArray<{ serviceLevel: number; z: number }> = [
  { serviceLevel: 0.9, z: 1.28 },
  { serviceLevel: 0.95, z: 1.65 },
  { serviceLevel: 0.975, z: 1.96 },
  { serviceLevel: 0.99, z: 2.33 },
];

const DEFAULT_SERVICE_LEVEL = 0.95;

export function zFromServiceLevel(serviceLevel: number): number {
  let nearest = SERVICE_LEVEL_Z_TABLE[0]!;
  let minDiff = Math.abs(serviceLevel - nearest.serviceLevel);

  for (const entry of SERVICE_LEVEL_Z_TABLE) {
    const diff = Math.abs(serviceLevel - entry.serviceLevel);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = entry;
    }
  }

  return nearest.z;
}

export function calcSafetyStockQty(params: {
  method: SafetyStockMethod;
  serviceLevel?: number;
  demandStdDev: number;
  totalLeadDays: number;
  avgDaily?: number;
  leadTimeStdDev?: number;
  safetyStockDays?: number;
}): { safetyStockQty: number; z?: number; method: SafetyStockMethod } {
  const { method } = params;

  if (method === 'coverage_days') {
    const avgDaily = params.avgDaily ?? 0;
    const safetyStockDays = params.safetyStockDays ?? 0;
    return {
      method,
      safetyStockQty: Math.ceil(avgDaily * safetyStockDays),
    };
  }

  const serviceLevel = params.serviceLevel ?? DEFAULT_SERVICE_LEVEL;
  const z = zFromServiceLevel(serviceLevel);
  const leadDays = params.totalLeadDays;
  const demandStdDev = params.demandStdDev;

  if (method === 'z_demand') {
    const qty = z * demandStdDev * Math.sqrt(leadDays);
    return { method, z, safetyStockQty: Math.ceil(qty) };
  }

  const avgDaily = params.avgDaily ?? 0;
  const leadTimeStdDev = params.leadTimeStdDev ?? 0;
  const variance =
    leadDays * demandStdDev ** 2 + avgDaily ** 2 * leadTimeStdDev ** 2;
  const qty = z * Math.sqrt(variance);
  return { method, z, safetyStockQty: Math.ceil(qty) };
}
