/** 需求计划按项目组指定，不拆仓；出货/调拨时再选目的仓。 */
export const DEMAND_PLAN_WAREHOUSE_ALL = 'ALL';
/** 全量 SKU 周计划范围标识（不再按项目组拆分生成）。 */
export const DEMAND_PLAN_PROJECT_GROUP_ALL = 'ALL';

export function isAllScopeProjectGroup(projectGroup: string | null | undefined): boolean {
  return projectGroup === DEMAND_PLAN_PROJECT_GROUP_ALL;
}

export type DemandPlanPilotConfig = {
  enabled: boolean;
  projectGroups: string[];
  warehouses: string[];
};

export function isUnallocatedPlanWarehouse(warehouseCode: string | null | undefined): boolean {
  return !warehouseCode || warehouseCode === DEMAND_PLAN_WAREHOUSE_ALL;
}

function parseCommaList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseDemandPlanPilotConfig(env: NodeJS.ProcessEnv): DemandPlanPilotConfig {
  return {
    enabled: env.DEMAND_PLAN_PILOT_ENABLED === 'true',
    projectGroups: parseCommaList(env.DEMAND_PLAN_PILOT_PROJECT_GROUPS),
    warehouses: parseCommaList(env.DEMAND_PLAN_PILOT_WAREHOUSES),
  };
}

/** 空列表表示试点组内所有目的仓均可消费（按占比投影网络需求）。 */
export function isWarehouseInPilot(
  warehouseCode: string,
  config: DemandPlanPilotConfig,
): boolean {
  if (!config.warehouses.length) return true;
  return config.warehouses.includes(warehouseCode);
}

export function isProjectGroupInPilot(
  projectGroup: string | null | undefined,
  config: DemandPlanPilotConfig,
): boolean {
  if (!projectGroup) return false;
  if (!config.projectGroups.length) return true;
  return config.projectGroups.includes(projectGroup);
}
