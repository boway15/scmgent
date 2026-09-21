import type { DemandPlanPilotConfig } from './demand-plan-config.js';

export type SkuPilotInput = {
  skuId: string;
  projectGroup: string | null;
  spuId: string | null;
  isActive: boolean;
};

export function excludedCrossGroupSpuIds(skus: SkuPilotInput[]): Set<string> {
  const groupsBySpu = new Map<string, Set<string>>();

  for (const sku of skus) {
    if (!sku.spuId) continue;
    const groups = groupsBySpu.get(sku.spuId) ?? new Set<string>();
    if (sku.projectGroup) {
      groups.add(sku.projectGroup);
    }
    groupsBySpu.set(sku.spuId, groups);
  }

  const excluded = new Set<string>();
  for (const [spuId, groups] of groupsBySpu) {
    if (groups.size > 1) {
      excluded.add(spuId);
    }
  }
  return excluded;
}

export function isSkuWarehouseInPilot(input: {
  sku: SkuPilotInput;
  warehouseCode: string;
  config: DemandPlanPilotConfig;
  excludedSpuIds: Set<string>;
}): boolean {
  const { sku, warehouseCode, config, excludedSpuIds } = input;

  if (!config.enabled || !sku.isActive) {
    return false;
  }

  if (!sku.projectGroup || !config.projectGroups.includes(sku.projectGroup)) {
    return false;
  }

  if (!config.warehouses.includes(warehouseCode)) {
    return false;
  }

  if (sku.spuId && excludedSpuIds.has(sku.spuId)) {
    return false;
  }

  return true;
}
