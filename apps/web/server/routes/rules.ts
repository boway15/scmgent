import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, ruleParamSets, skus } from '@scm/db';
import { getCurrentUser, requireRole } from '../lib/auth-context.js';
import { validateParamPatch } from '../rules/core/param.js';
import {
  GLOBAL_SCOPE_VALUE,
  resolveParams,
  type ActiveParamSet,
  type RuleScopeType,
} from '../rules/core/resolve.js';
import { loadActiveParamSets } from '../rules/core/store.js';
import { RULE_MODULES, getRuleModule } from '../rules/registry.js';
import { SIMULATION_MAX_SKUS, simulateReplenishment } from '../rules/simulate.js';

export const ruleRoutes = new Hono();

const EDITOR_ROLES = ['pmc_planner'];

function toActive(row: typeof ruleParamSets.$inferSelect): ActiveParamSet {
  return {
    id: row.id,
    scopeType: row.scopeType as RuleScopeType,
    scopeValue: row.scopeValue,
    params: (row.params ?? {}) as Record<string, unknown>,
    version: row.version,
  };
}

async function loadSet(moduleCode: string, id: string) {
  const [row] = await db
    .select()
    .from(ruleParamSets)
    .where(and(eq(ruleParamSets.id, id), eq(ruleParamSets.moduleCode, moduleCode)))
    .limit(1);
  return row ?? null;
}

async function guard<T>(fn: () => Promise<T>): Promise<T | Response> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Forbidden') return new Response(JSON.stringify({ message: '无权限' }), { status: 403 });
    if (msg === 'Unauthorized') return new Response(JSON.stringify({ message: '未登录' }), { status: 401 });
    throw err;
  }
}

ruleRoutes.get('/rules', (c) =>
  c.json({
    items: RULE_MODULES.map((m) => ({
      code: m.code,
      name: m.name,
      description: m.description,
      version: m.version,
      scopes: m.scopes,
      params: m.params,
    })),
  }),
);

ruleRoutes.get('/rules/:module/param-sets', async (c) => {
  const mod = getRuleModule(c.req.param('module'));
  if (!mod) return c.json({ message: '模块不存在' }, 404);
  const status = c.req.query('status');
  const rows = await db
    .select()
    .from(ruleParamSets)
    .where(
      status
        ? and(eq(ruleParamSets.moduleCode, mod.code), eq(ruleParamSets.status, status))
        : eq(ruleParamSets.moduleCode, mod.code),
    )
    .orderBy(desc(ruleParamSets.updatedAt));
  return c.json({ items: rows });
});

ruleRoutes.get('/rules/:module/resolved', async (c) => {
  const mod = getRuleModule(c.req.param('module'));
  if (!mod) return c.json({ message: '模块不存在' }, 404);
  const sets = await loadActiveParamSets(mod.code);
  const resolved = resolveParams(mod.params, sets, {
    projectGroup: c.req.query('projectGroup') || null,
    warehouse: c.req.query('warehouse') || null,
  });
  return c.json(resolved);
});

ruleRoutes.post('/rules/:module/param-sets', async (c) => {
  const result = await guard(async () => {
    const user = await getCurrentUser(c);
    requireRole(user, ...EDITOR_ROLES);
    const mod = getRuleModule(c.req.param('module'));
    if (!mod) return c.json({ message: '模块不存在' }, 404);
    const body = await c.req.json<{ scopeType: RuleScopeType; scopeValue?: string; params: unknown; note?: string }>();
    if (!mod.scopes.includes(body.scopeType)) return c.json({ message: '该作用范围未开放' }, 400);
    const scopeValue = body.scopeType === 'global' ? GLOBAL_SCOPE_VALUE : body.scopeValue?.trim();
    if (!scopeValue) return c.json({ message: '缺少作用范围值' }, 400);
    if (!body.note?.trim()) return c.json({ message: '请填写修改说明' }, 400);
    const checked = validateParamPatch(mod.params, body.params);
    if (!checked.ok) return c.json({ message: checked.errors.join('；') }, 400);
    const [{ v }] = await db
      .select({ v: max(ruleParamSets.version) })
      .from(ruleParamSets)
      .where(
        and(
          eq(ruleParamSets.moduleCode, mod.code),
          eq(ruleParamSets.scopeType, body.scopeType),
          eq(ruleParamSets.scopeValue, scopeValue),
        ),
      );
    const [row] = await db
      .insert(ruleParamSets)
      .values({
        moduleCode: mod.code,
        scopeType: body.scopeType,
        scopeValue,
        params: checked.value,
        version: (v ?? 0) + 1,
        status: 'draft',
        note: body.note.trim(),
        createdBy: user.id,
      })
      .returning();
    return c.json(row, 201);
  });
  return result;
});

