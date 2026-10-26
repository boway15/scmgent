### Task 8: 规则中心 API（参数集 CRUD、审批、试算）

**Files:**
- Create: `apps/web/server/rules/simulate.ts`
- Create: `apps/web/server/routes/rules.ts`
- Modify: `apps/web/server/index.ts`
- Test: `apps/web/server/rules/simulate.test.ts`

**Interfaces:**
- Consumes: `runReplenishmentForecast({ dryRun, skuIds, paramSets, trigger })`、`loadActiveParamSets`、`validateParamPatch`、`getRuleModule`、`resolveParams`、`requireRole`、`getCurrentUser`
- Produces:
  ```ts
  // simulate.ts
  export type SimulationDiffRow = {
    skuCode: string; warehouseCode: string;
    before: { suggestedQty: number; suggestedDate: string; healthStatus: string } | null;
    after: { suggestedQty: number; suggestedDate: string; healthStatus: string } | null;
  };
  export function overlayDraft(active: ActiveParamSet[], draft: ActiveParamSet): ActiveParamSet[];
  export function diffSuggestions(before: ReplenishmentDryRow[], after: ReplenishmentDryRow[]): SimulationDiffRow[];
  export const SIMULATION_MAX_SKUS = 50;
  export async function simulateReplenishment(input: { draft: ActiveParamSet; skuIds: string[] }): Promise<{ rows: SimulationDiffRow[]; changed: number; total: number }>;
  ```
  API（前缀 `/api`）：
  | Method | Path | Body / Query | 权限 |
  |---|---|---|---|
  | GET | `/rules` | — | 登录 |
  | GET | `/rules/:module/param-sets` | `?status=` | 登录 |
  | GET | `/rules/:module/resolved` | `?projectGroup=&warehouse=` | 登录 |
  | POST | `/rules/:module/param-sets` | `{ scopeType, scopeValue, params, note }` | pmc_planner |
  | PATCH | `/rules/:module/param-sets/:id` | `{ params?, note? }` | pmc_planner |
  | POST | `/rules/:module/param-sets/:id/simulate` | `{ skuCodes?: string[]; projectGroup?: string }` | pmc_planner |
  | POST | `/rules/:module/param-sets/:id/submit` | — | pmc_planner |
  | POST | `/rules/:module/param-sets/:id/approve` | — | super_admin |
  | POST | `/rules/:module/param-sets/:id/reject` | `{ reviewNote }` | super_admin |
  | POST | `/rules/:module/param-sets/:id/restore` | — | pmc_planner |

- [ ] **Step 1: 写失败测试 `simulate.test.ts`**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffSuggestions, overlayDraft } from './simulate.js';

describe('overlayDraft', () => {
  it('replaces active set of same scope', () => {
    const out = overlayDraft(
      [
        { id: 'a', scopeType: 'global', scopeValue: '*', params: { singleCoverDays: 30 }, version: 1 },
        { id: 'b', scopeType: 'warehouse', scopeValue: 'UK', params: {}, version: 1 },
      ],
      { id: 'd', scopeType: 'global', scopeValue: '*', params: { singleCoverDays: 45 }, version: 2 },
    );
    assert.deepEqual(out.map((s) => s.id).sort(), ['b', 'd']);
  });
});

