import type { ParamSchema } from './param.js';
import type { RuleScopeType } from './resolve.js';

/** 判断依据：命中了哪条规则、用了哪个参数值。 */
export type RuleTraceItem = {
  rule: string;
  note: string;
  param?: string;
  value?: number | string | boolean | null;
};

export type RuleModuleMeta<S extends ParamSchema> = {
  code: string;
  name: string;
  description: string;
  version: number;
  params: S;
  scopes: readonly RuleScopeType[];
};

export function defineRuleModule<S extends ParamSchema>(meta: RuleModuleMeta<S>): RuleModuleMeta<S> {
  return meta;
}
