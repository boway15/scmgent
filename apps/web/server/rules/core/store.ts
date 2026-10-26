import { and, eq } from 'drizzle-orm';
import { db, ruleEvalRuns, ruleParamSets } from '@scm/db';
import type { ParamSchema } from './param.js';
import {
  resolveParams,
  type ActiveParamSet,
  type ResolvedParams,
  type RuleScopeContext,
  type RuleScopeType,
} from './resolve.js';

export async function loadActiveParamSets(moduleCode: string): Promise<ActiveParamSet[]> {
  const rows = await db
    .select({
      id: ruleParamSets.id,
      scopeType: ruleParamSets.scopeType,
      scopeValue: ruleParamSets.scopeValue,
      params: ruleParamSets.params,
      version: ruleParamSets.version,
    })
    .from(ruleParamSets)
    .where(and(eq(ruleParamSets.moduleCode, moduleCode), eq(ruleParamSets.status, 'active')));
  return rows.map((row) => ({
    id: row.id,
    scopeType: row.scopeType as RuleScopeType,
    scopeValue: row.scopeValue,
    params: (row.params ?? {}) as Record<string, unknown>,
    version: row.version,
  }));
}

/** 同一次运行内按作用范围缓存解析结果。 */
export function createParamsResolver<S extends ParamSchema>(
  schema: S,
  sets: ActiveParamSet[],
): (ctx: RuleScopeContext) => ResolvedParams<S> {
  const cache = new Map<string, ResolvedParams<S>>();
  return (ctx) => {
    const key = [ctx.projectGroup ?? '', ctx.category ?? '', ctx.warehouse ?? '', ctx.skuCode ?? ''].join('|');
    const hit = cache.get(key);
    if (hit) return hit;
    const resolved = resolveParams(schema, sets, ctx);
    cache.set(key, resolved);
    return resolved;
  };
}

export async function startRuleRun(input: {
  moduleCode: string;
  trigger: 'task' | 'simulation' | 'page';
  moduleVersion: number;
  paramSetIds: string[];
}): Promise<string> {
  const [row] = await db
    .insert(ruleEvalRuns)
    .values({
      moduleCode: input.moduleCode,
      trigger: input.trigger,
      moduleVersion: input.moduleVersion,
      paramSetIds: input.paramSetIds,
    })
    .returning({ id: ruleEvalRuns.id });
  return row.id;
}

export async function finishRuleRun(id: string): Promise<void> {
  await db.update(ruleEvalRuns).set({ finishedAt: new Date() }).where(eq(ruleEvalRuns.id, id));
}
