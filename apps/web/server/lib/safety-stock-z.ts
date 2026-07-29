/** Optional Z-value safety stock methods (P3). Default remains coverage_days elsewhere. */

export type SafetyStockMethod = 'coverage_days' | 'z_demand' | 'z_demand_leadtime';

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