describe('diffSuggestions', () => {
  it('reports changed, added and removed rows only', () => {
    const row = (sku: string, qty: number) => ({
      skuCode: sku,
      warehouseCode: 'NETWORK',
      suggestedQty: qty,
      suggestedDate: '2026-10-26',
      healthStatus: 'red',
      needsManualConfirm: false,
    });
    const out = diffSuggestions([row('A', 10), row('B', 20), row('C', 5)], [row('A', 10), row('B', 40), row('D', 7)]);
    assert.deepEqual(out.map((r) => r.skuCode), ['B', 'C', 'D']);
    assert.equal(out[1].after, null);
    assert.equal(out[2].before, null);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/simulate.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `simulate.ts`**

```ts
import {
  runReplenishmentForecast,
  type ReplenishmentDryRow,
} from '../tasks/replenishmentForecast.js';
import type { ActiveParamSet } from './core/resolve.js';
import { loadActiveParamSets } from './core/store.js';
import { replenishmentRule } from './replenishment/index.js';

export const SIMULATION_MAX_SKUS = 50;

type Snapshot = { suggestedQty: number; suggestedDate: string; healthStatus: string };

export type SimulationDiffRow = {
  skuCode: string;
  warehouseCode: string;
  before: Snapshot | null;
  after: Snapshot | null;
};

export function overlayDraft(active: ActiveParamSet[], draft: ActiveParamSet): ActiveParamSet[] {
  return [
    ...active.filter((s) => !(s.scopeType === draft.scopeType && s.scopeValue === draft.scopeValue)),
    draft,
  ];
}

function snap(row: ReplenishmentDryRow | undefined): Snapshot | null {
  return row
    ? { suggestedQty: row.suggestedQty, suggestedDate: row.suggestedDate, healthStatus: row.healthStatus }
    : null;
}

export function diffSuggestions(
  before: ReplenishmentDryRow[],
  after: ReplenishmentDryRow[],
): SimulationDiffRow[] {
  const key = (r: ReplenishmentDryRow) => `${r.skuCode}::${r.warehouseCode}`;
  const b = new Map(before.map((r) => [key(r), r]));
  const a = new Map(after.map((r) => [key(r), r]));
  const keys = [...new Set([...b.keys(), ...a.keys()])].sort();
  const out: SimulationDiffRow[] = [];
  for (const k of keys) {
    const x = snap(b.get(k));
    const y = snap(a.get(k));
    if (x && y && JSON.stringify(x) === JSON.stringify(y)) continue;
    const [skuCode, warehouseCode] = k.split('::');
    out.push({ skuCode, warehouseCode, before: x, after: y });
  }
  return out;
}

export async function simulateReplenishment(input: {
  draft: ActiveParamSet;
  skuIds: string[];
}): Promise<{ rows: SimulationDiffRow[]; changed: number; total: number }> {
  const skuIds = input.skuIds.slice(0, SIMULATION_MAX_SKUS);
  const active = await loadActiveParamSets(replenishmentRule.code);
  const [before, after] = await Promise.all([
    runReplenishmentForecast({ dryRun: true, skuIds, paramSets: active, trigger: 'simulation' }),
    runReplenishmentForecast({
      dryRun: true,
      skuIds,
      paramSets: overlayDraft(active, input.draft),
      trigger: 'simulation',
    }),
  ]);
  const beforeRows = before.dry?.suggestions ?? [];
  const afterRows = after.dry?.suggestions ?? [];
  const rows = diffSuggestions(beforeRows, afterRows);
  return { rows, changed: rows.length, total: new Set([...beforeRows, ...afterRows].map((r) => r.skuCode)).size };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/simulate.test.ts`
Expected: `fail 0`

- [ ] **Step 5: 实现 `routes/rules.ts`**

```ts
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
```

说明：`requireRole(user)` 不带角色时只放行 `super_admin`（见 `auth-context.ts` `requireRole` 实现）。`drizzle-orm` 0.30 的 `max` 从 `drizzle-orm` 导出；若该版本无 `max`，改用 ``sql<number>`max(${ruleParamSets.version})` ``。

- [ ] **Step 6: 挂载路由**

`apps/web/server/index.ts`：在 `import { safetyStockRoutes } ...` 附近加 `import { ruleRoutes } from './routes/rules.js';`，在 `app.route('/api', safetyStockRoutes);` 之后加 `app.route('/api', ruleRoutes);`。

- [ ] **Step 7: 接口冒烟**

本地 `pnpm dev:server`，以 `pmc_planner` 用户登录后（或 `AUTH_BYPASS_LOGIN=true` 以管理员身份）：

```bash
curl -s http://127.0.0.1:3000/api/rules
curl -s -X POST http://127.0.0.1:3000/api/rules/replenishment/param-sets -H "content-type: application/json" -d "{\"scopeType\":\"global\",\"params\":{\"singleCoverDays\":45},\"note\":\"冒烟\"}"
```

Expected：第一条返回含 `replenishment` 的模块列表；第二条返回 201 与 `status: "draft"`。随后依次调用 `simulate`（带 `skuCodes`）、`submit`、`approve`，确认 `GET /api/rules/replenishment/resolved` 中 `singleCoverDays` 为 45、来源为该参数集。冒烟结束后删除测试数据：`DELETE FROM rule_param_sets WHERE note = '冒烟';`。

（端口以 `apps/web/server/index.ts` 中实际监听端口为准。）

- [ ] **Step 8: Commit**

```bash
git add apps/web/server/rules/simulate.ts apps/web/server/rules/simulate.test.ts apps/web/server/routes/rules.ts apps/web/server/index.ts
git commit -m "feat(rules): rule center API with approval and simulation"
```

---