ruleRoutes.patch('/rules/:module/param-sets/:id', async (c) =>
  guard(async () => {
    const user = await getCurrentUser(c);
    requireRole(user, ...EDITOR_ROLES);
    const mod = getRuleModule(c.req.param('module'));
    if (!mod) return c.json({ message: '模块不存在' }, 404);
    const row = await loadSet(mod.code, c.req.param('id'));
    if (!row) return c.json({ message: '参数集不存在' }, 404);
    if (row.status !== 'draft') return c.json({ message: '只有草稿可以编辑' }, 409);
    const body = await c.req.json<{ params?: unknown; note?: string }>();
    const patch: Partial<typeof ruleParamSets.$inferInsert> = { updatedAt: new Date(), simulatedAt: null };
    if (body.params !== undefined) {
      const checked = validateParamPatch(mod.params, body.params);
      if (!checked.ok) return c.json({ message: checked.errors.join('；') }, 400);
      patch.params = checked.value;
    }
    if (body.note !== undefined) patch.note = body.note.trim();
    const [updated] = await db.update(ruleParamSets).set(patch).where(eq(ruleParamSets.id, row.id)).returning();
    return c.json(updated);
  }),
);

ruleRoutes.post('/rules/:module/param-sets/:id/simulate', async (c) =>
  guard(async () => {
    const user = await getCurrentUser(c);
    requireRole(user, ...EDITOR_ROLES);
    const mod = getRuleModule(c.req.param('module'));
    if (!mod || mod.code !== 'replenishment') return c.json({ message: '该模块暂不支持试算' }, 400);
    const row = await loadSet(mod.code, c.req.param('id'));
    if (!row) return c.json({ message: '参数集不存在' }, 404);
    if (row.status !== 'draft') return c.json({ message: '只有草稿可以试算' }, 409);
    const body = await c.req.json<{ skuCodes?: string[]; projectGroup?: string }>().catch(() => ({}));
    const codes = (body as { skuCodes?: string[] }).skuCodes?.map((s) => s.trim()).filter(Boolean) ?? [];
    const projectGroup = (body as { projectGroup?: string }).projectGroup?.trim();
    if (!codes.length && !projectGroup) return c.json({ message: '请指定 SKU 或项目组' }, 400);
    const skuRows = await db
      .select({ id: skus.id })
      .from(skus)
      .where(
        and(
          eq(skus.isActive, true),
          codes.length ? inArray(skus.code, codes) : eq(skus.projectGroup, projectGroup!),
        ),
      )
      .limit(SIMULATION_MAX_SKUS);
    if (!skuRows.length) return c.json({ message: '没有匹配的在售 SKU' }, 400);
    const result = await simulateReplenishment({ draft: toActive(row), skuIds: skuRows.map((r) => r.id) });
    await db.update(ruleParamSets).set({ simulatedAt: new Date() }).where(eq(ruleParamSets.id, row.id));
    return c.json({ ...result, skuCount: skuRows.length, maxSkus: SIMULATION_MAX_SKUS });
  }),
);

