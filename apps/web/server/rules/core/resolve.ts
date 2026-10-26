import { checkParamValue, defaultsOf, type ParamSchema, type ParamValues } from './param.js';

export type RuleScopeType = 'global' | 'project_group' | 'category' | 'warehouse' | 'sku';

/** 从低到高；越靠后越优先。 */
export const SCOPE_PRIORITY: readonly RuleScopeType[] = [
  'global',
  'project_group',
  'category',
  'warehouse',
  'sku',
];

export const GLOBAL_SCOPE_VALUE = '*';

export type ActiveParamSet = {
  id: string;
  scopeType: RuleScopeType;
  scopeValue: string;
  params: Record<string, unknown>;
  version: number;
};

export type RuleScopeContext = {
  projectGroup?: string | null;
  category?: string | null;
  warehouse?: string | null;
  skuCode?: string | null;
};

export type ParamSource =
  | { scopeType: RuleScopeType; scopeValue: string; paramSetId: string }
  | 'default';

export type ResolvedParams<S extends ParamSchema> = {
  values: ParamValues<S>;
  sources: Record<keyof S & string, ParamSource>;
  paramSetIds: string[];
};

function scopeValueFor(type: RuleScopeType, ctx: RuleScopeContext): string | null {
  switch (type) {
    case 'global':
      return GLOBAL_SCOPE_VALUE;
    case 'project_group':
      return ctx.projectGroup?.trim() || null;
    case 'category':
      return ctx.category?.trim() || null;
    case 'warehouse':
      return ctx.warehouse?.trim() || null;
    case 'sku':
      return ctx.skuCode?.trim() || null;
  }
}

export function resolveParams<S extends ParamSchema>(
  schema: S,
  sets: ActiveParamSet[],
  ctx: RuleScopeContext,
): ResolvedParams<S> {
  const values = defaultsOf(schema) as Record<string, unknown>;
  const sources: Record<string, ParamSource> = {};
  for (const key of Object.keys(schema)) sources[key] = 'default';
  const used = new Set<string>();

  for (const type of SCOPE_PRIORITY) {
    const want = scopeValueFor(type, ctx);
    if (want == null) continue;
    const set = sets.find((s) => s.scopeType === type && s.scopeValue === want);
    if (!set) continue;
    for (const [key, raw] of Object.entries(set.params)) {
      const spec = schema[key];
      if (!spec) continue;
      if (checkParamValue(key, spec, raw) != null) continue;
      values[key] = raw;
      sources[key] = { scopeType: type, scopeValue: want, paramSetId: set.id };
      used.add(set.id);
    }
  }

  return {
    values: values as ParamValues<S>,
    sources: sources as Record<keyof S & string, ParamSource>,
    paramSetIds: [...used],
  };
}
