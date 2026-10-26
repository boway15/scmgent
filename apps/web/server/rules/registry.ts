import type { ParamSchema } from './core/param.js';
import type { RuleModuleMeta } from './core/define.js';
import { replenishmentRule } from './replenishment/index.js';

export const RULE_MODULES: ReadonlyArray<RuleModuleMeta<ParamSchema>> = [replenishmentRule];

export function getRuleModule(code: string): RuleModuleMeta<ParamSchema> | undefined {
  return RULE_MODULES.find((m) => m.code === code);
}
