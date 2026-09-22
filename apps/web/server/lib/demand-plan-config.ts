export type DemandPlanPilotConfig = {
  enabled: boolean;
  projectGroups: string[];
  warehouses: string[];
};

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

export function isWarehouseInPilot(
  warehouseCode: string,
  config: DemandPlanPilotConfig,
): boolean {
  return config.warehouses.includes(warehouseCode);
}
