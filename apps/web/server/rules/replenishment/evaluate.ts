import type { InventoryHealth } from '../../lib/replenishment-coverage.js';
import { needsReplenishmentByHealth } from '../../lib/inventory-light.js';
import { shouldReplenishByLight, type ReplenishLight } from '../../lib/replenish-light.js';
import type { RuleTraceItem } from '../core/define.js';
import type { ReplenishmentParams } from './params.js';

export type MoqPriority = 'sku_then_spu' | 'spu_then_sku' | 'max';

function positive(value: number | null | undefined): number {
  return value != null && value > 0 ? value : 0;
}

export function resolveMoqByPriority(
  skuMoq: number | null | undefined,
  spuMoq: number | null | undefined,
  priority: string,
): number {
  const sku = positive(skuMoq);
  const spu = positive(spuMoq);
  if (priority === 'max') return Math.max(sku, spu);
  if (priority === 'spu_then_sku') return spu || sku;
  return sku || spu;
}

/** 单仓是否进入候选：灰灯、US 仓网延后、决策灯不需补、建议量为 0 均不进；进入时按 MOQ 抬升。 */
export function decideWarehouseCandidate(input: {
  coverageHealth: InventoryHealth;
  decisionHealth: InventoryHealth;
  deferredByUsNetwork: boolean;
  suggestedQty: number;
  moq: number;
}): { include: boolean; qty: number; moqApplied: boolean; trace: RuleTraceItem[] } {
  const trace: RuleTraceItem[] = [];
  const skip = (rule: string, note: string) => {
    trace.push({ rule, note });
    return { include: false, qty: 0, moqApplied: false, trace };
  };
  if (input.coverageHealth === 'gray') return skip('gray', '覆盖天数灯为灰（滞销/停售），不出建议');
  if (input.deferredByUsNetwork) return skip('us_network_defer', 'US 仓网总量足够，延后补货');
  if (!needsReplenishmentByHealth(input.decisionHealth)) {
    return skip('decision_light', `决策灯 ${input.decisionHealth}，无需补货`);
  }
  if (input.suggestedQty <= 0) return skip('no_gap', '净缺口为 0');

  trace.push({ rule: 'decision_light', note: `决策灯 ${input.decisionHealth}，需要补货` });
  const qty = input.moq > 0 ? Math.max(input.suggestedQty, input.moq) : input.suggestedQty;
  const moqApplied = qty > input.suggestedQty;
  if (moqApplied) {
    trace.push({ rule: 'moq', note: `建议量 ${input.suggestedQty} 按 MOQ 抬升至 ${qty}`, value: input.moq });
  }
  return { include: true, qty, moqApplied, trace };
}

export function isUsDeferEnabled(params: Pick<ReplenishmentParams, 'usNetworkDeferEnabled'>): boolean {
  return params.usNetworkDeferEnabled;
}

export function shouldReplenishWithLinkage(input: {
  replenishLight: ReplenishLight;
  needsReplenishment: boolean;
  spuHasRedNeedingReplenishment: boolean;
  yellowLightLinkage: boolean;
}): boolean {
  if (!input.yellowLightLinkage && input.replenishLight === 'yellow') {
    return input.needsReplenishment;
  }
  return shouldReplenishByLight({
    replenishLight: input.replenishLight,
    needsReplenishment: input.needsReplenishment,
    spuHasRedNeedingReplenishment: input.spuHasRedNeedingReplenishment,
  });
}