ruleRoutes.post('/rules/:module/param-sets/:id/submit', async (c) =>
  guard(async () => {
    const user = await getCurrentUser(c);
    requireRole(user, ...EDITOR_ROLES);
    const mod = getRuleModule(c.req.param('module'));
    if (!mod) return c.json({ message: '模块不存在' }, 404);
    const row = await loadSet(mod.code, c.req.param('id'));
    if (!row) return c.json({ message: '参数集不存在' }, 404);
    if (row.status !== 'draft') return c.json({ message: '只有草稿可以提交' }, 409);
    if (!row.simulatedAt) return c.json({ message: '请先试算再提交' }, 409);
    const [updated] = await db
      .update(ruleParamSets)
      .set({ status: 'pending_approval', updatedAt: new Date() })
      .where(eq(ruleParamSets.id, row.id))
      .returning();
    return c.json(updated);
  }),
);

ruleRoutes.post('/rules/:module/param-sets/:id/approve', async (c) =>
  guard(async () => {
    const user = await getCurrentUser(c);
    requireRole(user);
    const mod = getRuleModule(c.req.param('module'));
    if (!mod) return c.json({ message: '模块不存在' }, 404);
    const row = await loadSet(mod.code, c.req.param('id'));
    if (!row) return c.json({ message: '参数集不存在' }, 404);
    if (row.status !== 'pending_approval') return c.json({ message: '只有待审批的参数集可以审批' }, 409);
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      await tx
        .update(ruleParamSets)
        .set({ status: 'archived', updatedAt: now })
        .where(
          and(
            eq(ruleParamSets.moduleCode, row.moduleCode),
            eq(ruleParamSets.scopeType, row.scopeType),
            eq(ruleParamSets.scopeValue, row.scopeValue),
            eq(ruleParamSets.status, 'active'),
          ),
        );
      const [r] = await tx
        .update(ruleParamSets)
        .set({ status: 'active', approvedBy: user.id, approvedAt: now, activatedAt: now, updatedAt: now })
        .where(eq(ruleParamSets.id, row.id))
        .returning();
      return r;
    });
    return c.json(updated);
  }),
);

ruleRoutes.post('/rules/:module/param-sets/:id/reject', async (c) =>
  guard(async () => {
    const user = await getCurrentUser(c);
    requireRole(user);
    const mod = getRuleModule(c.req.param('module'));
    if (!mod) return c.json({ message: '模块不存在' }, 404);
    const row = await loadSet(mod.code, c.req.param('id'));
    if (!row) return c.json({ message: '参数集不存在' }, 404);
    if (row.status !== 'pending_approval') return c.json({ message: '只有待审批的参数集可以驳回' }, 409);
    const body = await c.req.json<{ reviewNote?: string }>().catch(() => ({}));
    const reviewNote = (body as { reviewNote?: string }).reviewNote?.trim();
    if (!reviewNote) return c.json({ message: '请填写驳回原因' }, 400);
    const [updated] = await db
      .update(ruleParamSets)
      .set({ status: 'draft', reviewNote, simulatedAt: null, updatedAt: new Date() })
      .where(eq(ruleParamSets.id, row.id))
      .returning();
    return c.json(updated);
  }),
);

ruleRoutes.post('/rules/:module/param-sets/:id/restore', async (c) =>
  guard(async () => {
    const user = await getCurrentUser(c);
    requireRole(user, ...EDITOR_ROLES);
    const mod = getRuleModule(c.req.param('module'));
    if (!mod) return c.json({ message: '模块不存在' }, 404);
    const row = await loadSet(mod.code, c.req.param('id'));
    if (!row) return c.json({ message: '参数集不存在' }, 404);
    if (row.status !== 'archived') return c.json({ message: '只能从历史版本恢复' }, 409);
    const [{ v }] = await db
      .select({ v: max(ruleParamSets.version) })
      .from(ruleParamSets)
      .where(
        and(
          eq(ruleParamSets.moduleCode, row.moduleCode),
          eq(ruleParamSets.scopeType, row.scopeType),
          eq(ruleParamSets.scopeValue, row.scopeValue),
        ),
      );
    const [created] = await db
      .insert(ruleParamSets)
      .values({
        moduleCode: row.moduleCode,
        scopeType: row.scopeType,
        scopeValue: row.scopeValue,
        params: row.params,
        version: (v ?? 0) + 1,
        status: 'draft',
        note: `恢复自 v${row.version}`,
        createdBy: user.id,
      })
      .returning();
    return c.json(created, 201);
  }),
);
