# 规则模块化 第 0 期（框架 + 备货规则）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建规则模块框架（参数定义、分层解析、参数集存储与审批、试算、规则中心页面），并把备货规则的判断与参数迁入第一个模块，默认参数下补货结果与迁移前逐行一致。

**Architecture:** 新增 `apps/web/server/rules/`：`core/` 放参数描述、分层解析、存储；`replenishment/` 放备货参数与纯函数判断；`registry.ts` 登记模块。现有时间轴 / 健康度 / 补货任务改为从解析后的参数取值，判断逻辑调用规则模块函数。参数集存 `rule_param_sets`，每次运行记 `rule_eval_runs`。前端新增「规则中心」页 `/system/rules`。

**Tech Stack:** PostgreSQL、Drizzle（`packages/db`）、Hono、React + TanStack Query、Node `node:test` via `pnpm --filter @scm/web exec tsx --test`

**Spec:** `docs/superpowers/specs/2026-10-26-rule-modules-design.md`

## Global Constraints

- 默认参数值必须与现行常量完全一致：单次补货覆盖 30 天、默认安全库存 14 天、超储阈值 180 天、滞销日均上限 0.1、滞销覆盖下限 90 天、MOQ 取值 SKU 优先再 SPU、黄灯联动开、US 仓网延后开。
- 数据库无任何参数集时，系统行为与迁移前完全一致（§Task 1 基线对照）。
- 第 0 期覆盖层级只开放 `global`、`project_group`、`warehouse`。
- 编辑草稿 / 试算 / 提交：角色 `pmc_planner`、`super_admin`；审批 / 驳回：`super_admin`。
- 测试命令（在仓库根目录执行）：`pnpm --filter @scm/web exec tsx --test <相对 apps/web 的路径>`，期望 `fail 0`。
- 类型检查：`pnpm --filter @scm/web exec tsc --noEmit -p tsconfig.json`，不得新增报错（若存在历史报错，对比改动前输出）。
- 代码注释、页面文案用中文简体；标识符英文。不为妙搭 ZIP / CJS 做适配。
- 不修改驾驶舱分档、预警、出货逻辑（第 1、2 期）。

## File Structure

| 文件 | 职责 |
|------|------|
| Create `apps/web/server/rules/core/param.ts` | 参数描述类型、默认值、补丁校验 |
| Create `apps/web/server/rules/core/resolve.ts` | 作用范围优先级、分层合并、来源标注 |
| Create `apps/web/server/rules/core/define.ts` | `defineRuleModule`、`RuleTraceItem` |
| Create `apps/web/server/rules/core/store.ts` | 读 active 参数集、run 记录、解析器工厂（访问数据库） |
| Create `apps/web/server/rules/replenishment/params.ts` | 备货参数 schema 与默认值常量 |
| Create `apps/web/server/rules/replenishment/qty.ts` | 建议量：缺口 → 30 天封顶 → MOQ |
| Create `apps/web/server/rules/replenishment/evaluate.ts` | MOQ 取值、单仓候选判断、黄灯联动、US 延后开关 |
| Create `apps/web/server/rules/replenishment/index.ts` | 模块定义 |
| Create `apps/web/server/rules/registry.ts` | 模块注册表 |
| Create `apps/web/server/rules/simulate.ts` | 试算：两套参数跑补货 dry-run 并对比 |
| Create `apps/web/server/routes/rules.ts` | 规则中心 API |
| Create `packages/db/src/schema/rules.ts` | `rule_param_sets`、`rule_eval_runs` |
| Create `packages/db/drizzle/0123_rule_param_sets.sql` | 建表 |
| Create `packages/db/drizzle/0124_rule_center_menu.sql` | 菜单与角色授权 |
| Create `apps/web/scripts/replenishment-baseline.ts` | 导出 / 对比补货 dry-run 结果 |
| Create `apps/web/src/pages/RuleCenterPage.tsx` | 规则中心页面 |
| Modify `apps/web/server/tasks/replenishmentForecast.ts` | dry-run 选项、参数注入、调用规则函数、记录 run |
| Modify `apps/web/server/lib/inventory-timeline.ts` | 建议量委托 `rules/replenishment/qty.ts`，`coverDays` 入参 |
| Modify `apps/web/server/lib/inventory-timeline-service.ts` | 透传 `coverDays` |
| Modify `apps/web/server/lib/inventory-light.ts` | 滞销阈值可传入 |
| Modify `apps/web/server/lib/inventory-health-service.ts` | `ruleDefaults` 入参 |
| Modify `apps/web/server/lib/safety-stock-z.ts` | `defaultSafetyStockDays` 入参 |
| Modify `apps/web/server/lib/replenishment-coverage.ts` | 默认常量改为引用规则默认值 |
| Modify `apps/web/server/lib/safety-stock-suggestion-service.ts` | 删除重复常量 |
| Modify `apps/web/server/lib/alert-action.ts` | 删除重复常量 |
| Modify `apps/web/server/lib/inventory-planning-service.ts` | 规划页按解析参数计算 |
| Modify `apps/web/server/index.ts` | 挂载 `ruleRoutes` |
| Modify `packages/db/src/schema/index.ts`、`packages/db/drizzle/meta/_journal.json` | 导出 schema、登记迁移 |
| Modify `apps/web/src/lib/api.ts`、`apps/web/src/router.tsx` | 前端 API 与路由 |
| Modify `docs/business/scm-demand-supply-inventory-logic.md` | 补「规则中心」口径 |

---

### Task 1: 补货任务 dry-run 与基线导出

迁移前先固定基线。此任务不改变任何业务结果。

**Files:**
- Modify: `apps/web/server/tasks/replenishmentForecast.ts`
- Create: `apps/web/scripts/replenishment-baseline.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ReplenishmentRunOptions = {
    dryRun?: boolean;          // true：不同步三池、不写任何表、不调 Dify
    skuIds?: string[];         // 只跑这些 SKU
  };
  export type ReplenishmentDryRow = {
    skuCode: string;
    warehouseCode: string;     // 网络行为 'NETWORK'
    suggestedQty: number;
    suggestedDate: string;
    healthStatus: string;
    needsManualConfirm: boolean;
  };
  export type ReplenishmentHealthDryRow = {
    skuCode: string;
    warehouseCode: string;
    healthStatus: string;
    suggestedQty: number;
    suggestedDate: string;
  };
  export async function runReplenishmentForecast(options?: ReplenishmentRunOptions): Promise<{
    suggestionCount: number;
    snapshotCount: number;
    engine?: string;
    difyEnhanced?: boolean;
    results: Array<{ skuCode: string; warehouseCode: string; suggestedQty: number; healthStatus: InventoryHealth; reason: string }>;
    dry?: { suggestions: ReplenishmentDryRow[]; health: ReplenishmentHealthDryRow[] };
    message?: string;
  }>;
  ```

- [ ] **Step 1: 改函数签名与写库分支**

在 `replenishmentForecast.ts` 顶部（`positionKey` 之后）加入类型，并修改函数：

```ts
export type ReplenishmentRunOptions = {
  /** 试算 / 基线：不同步三池、不写任何表、不调 Dify */
  dryRun?: boolean;
  skuIds?: string[];
};

export type ReplenishmentDryRow = {
  skuCode: string;
  warehouseCode: string;
  suggestedQty: number;
  suggestedDate: string;
  healthStatus: string;
  needsManualConfirm: boolean;
};

export type ReplenishmentHealthDryRow = {
  skuCode: string;
  warehouseCode: string;
  healthStatus: string;
  suggestedQty: number;
  suggestedDate: string;
};
```

`export async function runReplenishmentForecast()` 改为 `export async function runReplenishmentForecast(options: ReplenishmentRunOptions = {})`，并做以下替换：

1. 开头三池同步包一层：
   ```ts
   const dryRun = options.dryRun === true;
   if (!dryRun) {
     try {
       await syncInventorySupplyLots();
     } catch (err) {
       console.warn('[replenishmentForecast] supply lot sync skipped:', err);
     }
   }
   ```
2. `activeSkus` 查询的 `.where(eq(skus.isActive, true))` 改为：
   ```ts
   .where(
     options.skuIds?.length
       ? and(eq(skus.isActive, true), inArray(skus.id, options.skuIds))
       : eq(skus.isActive, true),
   );
   ```
3. 循环内 `await upsertSafetyStock(...)` 改为 `if (!dryRun) await upsertSafetyStock(...)`。
4. `const snapshotCount = await saveHealthSnapshots(healthRows);` 与 `await syncReplenishLightFromHealth(healthRows);` 改为：
   ```ts
   const snapshotCount = dryRun ? 0 : await saveHealthSnapshots(healthRows);
   if (!dryRun) await syncReplenishLightFromHealth(healthRows);
   ```
5. `const shouldEnhance = ...` 改为 `const shouldEnhance = !dryRun && eligibleItems.length > 0 && isReplenishmentWorkflowEnabled();`
6. 在 `const expireSkuIds = ...` 之前插入 dry-run 提前返回：
   ```ts
   if (dryRun) {
     return {
       suggestionCount: eligibleItems.length,
       snapshotCount: 0,
       results: [],
       dry: {
         suggestions: eligibleItems.map((item) => ({
           skuCode: item.skuCode,
           warehouseCode: item.warehouseCode ?? 'NETWORK',
           suggestedQty: item.suggestedQty,
           suggestedDate: item.suggestedDate,
           healthStatus: item.healthStatus,
           needsManualConfirm: item.metrics?.needsManualConfirm === true,
         })),
         health: healthRows.map((row) => ({
           skuCode: row.skuCode,
           warehouseCode: row.warehouseCode,
           healthStatus: row.healthStatus,
           suggestedQty: row.suggestedQty,
           suggestedDate: row.suggestedDate,
         })),
       },
     };
   }
   ```
   若 `SkuHealthRow` 上字段名与此不符（`skuCode`、`warehouseCode`、`healthStatus`、`suggestedQty`、`suggestedDate`），以 `inventory-health-service.ts` 中 `SkuHealthRow` 定义为准调整映射，不改语义。

- [ ] **Step 2: 写基线脚本**

`apps/web/scripts/replenishment-baseline.ts`：

默认抽样：最近有补货建议的在售 SKU 最多 300 个，加上其余在售 SKU 按编码顺序取 200 个；抽中的 SKU id 写进基线文件，`compare` 用同一批 SKU。`--full` 跑全部在售 SKU（全量单次可能超过 1 小时，只在 Task 10 收尾时用）。

脚本在 `apps/web/scripts/` 下执行，`dotenv/config` 找不到仓库根的 `.env`。必须先显式加载 `../../../.env`（从 `apps/web/scripts` 上溯三级到仓库根），再用动态 `import` 加载 `@scm/db` 和补货任务，否则数据库客户端会在环境变量就绪前初始化。

```ts
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, asc, desc, eq, notInArray } from 'drizzle-orm';

config({ path: resolve(import.meta.dirname, '../../../.env') });

const { db, reorderSuggestions, skus } = await import('@scm/db');
const { runReplenishmentForecast } = await import('../server/tasks/replenishmentForecast.js');

const SAMPLE_WITH_SUGGESTIONS = 300;
const SAMPLE_OTHERS = 200;

async function pickSampleSkuIds(): Promise<string[]> {
  const suggested = await db
    .selectDistinct({ id: skus.id, generatedAt: reorderSuggestions.generatedAt })
    .from(reorderSuggestions)
    .innerJoin(skus, eq(reorderSuggestions.skuId, skus.id))
    .where(eq(skus.isActive, true))
    .orderBy(desc(reorderSuggestions.generatedAt));
  const withSuggestions = [...new Set(suggested.map((r) => r.id))].slice(0, SAMPLE_WITH_SUGGESTIONS);
  const others = await db
    .select({ id: skus.id })
    .from(skus)
    .where(
      withSuggestions.length
        ? and(eq(skus.isActive, true), notInArray(skus.id, withSuggestions))
        : eq(skus.isActive, true),
    )
    .orderBy(asc(skus.code))
    .limit(SAMPLE_OTHERS);
  return [...withSuggestions, ...others.map((r) => r.id)];
}

type Row = Record<string, string | number | boolean>;

function keyOf(row: Row): string {
  return `${row.skuCode}::${row.warehouseCode}`;
}

function sortRows<T extends Row>(rows: T[]): T[] {
  return [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

function diffRows(name: string, base: Row[], next: Row[]): string[] {
  const out: string[] = [];
  const baseMap = new Map(base.map((r) => [keyOf(r), r]));
  const nextMap = new Map(next.map((r) => [keyOf(r), r]));
  for (const [key, row] of baseMap) {
    const other = nextMap.get(key);
    if (!other) {
      out.push(`[${name}] 缺失 ${key}`);
      continue;
    }
    for (const field of Object.keys(row)) {
      if (row[field] !== other[field]) {
        out.push(`[${name}] ${key} ${field}: ${row[field]} → ${other[field]}`);
      }
    }
  }
  for (const key of nextMap.keys()) {
    if (!baseMap.has(key)) out.push(`[${name}] 新增 ${key}`);
  }
  return out;
}

type Baseline = {
  /** null 表示全量 */
  skuIds: string[] | null;
  suggestions: Row[];
  health: Row[];
};

async function main() {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const [mode, file] = args.filter((a) => !a.startsWith('--'));
  if ((mode !== 'export' && mode !== 'compare') || !file) {
    console.error('用法: tsx scripts/replenishment-baseline.ts <export|compare> <file.json> [--full]');
    process.exit(2);
  }
  const base = mode === 'compare' ? (JSON.parse(readFileSync(file, 'utf8')) as Baseline) : null;
  const skuIds = base ? base.skuIds : full ? null : await pickSampleSkuIds();
  const started = Date.now();
  const result = await runReplenishmentForecast({ dryRun: true, ...(skuIds ? { skuIds } : {}) });
  const current: Baseline = {
    skuIds,
    suggestions: sortRows(result.dry?.suggestions ?? []),
    health: sortRows(result.dry?.health ?? []),
  };
  const seconds = Math.round((Date.now() - started) / 1000);
  if (mode === 'export') {
    writeFileSync(file, JSON.stringify(current, null, 2), 'utf8');
    console.log(
      `已导出 ${skuIds ? `${skuIds.length} 个 SKU` : '全量'}：${current.suggestions.length} 条建议、${current.health.length} 条健康行，用时 ${seconds}s → ${file}`,
    );
    process.exit(0);
  }
  if (!base) process.exit(2);
  const diffs = [
    ...diffRows('suggestions', base.suggestions, current.suggestions),
    ...diffRows('health', base.health, current.health),
  ];
  if (diffs.length) {
    console.error(diffs.slice(0, 200).join('\n'));
    console.error(`共 ${diffs.length} 处差异`);
    process.exit(1);
  }
  console.log('与基线一致');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: 跑现有测试**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts server/lib/replenishment-coverage.test.ts server/lib/network-replenishment.test.ts server/lib/replenish-light-sync.test.ts`
Expected: `fail 0`

- [ ] **Step 4: 导出基线**

前置：本地数据库为一份生产快照（按 `docs/local-server-release-sop.md` 恢复），`.env` 指向它。

Run: `pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts export ../../.tmp-rules-baseline.json`
Expected: 输出「已导出 K 个 SKU：N 条建议、M 条健康行」，K ≈ 500，N、M > 0。

然后立即跑一次 compare，确认 dry-run 结果可重复（同一代码两次运行一致）：

Run: `pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts compare ../../.tmp-rules-baseline.json`
Expected: `与基线一致`。若不一致，说明计算本身有不确定性（如依赖当前时刻），须先查明原因再继续。

基线文件不提交（`.tmp-*` 前缀）。**时间轴依赖当天日期，基线对照须在同一天完成**；跨天时按 Task 8 Step 1 用 worktree 重新导出基线。

- [ ] **Step 5: Commit 并打标签**

```bash
git add apps/web/server/tasks/replenishmentForecast.ts apps/web/scripts/replenishment-baseline.ts
git commit -m "feat(replenishment): dry-run option and baseline export script"
git tag rules-p0-baseline
```

---

### Task 2: 规则框架核心（参数描述 + 分层解析）

**Files:**
- Create: `apps/web/server/rules/core/param.ts`
- Create: `apps/web/server/rules/core/resolve.ts`
- Create: `apps/web/server/rules/core/define.ts`
- Test: `apps/web/server/rules/core/param.test.ts`、`apps/web/server/rules/core/resolve.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // param.ts
  export type ParamSpec = IntSpec | NumberSpec | BooleanSpec | EnumSpec;
  export type ParamSchema = Record<string, ParamSpec>;
  export type ParamValues<S extends ParamSchema>;
  export function defaultsOf<S extends ParamSchema>(schema: S): ParamValues<S>;
  export function validateParamPatch(schema: ParamSchema, patch: unknown):
    { ok: true; value: Record<string, number | boolean | string> } | { ok: false; errors: string[] };
  // resolve.ts
  export type RuleScopeType = 'global' | 'project_group' | 'category' | 'warehouse' | 'sku';
  export const SCOPE_PRIORITY: readonly RuleScopeType[];
  export type ActiveParamSet = { id: string; scopeType: RuleScopeType; scopeValue: string; params: Record<string, unknown>; version: number };
  export type RuleScopeContext = { projectGroup?: string | null; category?: string | null; warehouse?: string | null; skuCode?: string | null };
  export type ParamSource = { scopeType: RuleScopeType; scopeValue: string; paramSetId: string } | 'default';
  export type ResolvedParams<S extends ParamSchema> = { values: ParamValues<S>; sources: Record<keyof S & string, ParamSource>; paramSetIds: string[] };
  export function resolveParams<S extends ParamSchema>(schema: S, sets: ActiveParamSet[], ctx: RuleScopeContext): ResolvedParams<S>;
  // define.ts
  export type RuleTraceItem = { rule: string; note: string; param?: string; value?: number | string | boolean | null };
  export type RuleModuleMeta<S extends ParamSchema> = { code: string; name: string; description: string; version: number; params: S; scopes: readonly RuleScopeType[] };
  export function defineRuleModule<S extends ParamSchema>(meta: RuleModuleMeta<S>): RuleModuleMeta<S>;
  ```

- [ ] **Step 1: 写失败测试 `param.test.ts`**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultsOf, validateParamPatch, type ParamSchema } from './param.js';

const schema = {
  coverDays: { kind: 'int', label: '覆盖天数', unit: '天', default: 30, min: 7, max: 180 },
  ratio: { kind: 'number', label: '倍数', default: 1.1, min: 1, max: 3 },
  linkage: { kind: 'boolean', label: '联动', default: true },
  priority: {
    kind: 'enum',
    label: '优先级',
    default: 'a',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  },
} satisfies ParamSchema;

describe('defaultsOf', () => {
  it('returns default for every key', () => {
    assert.deepEqual(defaultsOf(schema), { coverDays: 30, ratio: 1.1, linkage: true, priority: 'a' });
  });
});

describe('validateParamPatch', () => {
  it('accepts a sparse valid patch', () => {
    const r = validateParamPatch(schema, { coverDays: 45, linkage: false });
    assert.deepEqual(r, { ok: true, value: { coverDays: 45, linkage: false } });
  });
  it('rejects unknown key, non-integer, out of range, wrong enum', () => {
    const r = validateParamPatch(schema, { foo: 1, coverDays: 7.5, ratio: 9, priority: 'z' });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.errors.length, 4);
    }
  });
  it('rejects non-object', () => {
    assert.equal(validateParamPatch(schema, null).ok, false);
    assert.equal(validateParamPatch(schema, [1]).ok, false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/core/param.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `param.ts`**

```ts
type BaseSpec = { label: string; help?: string };
export type IntSpec = BaseSpec & { kind: 'int'; unit?: string; default: number; min: number; max: number };
export type NumberSpec = BaseSpec & { kind: 'number'; unit?: string; default: number; min: number; max: number };
export type BooleanSpec = BaseSpec & { kind: 'boolean'; default: boolean };
export type EnumSpec = BaseSpec & {
  kind: 'enum';
  default: string;
  options: ReadonlyArray<{ value: string; label: string }>;
};
export type ParamSpec = IntSpec | NumberSpec | BooleanSpec | EnumSpec;
export type ParamSchema = Record<string, ParamSpec>;

type ValueOf<P extends ParamSpec> = P extends BooleanSpec ? boolean : P extends EnumSpec ? string : number;
export type ParamValues<S extends ParamSchema> = { [K in keyof S]: ValueOf<S[K]> };
export type ParamScalar = number | boolean | string;

export function defaultsOf<S extends ParamSchema>(schema: S): ParamValues<S> {
  const out: Record<string, ParamScalar> = {};
  for (const [key, spec] of Object.entries(schema)) out[key] = spec.default;
  return out as ParamValues<S>;
}

/** 单值校验；通过返回 null，否则返回中文错误。 */
export function checkParamValue(key: string, spec: ParamSpec, value: unknown): string | null {
  switch (spec.kind) {
    case 'int':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${spec.label}（${key}）须为数字`;
      if (spec.kind === 'int' && !Number.isInteger(value)) return `${spec.label}（${key}）须为整数`;
      if (value < spec.min || value > spec.max) {
        return `${spec.label}（${key}）须在 ${spec.min}–${spec.max} 之间`;
      }
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `${spec.label}（${key}）须为是/否`;
    case 'enum':
      return typeof value === 'string' && spec.options.some((o) => o.value === value)
        ? null
        : `${spec.label}（${key}）取值无效`;
  }
}

export function validateParamPatch(
  schema: ParamSchema,
  patch: unknown,
): { ok: true; value: Record<string, ParamScalar> } | { ok: false; errors: string[] } {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, errors: ['参数须为对象'] };
  }
  const errors: string[] = [];
  const value: Record<string, ParamScalar> = {};
  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    const spec = schema[key];
    if (!spec) {
      errors.push(`未知参数 ${key}`);
      continue;
    }
    const err = checkParamValue(key, spec, raw);
    if (err) errors.push(err);
    else value[key] = raw as ParamScalar;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/core/param.test.ts`
Expected: `fail 0`

- [ ] **Step 5: 写失败测试 `resolve.test.ts`**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ParamSchema } from './param.js';
import { resolveParams, type ActiveParamSet } from './resolve.js';

const schema = {
  coverDays: { kind: 'int', label: '覆盖天数', default: 30, min: 7, max: 180 },
  linkage: { kind: 'boolean', label: '联动', default: true },
} satisfies ParamSchema;

const sets: ActiveParamSet[] = [
  { id: 'g', scopeType: 'global', scopeValue: '*', params: { coverDays: 40 }, version: 2 },
  { id: 'pg', scopeType: 'project_group', scopeValue: 'G1', params: { linkage: false }, version: 1 },
  { id: 'wh', scopeType: 'warehouse', scopeValue: 'UK', params: { coverDays: 60 }, version: 1 },
  { id: 'bad', scopeType: 'warehouse', scopeValue: 'DE', params: { coverDays: 999, removed: 1 }, version: 1 },
];

describe('resolveParams', () => {
  it('falls back to defaults with no sets', () => {
    const r = resolveParams(schema, [], {});
    assert.deepEqual(r.values, { coverDays: 30, linkage: true });
    assert.deepEqual(r.sources, { coverDays: 'default', linkage: 'default' });
    assert.deepEqual(r.paramSetIds, []);
  });
  it('more specific scope wins, per key', () => {
    const r = resolveParams(schema, sets, { projectGroup: 'G1', warehouse: 'UK' });
    assert.deepEqual(r.values, { coverDays: 60, linkage: false });
    assert.deepEqual(r.sources.coverDays, { scopeType: 'warehouse', scopeValue: 'UK', paramSetId: 'wh' });
    assert.deepEqual(r.paramSetIds.sort(), ['g', 'pg', 'wh']);
  });
  it('ignores sets of other scope values', () => {
    const r = resolveParams(schema, sets, { projectGroup: 'G2', warehouse: 'US-WEST' });
    assert.deepEqual(r.values, { coverDays: 40, linkage: true });
  });
  it('skips invalid and unknown keys', () => {
    const r = resolveParams(schema, sets, { warehouse: 'DE' });
    assert.equal(r.values.coverDays, 40);
  });
});
```

- [ ] **Step 6: 运行确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/core/resolve.test.ts`
Expected: FAIL

- [ ] **Step 7: 实现 `resolve.ts` 与 `define.ts`**

`resolve.ts`：

```ts
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
```

`define.ts`：

```ts
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
```

- [ ] **Step 8: 运行确认通过**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/core/param.test.ts server/rules/core/resolve.test.ts`
Expected: `fail 0`

- [ ] **Step 9: Commit**

```bash
git add apps/web/server/rules/core
git commit -m "feat(rules): param schema, layered resolver and module definition"
```

---

### Task 3: 备货规则模块（参数 + 纯函数判断）

**Files:**
- Create: `apps/web/server/rules/replenishment/params.ts`
- Create: `apps/web/server/rules/replenishment/qty.ts`
- Create: `apps/web/server/rules/replenishment/evaluate.ts`
- Create: `apps/web/server/rules/replenishment/index.ts`
- Create: `apps/web/server/rules/registry.ts`
- Test: `apps/web/server/rules/replenishment/qty.test.ts`、`apps/web/server/rules/replenishment/evaluate.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `ParamSchema`、`ParamValues`、`defineRuleModule`、`RuleTraceItem`
- Produces:
  ```ts
  // params.ts
  export const REPLENISHMENT_PARAMS: ParamSchema;          // 见 Step 1
  export type ReplenishmentParams = ParamValues<typeof REPLENISHMENT_PARAMS>;
  export const REPLENISHMENT_DEFAULTS: ReplenishmentParams;
  // qty.ts
  export function decideReplenishmentQty(input: {
    cumulativeDemandAtTarget: number; safetyStockQty: number; supplyAtTarget: number;
    coverQty?: number; moq?: number;
  }): number;
  // evaluate.ts
  export type MoqPriority = 'sku_then_spu' | 'spu_then_sku' | 'max';
  export function resolveMoqByPriority(skuMoq: number | null | undefined, spuMoq: number | null | undefined, priority: string): number;
  export function decideWarehouseCandidate(input: {
    coverageHealth: InventoryHealth; decisionHealth: InventoryHealth; deferredByUsNetwork: boolean;
    suggestedQty: number; moq: number;
  }): { include: boolean; qty: number; moqApplied: boolean; trace: RuleTraceItem[] };
  export function isUsDeferEnabled(params: Pick<ReplenishmentParams, 'usNetworkDeferEnabled'>): boolean;
  export function shouldReplenishWithLinkage(input: {
    replenishLight: ReplenishLight; needsReplenishment: boolean; spuHasRedNeedingReplenishment: boolean; yellowLightLinkage: boolean;
  }): boolean;
  // index.ts
  export const replenishmentRule: RuleModuleMeta<typeof REPLENISHMENT_PARAMS>;
  // registry.ts
  export const RULE_MODULES: ReadonlyArray<RuleModuleMeta<ParamSchema>>;
  export function getRuleModule(code: string): RuleModuleMeta<ParamSchema> | undefined;
  ```

- [ ] **Step 1: 写 `params.ts`**

```ts
import { defaultsOf, type ParamSchema, type ParamValues } from '../core/param.js';

export const REPLENISHMENT_PARAMS = {
  singleCoverDays: {
    kind: 'int',
    label: '单次补货覆盖天数',
    unit: '天',
    default: 30,
    min: 7,
    max: 180,
    help: '单次建议量不超过从今天起该天数的规划需求；有缺口时再按 MOQ 抬升',
  },
  defaultSafetyStockDays: {
    kind: 'int',
    label: '默认安全库存天数',
    unit: '天',
    default: 14,
    min: 0,
    max: 180,
    help: '安全库存配置未填天数时使用',
  },
  overstockThresholdDays: {
    kind: 'int',
    label: '超储阈值',
    unit: '天',
    default: 180,
    min: 30,
    max: 720,
    help: '确定覆盖天数超过该值且无建议量时判蓝灯',
  },
  slowMovingDailyMax: {
    kind: 'number',
    label: '滞销日均上限',
    unit: '件/天',
    default: 0.1,
    min: 0,
    max: 10,
    help: '日均不超过该值且覆盖达到滞销覆盖下限时判灰灯，不出建议',
  },
  slowMovingMinCoverageDays: {
    kind: 'int',
    label: '滞销覆盖下限',
    unit: '天',
    default: 90,
    min: 0,
    max: 720,
  },
  moqPriority: {
    kind: 'enum',
    label: 'MOQ 取值顺序',
    default: 'sku_then_spu',
    options: [
      { value: 'sku_then_spu', label: 'SKU 优先，其次 SPU' },
      { value: 'spu_then_sku', label: 'SPU 优先，其次 SKU' },
      { value: 'max', label: '取两者较大值' },
    ],
  },
  yellowLightLinkage: {
    kind: 'boolean',
    label: '黄灯联动',
    default: true,
    help: '开：补货灯黄灯 SKU 仅在同 SPU 有红灯 SKU 需补时才补；关：黄灯与红灯一样需要即补',
  },
  usNetworkDeferEnabled: {
    kind: 'boolean',
    label: 'US 仓网延后',
    default: true,
    help: '开：US 单仓低于 ROP 但仓网总量足够时延后补货',
  },
} satisfies ParamSchema;

export type ReplenishmentParams = ParamValues<typeof REPLENISHMENT_PARAMS>;

export const REPLENISHMENT_DEFAULTS: ReplenishmentParams = defaultsOf(REPLENISHMENT_PARAMS);
```

- [ ] **Step 2: 写失败测试 `qty.test.ts`**（与 `inventory-timeline.test.ts` 中 `calcSuggestedQtyFromTimeline` 的用例同口径）

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideReplenishmentQty } from './qty.js';

describe('decideReplenishmentQty', () => {
  it('gap = demand + safety − supply, ceil', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 100.2, safetyStockQty: 20, supplyAtTarget: 50 }),
      71,
    );
  });
  it('caps at coverQty before MOQ', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 500, safetyStockQty: 0, supplyAtTarget: 0, coverQty: 300 }),
      300,
    );
  });
  it('MOQ lifts after cap', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 500, safetyStockQty: 0, supplyAtTarget: 0, coverQty: 300, moq: 400 }),
      400,
    );
  });
  it('no gap → 0 even with MOQ', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 10, safetyStockQty: 0, supplyAtTarget: 50, moq: 400 }),
      0,
    );
  });
  it('coverQty 0 means no cap', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 500, safetyStockQty: 0, supplyAtTarget: 0, coverQty: 0 }),
      500,
    );
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/replenishment/qty.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现 `qty.ts`**

```ts
/**
 * 建议量 = max(0, ceil(目标日累计需求 + 安全库存 − 目标日供给))；
 * 有 coverQty（>0）时先封顶到该量，再按 MOQ 抬升；缺口为 0 不因 MOQ 出单。
 */
export function decideReplenishmentQty(input: {
  cumulativeDemandAtTarget: number;
  safetyStockQty: number;
  supplyAtTarget: number;
  coverQty?: number;
  moq?: number;
}): number {
  let raw = Math.max(
    0,
    Math.ceil(input.cumulativeDemandAtTarget + input.safetyStockQty - input.supplyAtTarget),
  );
  if (raw <= 0) return 0;
  const cover = input.coverQty ?? 0;
  if (cover > 0) raw = Math.min(raw, Math.ceil(cover));
  const moq = input.moq ?? 0;
  return moq > 0 ? Math.max(raw, moq) : raw;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/replenishment/qty.test.ts`
Expected: `fail 0`

- [ ] **Step 6: 写失败测试 `evaluate.test.ts`**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideWarehouseCandidate,
  resolveMoqByPriority,
  shouldReplenishWithLinkage,
} from './evaluate.js';

describe('resolveMoqByPriority', () => {
  it('sku_then_spu matches legacy resolveEffectiveMoq', () => {
    assert.equal(resolveMoqByPriority(50, 100, 'sku_then_spu'), 50);
    assert.equal(resolveMoqByPriority(0, 100, 'sku_then_spu'), 100);
    assert.equal(resolveMoqByPriority(null, null, 'sku_then_spu'), 0);
  });
  it('spu_then_sku and max', () => {
    assert.equal(resolveMoqByPriority(50, 100, 'spu_then_sku'), 100);
    assert.equal(resolveMoqByPriority(50, null, 'spu_then_sku'), 50);
    assert.equal(resolveMoqByPriority(50, 100, 'max'), 100);
  });
  it('unknown priority falls back to sku_then_spu', () => {
    assert.equal(resolveMoqByPriority(50, 100, 'zzz'), 50);
  });
});

describe('decideWarehouseCandidate', () => {
  const base = {
    coverageHealth: 'red' as const,
    decisionHealth: 'red' as const,
    deferredByUsNetwork: false,
    suggestedQty: 120,
    moq: 0,
  };
  it('gray coverage light → skip', () => {
    const r = decideWarehouseCandidate({ ...base, coverageHealth: 'gray' });
    assert.equal(r.include, false);
  });
  it('US deferred → skip', () => {
    assert.equal(decideWarehouseCandidate({ ...base, deferredByUsNetwork: true }).include, false);
  });
  it('green decision → skip', () => {
    assert.equal(decideWarehouseCandidate({ ...base, decisionHealth: 'green' }).include, false);
  });
  it('qty 0 → skip', () => {
    assert.equal(decideWarehouseCandidate({ ...base, suggestedQty: 0 }).include, false);
  });
  it('MOQ lifts and is reported', () => {
    const r = decideWarehouseCandidate({ ...base, moq: 200 });
    assert.deepEqual([r.include, r.qty, r.moqApplied], [true, 200, true]);
    assert.ok(r.trace.some((t) => t.rule === 'moq'));
  });
});

describe('shouldReplenishWithLinkage', () => {
  it('linkage on: yellow only with red in same SPU', () => {
    const input = { replenishLight: 'yellow' as const, needsReplenishment: true, yellowLightLinkage: true };
    assert.equal(shouldReplenishWithLinkage({ ...input, spuHasRedNeedingReplenishment: false }), false);
    assert.equal(shouldReplenishWithLinkage({ ...input, spuHasRedNeedingReplenishment: true }), true);
  });
  it('linkage off: yellow acts like red', () => {
    assert.equal(
      shouldReplenishWithLinkage({
        replenishLight: 'yellow',
        needsReplenishment: true,
        spuHasRedNeedingReplenishment: false,
        yellowLightLinkage: false,
      }),
      true,
    );
  });
  it('green never', () => {
    assert.equal(
      shouldReplenishWithLinkage({
        replenishLight: 'green',
        needsReplenishment: true,
        spuHasRedNeedingReplenishment: true,
        yellowLightLinkage: false,
      }),
      false,
    );
  });
});
```

- [ ] **Step 7: 运行确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/replenishment/evaluate.test.ts`
Expected: FAIL

- [ ] **Step 8: 实现 `evaluate.ts`、`index.ts`、`registry.ts`**

`evaluate.ts`：

```ts
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
```

若 `InventoryHealth` 不从 `replenishment-coverage.ts` 导出，改为从其定义处导入（`replenishmentForecast.ts` 第 14 行从 `../lib/replenishment-coverage.js` 导入，可直接沿用）。

`index.ts`：

```ts
import { defineRuleModule } from '../core/define.js';
import { REPLENISHMENT_PARAMS } from './params.js';

export const replenishmentRule = defineRuleModule({
  code: 'replenishment',
  name: '备货规则',
  description: '决定要不要下单、下多少、何时下单',
  version: 1,
  params: REPLENISHMENT_PARAMS,
  scopes: ['global', 'project_group', 'warehouse'],
});

export * from './params.js';
export * from './qty.js';
export * from './evaluate.js';
```

`registry.ts`：

```ts
import type { ParamSchema } from './core/param.js';
import type { RuleModuleMeta } from './core/define.js';
import { replenishmentRule } from './replenishment/index.js';

export const RULE_MODULES: ReadonlyArray<RuleModuleMeta<ParamSchema>> = [replenishmentRule];

export function getRuleModule(code: string): RuleModuleMeta<ParamSchema> | undefined {
  return RULE_MODULES.find((m) => m.code === code);
}
```

- [ ] **Step 9: 运行确认通过**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/replenishment/qty.test.ts server/rules/replenishment/evaluate.test.ts`
Expected: `fail 0`

- [ ] **Step 10: Commit**

```bash
git add apps/web/server/rules
git commit -m "feat(rules): replenishment rule module params and pure decisions"
```

---

### Task 4: 现有计算改为读规则函数与可传入参数（行为不变）

**Files:**
- Modify: `apps/web/server/lib/inventory-timeline.ts`
- Modify: `apps/web/server/lib/inventory-timeline-service.ts`
- Modify: `apps/web/server/lib/inventory-light.ts`
- Modify: `apps/web/server/lib/replenishment-coverage.ts`
- Modify: `apps/web/server/lib/safety-stock-z.ts`
- Modify: `apps/web/server/lib/safety-stock-suggestion-service.ts`
- Modify: `apps/web/server/lib/alert-action.ts`
- Modify: `apps/web/server/lib/inventory-health-service.ts`
- Test: `apps/web/server/lib/inventory-timeline.test.ts`（新增用例）

**Interfaces:**
- Consumes: `decideReplenishmentQty`、`REPLENISHMENT_DEFAULTS`
- Produces:
  - `projectDailyInventory(params & { coverDays?: number })`
  - `buildSkuWarehouseTimeline(params & { coverDays?: number })`、`buildSkuNetworkTimeline(params & { coverDays?: number })`、`assembleWarehouseTimeline(params & { coverDays?: number })`
  - `type SlowMovingThresholds = { maxDaily: number; minCoverageDays: number }`；`isSlowMovingStock(params & { thresholds?: SlowMovingThresholds })`、`calcTimelineDecisionHealth(params & { slowMoving?: SlowMovingThresholds })`
  - `resolvePlanningSafetyStock(params & { defaultSafetyStockDays?: number })`
  - `computeSkuWarehouseHealth(params & { ruleDefaults?: { safetyStockDays: number; overstockThresholdDays: number } })`

- [ ] **Step 1: 写失败测试（时间轴 coverDays）**

在 `server/lib/inventory-timeline.test.ts` 末尾追加：

```ts
describe('projectDailyInventory coverDays', () => {
  it('caps by custom coverDays instead of 30', () => {
    const r = projectDailyInventory({
      lots: [],
      today: '2026-10-26',
      totalLeadDays: 60,
      safetyStockDays: 0,
      safetyStockQty: 0,
      dailyDemandFn: () => 10,
      coverDays: 45,
    });
    assert.equal(r.suggestedQty, 450);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts`
Expected: FAIL（`suggestedQty` 为 300）

- [ ] **Step 3: 改 `inventory-timeline.ts`**

1. 顶部加 `import { decideReplenishmentQty } from '../rules/replenishment/qty.js';` 与 `import { REPLENISHMENT_DEFAULTS } from '../rules/replenishment/params.js';`。
2. `export const SINGLE_REPLENISHMENT_COVER_DAYS = 30;` 改为 `export const SINGLE_REPLENISHMENT_COVER_DAYS = REPLENISHMENT_DEFAULTS.singleCoverDays;`
3. `projectDailyInventory` 参数类型增加 `/** 单次补货覆盖天数，缺省为规则默认值 */ coverDays?: number;`，函数体开头加 `const coverDays = params.coverDays ?? SINGLE_REPLENISHMENT_COVER_DAYS;`，循环内 `if (k < SINGLE_REPLENISHMENT_COVER_DAYS)` 改为 `if (k < coverDays)`。
4. `calcSuggestedQtyFromTimeline` 函数体替换为委托：
   ```ts
   return decideReplenishmentQty({
     cumulativeDemandAtTarget: params.cumulativeDemandAtTarget,
     safetyStockQty: params.safetyStockQty,
     supplyAtTarget: params.projectedOverseasAtTarget,
     coverQty: params.maxCoverQty,
     moq: params.moq,
   });
   ```

- [ ] **Step 4: 改 `inventory-timeline-service.ts` 透传**

`assembleWarehouseTimeline`、`buildSkuWarehouseTimeline`、`buildSkuNetworkTimeline` 三个函数的参数类型都加 `coverDays?: number;`。四处 `projectDailyInventory({...})` 调用（主时间轴与 champion 影子各两处）都加一行 `coverDays: params.coverDays,`；`buildSkuWarehouseTimeline` 调 `assembleWarehouseTimeline` 时加 `coverDays: params.coverDays,`。

- [ ] **Step 5: 改 `inventory-light.ts` 滞销阈值**

```ts
import { REPLENISHMENT_DEFAULTS } from '../rules/replenishment/params.js';

export const SLOW_MOVING_MAX_DAILY = REPLENISHMENT_DEFAULTS.slowMovingDailyMax;
export const SLOW_MOVING_MIN_COVERAGE_DAYS = REPLENISHMENT_DEFAULTS.slowMovingMinCoverageDays;

export type SlowMovingThresholds = { maxDaily: number; minCoverageDays: number };

export function isSlowMovingStock(params: {
  effectiveQty: number;
  avgDaily: number;
  coverageDays: number;
  thresholds?: SlowMovingThresholds;
}): boolean {
  const maxDaily = params.thresholds?.maxDaily ?? SLOW_MOVING_MAX_DAILY;
  const minCoverage = params.thresholds?.minCoverageDays ?? SLOW_MOVING_MIN_COVERAGE_DAYS;
  if (params.effectiveQty <= 0) return false;
  if (params.avgDaily > maxDaily) return false;
  return Number.isFinite(params.coverageDays) && params.coverageDays >= minCoverage;
}
```

`calcTimelineDecisionHealth` 参数加 `slowMoving?: SlowMovingThresholds;`，内部 `isSlowMovingStock({...})` 调用加 `thresholds: params.slowMoving,`。

- [ ] **Step 6: 合并安全库存与超储默认常量**

- `replenishment-coverage.ts`：
  ```ts
  import { REPLENISHMENT_DEFAULTS } from '../rules/replenishment/params.js';
  export const DEFAULT_SAFETY_STOCK_DAYS = REPLENISHMENT_DEFAULTS.defaultSafetyStockDays;
  export const DEFAULT_OVERSTOCK_THRESHOLD_DAYS = REPLENISHMENT_DEFAULTS.overstockThresholdDays;
  ```
- `safety-stock-z.ts`：`export const DEFAULT_PLANNING_SAFETY_STOCK_DAYS = 14;` 改为 `export { DEFAULT_SAFETY_STOCK_DAYS as DEFAULT_PLANNING_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';`，文件内使用处改为 `import { DEFAULT_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';` 后引用 `DEFAULT_SAFETY_STOCK_DAYS`。`resolvePlanningSafetyStock` 参数加 `defaultSafetyStockDays?: number;`，第 107 行改为 `safetyStockDays: policy?.safetyStockDays ?? params.defaultSafetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS,`。
- `safety-stock-suggestion-service.ts`：`export const DEFAULT_CONFIGURED_SAFETY_STOCK_DAYS = 14;` 改为 `export { DEFAULT_SAFETY_STOCK_DAYS as DEFAULT_CONFIGURED_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';`，并在文件内引用处改用导入的 `DEFAULT_SAFETY_STOCK_DAYS`。
- `alert-action.ts`：删除 `const DEFAULT_ALERT_SAFETY_DAYS = 14;`，改为 `import { DEFAULT_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';`，第 41 行改为 `: DEFAULT_SAFETY_STOCK_DAYS;`。

若出现循环导入（`replenishment-coverage.ts` ↔ `inventory-light.ts`），`rules/replenishment/params.ts` 只依赖 `rules/core/param.ts`，不会成环；如 tsx 报 `Cannot access before initialization`，把上述 re-export 改为直接 `= 14` 字面量并加 `// 与 REPLENISHMENT_DEFAULTS 保持一致` 测试断言（见 Step 8）。

- [ ] **Step 7: `computeSkuWarehouseHealth` 加 `ruleDefaults`**

参数类型加：

```ts
  /** 规则中心解析出的默认值；未传时用代码默认值 */
  ruleDefaults?: { safetyStockDays: number; overstockThresholdDays: number };
```

第 547、549 行改为：

```ts
      safetyStockDays: policy?.safetyStockDays ?? params.ruleDefaults?.safetyStockDays ?? undefined,
      overstockThresholdDays:
        policy?.overstockThresholdDays ?? params.ruleDefaults?.overstockThresholdDays ?? undefined,
```

第 559 行 `resolvePlanningSafetyStock({` 调用内加 `defaultSafetyStockDays: params.ruleDefaults?.safetyStockDays,`。

- [ ] **Step 8: 加默认值一致性测试**

`apps/web/server/rules/replenishment/defaults-consistency.test.ts`：

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REPLENISHMENT_DEFAULTS } from './params.js';
import {
  DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
  DEFAULT_SAFETY_STOCK_DAYS,
} from '../../lib/replenishment-coverage.js';
import { SINGLE_REPLENISHMENT_COVER_DAYS } from '../../lib/inventory-timeline.js';
import { SLOW_MOVING_MAX_DAILY, SLOW_MOVING_MIN_COVERAGE_DAYS } from '../../lib/inventory-light.js';
import { DEFAULT_PLANNING_SAFETY_STOCK_DAYS } from '../../lib/safety-stock-z.js';

describe('replenishment defaults match legacy constants', () => {
  it('all equal', () => {
    assert.equal(REPLENISHMENT_DEFAULTS.singleCoverDays, 30);
    assert.equal(SINGLE_REPLENISHMENT_COVER_DAYS, 30);
    assert.equal(DEFAULT_SAFETY_STOCK_DAYS, 14);
    assert.equal(DEFAULT_PLANNING_SAFETY_STOCK_DAYS, 14);
    assert.equal(DEFAULT_OVERSTOCK_THRESHOLD_DAYS, 180);
    assert.equal(SLOW_MOVING_MAX_DAILY, 0.1);
    assert.equal(SLOW_MOVING_MIN_COVERAGE_DAYS, 90);
    assert.equal(REPLENISHMENT_DEFAULTS.moqPriority, 'sku_then_spu');
    assert.equal(REPLENISHMENT_DEFAULTS.yellowLightLinkage, true);
    assert.equal(REPLENISHMENT_DEFAULTS.usNetworkDeferEnabled, true);
  });
});
```

- [ ] **Step 9: 跑全部相关测试与类型检查**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts server/lib/replenishment-coverage.test.ts server/lib/network-replenishment.test.ts server/lib/inventory-health-service.test.ts server/lib/stock-alert-timeline.test.ts server/rules/replenishment/defaults-consistency.test.ts server/rules/replenishment/qty.test.ts`
Expected: `fail 0`

Run: `pnpm --filter @scm/web exec tsc --noEmit -p tsconfig.json`
Expected: 无新增报错

- [ ] **Step 10: 基线对照（默认参数下应无差异）**

Run: `pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts compare ../../.tmp-rules-baseline.json`
Expected: `与基线一致`

- [ ] **Step 11: Commit**

```bash
git add apps/web/server/lib apps/web/server/rules
git commit -m "refactor(planning): route replenishment qty and defaults through rule module"
```

---

### Task 5: 参数集数据表与迁移

**Files:**
- Create: `packages/db/src/schema/rules.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0123_rule_param_sets.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: drizzle 表对象 `ruleParamSets`、`ruleEvalRuns`（从 `@scm/db` 导出）

- [ ] **Step 1: 写 schema**

`packages/db/src/schema/rules.ts`：

```ts
import { pgTable, uuid, varchar, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './auth';

/** 规则参数集。params 只存该作用范围覆盖的键，未出现的键向上继承。 */
export const ruleParamSets = pgTable(
  'rule_param_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    moduleCode: varchar('module_code', { length: 50 }).notNull(),
    scopeType: varchar('scope_type', { length: 20 }).notNull(),
    scopeValue: varchar('scope_value', { length: 100 }).notNull(),
    params: jsonb('params').notNull(),
    version: integer('version').notNull(),
    /** draft / pending_approval / active / archived */
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    note: text('note'),
    reviewNote: text('review_note'),
    simulatedAt: timestamp('simulated_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    moduleScopeIdx: index('rule_param_sets_module_scope_idx').on(
      table.moduleCode,
      table.scopeType,
      table.scopeValue,
    ),
  }),
);

/** 每次规则评估一行；建议 / 预警只存 run id。 */
export const ruleEvalRuns = pgTable('rule_eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  moduleCode: varchar('module_code', { length: 50 }).notNull(),
  /** task / simulation / page */
  trigger: varchar('trigger', { length: 20 }).notNull(),
  moduleVersion: integer('module_version').notNull(),
  paramSetIds: jsonb('param_set_ids').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
```

`packages/db/src/schema/index.ts` 末尾加 `export * from './rules';`

- [ ] **Step 2: 写迁移 SQL**

`packages/db/drizzle/0123_rule_param_sets.sql`：

```sql
CREATE TABLE IF NOT EXISTS "rule_param_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "module_code" varchar(50) NOT NULL,
  "scope_type" varchar(20) NOT NULL,
  "scope_value" varchar(100) NOT NULL,
  "params" jsonb NOT NULL,
  "version" integer NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "note" text,
  "review_note" text,
  "simulated_at" timestamptz,
  "created_by" uuid REFERENCES "users"("id"),
  "approved_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamptz,
  "activated_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "rule_param_sets_module_scope_idx"
  ON "rule_param_sets" ("module_code", "scope_type", "scope_value");

CREATE UNIQUE INDEX IF NOT EXISTS "rule_param_sets_one_active_idx"
  ON "rule_param_sets" ("module_code", "scope_type", "scope_value")
  WHERE "status" = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS "rule_param_sets_version_idx"
  ON "rule_param_sets" ("module_code", "scope_type", "scope_value", "version");

CREATE TABLE IF NOT EXISTS "rule_eval_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "module_code" varchar(50) NOT NULL,
  "trigger" varchar(20) NOT NULL,
  "module_version" integer NOT NULL,
  "param_set_ids" jsonb NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "finished_at" timestamptz
);
```

- [ ] **Step 3: 登记 journal**

在 `packages/db/drizzle/meta/_journal.json` 的 `entries` 数组末尾（`0122_drop_procurement_costing_menu` 之后）追加：

```json
    {
      "idx": 104,
      "version": "6",
      "when": 1787573600000,
      "tag": "0123_rule_param_sets",
      "breakpoints": true
    }
```

- [ ] **Step 4: 本地迁移验证**

Run: `pnpm db:migrate`
Expected: 成功；`psql` 中 `\d rule_param_sets` 可见部分唯一索引 `rule_param_sets_one_active_idx`。

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/rules.ts packages/db/src/schema/index.ts packages/db/drizzle/0123_rule_param_sets.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): rule_param_sets and rule_eval_runs"
```

---

### Task 6: 参数存储服务与补货任务接入

**Files:**
- Create: `apps/web/server/rules/core/store.ts`
- Modify: `apps/web/server/tasks/replenishmentForecast.ts`
- Test: `apps/web/server/rules/core/store.test.ts`

**Interfaces:**
- Consumes: Task 2 `resolveParams`、Task 3 `REPLENISHMENT_PARAMS` 等、Task 4 新入参、Task 5 表
- Produces:
  ```ts
  // store.ts
  export async function loadActiveParamSets(moduleCode: string): Promise<ActiveParamSet[]>;
  export function createParamsResolver<S extends ParamSchema>(schema: S, sets: ActiveParamSet[]):
    (ctx: RuleScopeContext) => ResolvedParams<S>;
  export async function startRuleRun(input: { moduleCode: string; trigger: 'task' | 'simulation' | 'page'; moduleVersion: number; paramSetIds: string[] }): Promise<string>;
  export async function finishRuleRun(id: string): Promise<void>;
  // replenishmentForecast.ts
  export type ReplenishmentRunOptions = {
    dryRun?: boolean;
    skuIds?: string[];
    /** 试算用：替代数据库 active 参数集 */
    paramSets?: ActiveParamSet[];
    trigger?: 'task' | 'simulation';
  };
  ```

- [ ] **Step 1: 写失败测试 `store.test.ts`（只测纯函数部分）**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createParamsResolver } from './store.js';
import { REPLENISHMENT_PARAMS } from '../replenishment/params.js';

describe('createParamsResolver', () => {
  it('memoizes per scope key and resolves layered values', () => {
    const resolve = createParamsResolver(REPLENISHMENT_PARAMS, [
      { id: 'g', scopeType: 'global', scopeValue: '*', params: { singleCoverDays: 40 }, version: 1 },
      { id: 'w', scopeType: 'warehouse', scopeValue: 'UK', params: { singleCoverDays: 60 }, version: 1 },
    ]);
    const a = resolve({ warehouse: 'UK' });
    const b = resolve({ warehouse: 'UK' });
    assert.equal(a, b);
    assert.equal(a.values.singleCoverDays, 60);
    assert.equal(resolve({ warehouse: 'US-WEST' }).values.singleCoverDays, 40);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/core/store.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `store.ts`**

```ts
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
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/core/store.test.ts`
Expected: `fail 0`

- [ ] **Step 5: 补货任务接入参数**

在 `replenishmentForecast.ts`：

1. 导入：
   ```ts
   import { createParamsResolver, finishRuleRun, loadActiveParamSets, startRuleRun } from '../rules/core/store.js';
   import type { ActiveParamSet } from '../rules/core/resolve.js';
   import {
     REPLENISHMENT_PARAMS,
     decideWarehouseCandidate,
     resolveMoqByPriority,
     shouldReplenishWithLinkage,
     replenishmentRule,
   } from '../rules/replenishment/index.js';
   ```
   删除不再使用的 `applyMoq`、`resolveEffectiveMoq`、`shouldReplenishByLight` 导入。
2. `ReplenishmentRunOptions` 增加 `paramSets?: ActiveParamSet[]; trigger?: 'task' | 'simulation';`。
3. `activeSkus` 查询的 select 增加 `projectGroup: skus.projectGroup,`。
4. 在 `const skuIds = ...` 之后：
   ```ts
   const paramSets = options.paramSets ?? (await loadActiveParamSets(replenishmentRule.code));
   const resolveRuleParams = createParamsResolver(REPLENISHMENT_PARAMS, paramSets);
   const usedParamSetIds = new Set<string>();
   ```
5. SKU 循环开头，`effectiveMoq` 计算替换为：
   ```ts
   const skuParams = resolveRuleParams({ projectGroup: sku.projectGroup });
   skuParams.paramSetIds.forEach((id) => usedParamSetIds.add(id));
   const effectiveMoq = resolveMoqByPriority(
     sku.moq,
     sku.spuId ? spuMoqMap.get(sku.spuId) : null,
     skuParams.values.moqPriority,
   );
   ```
6. 第一个仓循环（健康度）内，在 `computeSkuWarehouseHealth` 之前：
   ```ts
   const whParams = resolveRuleParams({ projectGroup: sku.projectGroup, warehouse: wh.code });
   whParams.paramSetIds.forEach((id) => usedParamSetIds.add(id));
   ```
   调用加 `ruleDefaults: { safetyStockDays: whParams.values.defaultSafetyStockDays, overstockThresholdDays: whParams.values.overstockThresholdDays },`。
7. 第二个仓循环（候选）开头同样取 `whParams`（复用解析器，命中缓存）。然后：
   - `if (wh.regionGroup === 'US') {` 改为 `if (wh.regionGroup === 'US' && whParams.values.usNetworkDeferEnabled) {`。
   - `buildSkuWarehouseTimeline({...})` 加 `coverDays: whParams.values.singleCoverDays,`。
   - `calcTimelineDecisionHealth({...})` 中 `overstockThresholdDays:` 的回退改为 `health.coverage.overstockThresholdDays ?? whParams.values.overstockThresholdDays`，并加 `slowMoving: { maxDaily: whParams.values.slowMovingDailyMax, minCoverageDays: whParams.values.slowMovingMinCoverageDays },`。
   - 原来的三行 `if (deferUs) continue; if (!needsReplenishmentByHealth(decisionHealth)) continue; if (suggestedQty <= 0) continue;` 以及 `const rawQty = suggestedQty; suggestedQty = applyMoq(suggestedQty, effectiveMoq);` 替换为：
     ```ts
     const candidate = decideWarehouseCandidate({
       coverageHealth: coverageHealthStatus,
       decisionHealth,
       deferredByUsNetwork: deferUs,
       suggestedQty,
       moq: effectiveMoq,
     });
     health.metrics.ruleTrace = candidate.trace;
     if (!candidate.include) continue;
     const rawQty = suggestedQty;
     suggestedQty = candidate.qty;
     ```
     灰灯必须保持在计算时间轴**之前**跳过（否则灰灯行会多跑一次时间轴、改写 `health.metrics.timeline*` 与 `health.healthStatus`，健康快照不再一致）。把原有的 `if (coverageHealthStatus === 'gray') { continue; }` 改为补写判断依据后再跳过：
     ```ts
     if (coverageHealthStatus === 'gray') {
       health.metrics.ruleTrace = decideWarehouseCandidate({
         coverageHealth: 'gray',
         decisionHealth: 'gray',
         deferredByUsNetwork: false,
         suggestedQty: 0,
         moq: 0,
       }).trace;
       continue;
     }
     ```
   - `skuCandidates.push({... metrics: {...}})` 的 `metrics` 中加 `ruleTrace: candidate.trace,`。
8. 网络时间轴段：`policyRows.reduce(...)` 中两处 `DEFAULT_SAFETY_STOCK_DAYS` 改为 `skuParams.values.defaultSafetyStockDays`；`buildSkuNetworkTimeline({...})` 加 `coverDays: skuParams.values.singleCoverDays,`。
9. `eligibleItems` 过滤改为：
   ```ts
   const linkageBySku = new Map(
     activeSkus.map((sku) => [sku.id, resolveRuleParams({ projectGroup: sku.projectGroup }).values.yellowLightLinkage]),
   );
   const eligibleItems = pending.filter((item) =>
     shouldReplenishWithLinkage({
       replenishLight: item.replenishLight,
       needsReplenishment: true,
       spuHasRedNeedingReplenishment: item.spuId ? spuRedNeeding.has(item.spuId) : false,
       yellowLightLinkage: linkageBySku.get(item.skuId) ?? true,
     }),
   );
   ```
10. run 记录：在 dry-run 提前返回之前、非 dry-run 分支里：
    ```ts
    const ruleRunId = dryRun
      ? null
      : await startRuleRun({
          moduleCode: replenishmentRule.code,
          trigger: options.trigger ?? 'task',
          moduleVersion: replenishmentRule.version,
          paramSetIds: [...usedParamSetIds],
        });
    ```
    `db.insert(reorderSuggestions).values({... metrics: item.metrics ...})` 改为 `metrics: { ...item.metrics, ruleRunId },`；函数返回前 `if (ruleRunId) await finishRuleRun(ruleRunId);`。
11. 删除 `DEFAULT_SAFETY_STOCK_DAYS` 导入（若已无引用）；`DEFAULT_OVERSTOCK_THRESHOLD_DAYS` 同理。

- [ ] **Step 6: 跑测试、类型检查、基线对照**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/core/store.test.ts server/rules/replenishment/evaluate.test.ts server/lib/network-replenishment.test.ts`
Expected: `fail 0`

Run: `pnpm --filter @scm/web exec tsc --noEmit -p tsconfig.json`
Expected: 无新增报错

Run: `pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts compare ../../.tmp-rules-baseline.json`
Expected: `与基线一致`（数据库无参数集）

- [ ] **Step 7: 参数生效冒烟**

在本地库插入一条全局参数集，验证结果变化后删除：

```sql
INSERT INTO rule_param_sets (module_code, scope_type, scope_value, params, version, status)
VALUES ('replenishment', 'global', '*', '{"singleCoverDays": 60}', 1, 'active');
```

Run: `pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts compare ../../.tmp-rules-baseline.json`
Expected: exit 1，差异集中在 `suggestedQty` 增大的行。

```sql
DELETE FROM rule_param_sets WHERE module_code = 'replenishment' AND version = 1 AND scope_type = 'global';
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/server/rules/core/store.ts apps/web/server/rules/core/store.test.ts apps/web/server/tasks/replenishmentForecast.ts
git commit -m "feat(replenishment): resolve rule params per scope and record rule runs"
```

---

### Task 7: SKU 规划页与补货任务同源

**Files:**
- Modify: `apps/web/server/lib/inventory-planning-service.ts`

**Interfaces:**
- Consumes: `loadActiveParamSets`、`createParamsResolver`、`resolveMoqByPriority`、`REPLENISHMENT_PARAMS`、Task 4 新入参

- [ ] **Step 1: 加载解析器**

文件顶部导入：

```ts
import { createParamsResolver, loadActiveParamSets } from '../rules/core/store.js';
import { REPLENISHMENT_PARAMS, replenishmentRule, resolveMoqByPriority } from '../rules/replenishment/index.js';
```

`getSkuNetworkPlanningView` 与 `getSkuPlanningView` 中加载 SKU 的 select 都加 `projectGroup: skus.projectGroup,`（找到各自 `db.select({...}).from(skus)` 处）。两个函数开头（SKU 查到之后）各加：

```ts
const resolveRuleParams = createParamsResolver(
  REPLENISHMENT_PARAMS,
  await loadActiveParamSets(replenishmentRule.code),
);
```

- [ ] **Step 2: 网络视图（`getSkuNetworkPlanningView`）**

```ts
const ruleParams = resolveRuleParams({ projectGroup: sku.projectGroup }).values;
```

- 第 481–482 行两处 `DEFAULT_SAFETY_STOCK_DAYS` → `ruleParams.defaultSafetyStockDays`。
- 第 570 行 `moq: sku.skuMoq || sku.spuMoq || undefined,` → `moq: resolveMoqByPriority(sku.skuMoq, sku.spuMoq, ruleParams.moqPriority) || undefined,`，并在 `buildSkuNetworkTimeline({...})` 加 `coverDays: ruleParams.singleCoverDays,`。
- 第 618、644 行 `DEFAULT_OVERSTOCK_THRESHOLD_DAYS` → `ruleParams.overstockThresholdDays`；第 614 行 `calcTimelineDecisionHealth({...})` 加 `slowMoving: { maxDaily: ruleParams.slowMovingDailyMax, minCoverageDays: ruleParams.slowMovingMinCoverageDays },`。

- [ ] **Step 3: 分仓视图（`getSkuPlanningView`）**

```ts
const ruleParams = resolveRuleParams({ projectGroup: sku.projectGroup, warehouse: warehouse.code }).values;
```

- 第 755 行 `computeSkuWarehouseHealth({...})` 加 `ruleDefaults: { safetyStockDays: ruleParams.defaultSafetyStockDays, overstockThresholdDays: ruleParams.overstockThresholdDays },`；第 772 行 `moq` 同 Step 2 写法。
- 第 784 行 `buildSkuWarehouseTimeline({...})` 加 `coverDays: ruleParams.singleCoverDays,`，第 792 行 `moq` 同上。
- `buildSkuPlanningView` 第 306 行的 `calcTimelineDecisionHealth` 由该函数的入参决定；给 `buildSkuPlanningView` 的 `input` 类型加 `ruleParams?: { overstockThresholdDays: number; slowMovingDailyMax: number; slowMovingMinCoverageDays: number }`，第 311 行回退改为 `?? input.ruleParams?.overstockThresholdDays ?? DEFAULT_OVERSTOCK_THRESHOLD_DAYS`，并加 `slowMoving: input.ruleParams ? { maxDaily: input.ruleParams.slowMovingDailyMax, minCoverageDays: input.ruleParams.slowMovingMinCoverageDays } : undefined,`。两个视图调用 `buildSkuPlanningView({...})` 时传 `ruleParams`。

- [ ] **Step 4: 测试与类型检查**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-planning-service.test.ts`（文件存在时）及 `server/lib/inventory-timeline.test.ts`
Expected: `fail 0`

Run: `pnpm --filter @scm/web exec tsc --noEmit -p tsconfig.json`
Expected: 无新增报错

- [ ] **Step 5: 手工核对**

本地启动 `pnpm dev`，打开 3 个有建议的 SKU 的规划页（网络视图 + 一个分仓视图），建议量、决策灯、断货日与 `.tmp-rules-baseline.json` 中对应行一致。

- [ ] **Step 6: Commit**

```bash
git add apps/web/server/lib/inventory-planning-service.ts
git commit -m "feat(planning): sku planning view uses resolved replenishment params"
```

---

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

### Task 9: 规则中心页面与菜单

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/pages/RuleCenterPage.tsx`
- Modify: `apps/web/src/router.tsx`
- Create: `packages/db/drizzle/0124_rule_center_menu.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: Task 8 API
- Produces: 路由 `/system/rules`，菜单 code `system.rules`

- [ ] **Step 1: 前端类型与 API**

`apps/web/src/lib/api.ts`，在类型区加：

```ts
export type RuleParamSpec =
  | { kind: 'int' | 'number'; label: string; unit?: string; default: number; min: number; max: number; help?: string }
  | { kind: 'boolean'; label: string; default: boolean; help?: string }
  | { kind: 'enum'; label: string; default: string; options: Array<{ value: string; label: string }>; help?: string };

export type RuleModuleView = {
  code: string;
  name: string;
  description: string;
  version: number;
  scopes: string[];
  params: Record<string, RuleParamSpec>;
};

export type RuleParamSetStatus = 'draft' | 'pending_approval' | 'active' | 'archived';

export type RuleParamSetView = {
  id: string;
  moduleCode: string;
  scopeType: string;
  scopeValue: string;
  params: Record<string, number | boolean | string>;
  version: number;
  status: RuleParamSetStatus;
  note: string | null;
  reviewNote: string | null;
  simulatedAt: string | null;
  updatedAt: string;
};

export type RuleSimulationRow = {
  skuCode: string;
  warehouseCode: string;
  before: { suggestedQty: number; suggestedDate: string; healthStatus: string } | null;
  after: { suggestedQty: number; suggestedDate: string; healthStatus: string } | null;
};
```

在 `export const api = {` 对象内加：

```ts
  getRuleModules: () => request<{ items: RuleModuleView[] }>('/api/rules'),
  getRuleParamSets: (module: string) =>
    request<{ items: RuleParamSetView[] }>(`/api/rules/${module}/param-sets`),
  createRuleParamSet: (
    module: string,
    data: { scopeType: string; scopeValue?: string; params: Record<string, unknown>; note: string },
  ) =>
    request<RuleParamSetView>(`/api/rules/${module}/param-sets`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRuleParamSet: (module: string, id: string, data: { params?: Record<string, unknown>; note?: string }) =>
    request<RuleParamSetView>(`/api/rules/${module}/param-sets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  simulateRuleParamSet: (module: string, id: string, data: { skuCodes?: string[]; projectGroup?: string }) =>
    request<{ rows: RuleSimulationRow[]; changed: number; total: number; skuCount: number; maxSkus: number }>(
      `/api/rules/${module}/param-sets/${id}/simulate`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
  ruleParamSetAction: (
    module: string,
    id: string,
    action: 'submit' | 'approve' | 'reject' | 'restore',
    data?: { reviewNote?: string },
  ) =>
    request<RuleParamSetView>(`/api/rules/${module}/param-sets/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    }),
```

若 `request` 未自动带 `content-type: application/json`，参照 `register` 写法补 `headers`。

- [ ] **Step 2: 页面 `RuleCenterPage.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type RuleModuleView,
  type RuleParamSetStatus,
  type RuleParamSetView,
  type RuleParamSpec,
  type RuleSimulationRow,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { useCurrentUser } from '@/hooks/useAuth';
import { cn, formatDateTimeCst } from '@/lib/utils';

const STATUS_LABEL: Record<RuleParamSetStatus, string> = {
  draft: '草稿',
  pending_approval: '待审批',
  active: '生效中',
  archived: '已归档',
};

const SCOPE_LABEL: Record<string, string> = {
  global: '全局',
  project_group: '项目组',
  category: '品类',
  warehouse: '仓库',
  sku: 'SKU',
};

function scopeText(set: Pick<RuleParamSetView, 'scopeType' | 'scopeValue'>): string {
  return set.scopeType === 'global' ? '全局' : `${SCOPE_LABEL[set.scopeType] ?? set.scopeType}：${set.scopeValue}`;
}

function formatValue(spec: RuleParamSpec, value: unknown): string {
  if (value === undefined) return '—';
  if (spec.kind === 'boolean') return value ? '开' : '关';
  if (spec.kind === 'enum') return spec.options.find((o) => o.value === value)?.label ?? String(value);
  return `${value}${spec.unit ? ` ${spec.unit}` : ''}`;
}

function ParamInput(props: { spec: RuleParamSpec; value: unknown; onChange: (v: unknown) => void }) {
  const { spec, value, onChange } = props;
  if (spec.kind === 'boolean') {
    return (
      <select
        className="h-8 rounded border px-2 text-sm"
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
      >
        <option value="">不覆盖</option>
        <option value="true">开</option>
        <option value="false">关</option>
      </select>
    );
  }
  if (spec.kind === 'enum') {
    return (
      <select
        className="h-8 rounded border px-2 text-sm"
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      >
        <option value="">不覆盖</option>
        {spec.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Input
      className="h-8 w-28"
      type="number"
      step={spec.kind === 'int' ? 1 : 0.01}
      min={spec.min}
      max={spec.max}
      placeholder="不覆盖"
      value={value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

function DraftEditor(props: {
  module: RuleModuleView;
  canEdit: boolean;
  onCreated: () => void;
}) {
  const { module, canEdit, onCreated } = props;
  const [scopeType, setScopeType] = useState(module.scopes[0] ?? 'global');
  const [scopeValue, setScopeValue] = useState('');
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.createRuleParamSet(module.code, {
        scopeType,
        scopeValue: scopeType === 'global' ? undefined : scopeValue,
        params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)),
        note,
      }),
    onSuccess: () => {
      setParams({});
      setNote('');
      setError(null);
      onCreated();
    },
    onError: (err: Error) => setError(err.message),
  });
  if (!canEdit) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">新建草稿</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span>作用范围</span>
          <select
            className="h-8 rounded border px-2"
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value)}
          >
            {module.scopes.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s] ?? s}
              </option>
            ))}
          </select>
          {scopeType !== 'global' && (
            <Input
              className="h-8 w-40"
              placeholder={scopeType === 'warehouse' ? '仓码，如 UK' : '项目组编码'}
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
            />
          )}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {Object.entries(module.params).map(([key, spec]) => (
            <label key={key} className="flex items-center justify-between gap-2 rounded border px-3 py-2">
              <span title={spec.help}>
                {spec.label}
                <span className="ml-1 text-xs text-muted-foreground">默认 {formatValue(spec, spec.default)}</span>
              </span>
              <ParamInput
                spec={spec}
                value={params[key]}
                onChange={(v) => setParams((prev) => ({ ...prev, [key]: v }))}
              />
            </label>
          ))}
        </div>
        <Input placeholder="修改说明（必填）" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          保存草稿
        </Button>
      </CardContent>
    </Card>
  );
}

function SimulationPanel(props: { module: RuleModuleView; set: RuleParamSetView; onDone: () => void }) {
  const [skuText, setSkuText] = useState('');
  const [projectGroup, setProjectGroup] = useState('');
  const [rows, setRows] = useState<RuleSimulationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () =>
      api.simulateRuleParamSet(props.module.code, props.set.id, {
        skuCodes: skuText.split(/[\s,，]+/).filter(Boolean),
        projectGroup: projectGroup || undefined,
      }),
    onSuccess: (data) => {
      setRows(data.rows);
      setError(null);
      props.onDone();
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <div className="mt-2 space-y-2 rounded border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Input
          className="h-8 w-72"
          placeholder="SKU 编码，逗号或空格分隔（最多 50 个）"
          value={skuText}
          onChange={(e) => setSkuText(e.target.value)}
        />
        <Input
          className="h-8 w-40"
          placeholder="或项目组"
          value={projectGroup}
          onChange={(e) => setProjectGroup(e.target.value)}
        />
        <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? '试算中…' : '试算'}
        </Button>
      </div>
      {error && <p className="text-destructive">{error}</p>}
      {rows && rows.length === 0 && <p>与当前生效参数相比，建议无变化。</p>}
      {rows && rows.length > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1">SKU</th>
              <th>仓</th>
              <th>当前建议量</th>
              <th>草稿建议量</th>
              <th>当前灯</th>
              <th>草稿灯</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.skuCode}-${r.warehouseCode}`} className="border-t">
                <td className="py-1">{r.skuCode}</td>
                <td>{r.warehouseCode === 'NETWORK' ? '网络' : r.warehouseCode}</td>
                <td>{r.before?.suggestedQty ?? '不建议'}</td>
                <td>{r.after?.suggestedQty ?? '不建议'}</td>
                <td>{r.before?.healthStatus ?? '—'}</td>
                <td>{r.after?.healthStatus ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ParamSetList(props: {
  module: RuleModuleView;
  sets: RuleParamSetView[];
  canEdit: boolean;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const { module, sets, canEdit, isAdmin, onChanged } = props;
  const [openSim, setOpenSim] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const action = useMutation({
    mutationFn: (input: { id: string; action: 'submit' | 'approve' | 'reject' | 'restore'; reviewNote?: string }) =>
      api.ruleParamSetAction(module.code, input.id, input.action, { reviewNote: input.reviewNote }),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">参数集</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <p className="text-destructive">{error}</p>}
        {sets.length === 0 && <p className="text-muted-foreground">暂无参数集，全部使用默认值。</p>}
        {sets.map((set) => (
          <div key={set.id} className="rounded border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{scopeText(set)}</span>
              <span className="text-muted-foreground">v{set.version}</span>
              <span
                className={cn(
                  'rounded px-2 py-0.5 text-xs',
                  set.status === 'active' && 'bg-green-100 text-green-700',
                  set.status === 'pending_approval' && 'bg-orange-100 text-orange-700',
                  set.status === 'draft' && 'bg-muted',
                  set.status === 'archived' && 'text-muted-foreground',
                )}
              >
                {STATUS_LABEL[set.status]}
              </span>
              <span className="text-xs text-muted-foreground">{formatDateTimeCst(set.updatedAt)}</span>
              <span className="ml-auto flex gap-2">
                {canEdit && set.status === 'draft' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setOpenSim(openSim === set.id ? null : set.id)}>
                      试算
                    </Button>
                    <Button
                      size="sm"
                      disabled={!set.simulatedAt || action.isPending}
                      title={set.simulatedAt ? undefined : '请先试算'}
                      onClick={() => action.mutate({ id: set.id, action: 'submit' })}
                    >
                      提交审批
                    </Button>
                  </>
                )}
                {isAdmin && set.status === 'pending_approval' && (
                  <>
                    <Button size="sm" onClick={() => action.mutate({ id: set.id, action: 'approve' })}>
                      审批生效
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const reviewNote = window.prompt('驳回原因');
                        if (reviewNote) action.mutate({ id: set.id, action: 'reject', reviewNote });
                      }}
                    >
                      驳回
                    </Button>
                  </>
                )}
                {canEdit && set.status === 'archived' && (
                  <Button size="sm" variant="outline" onClick={() => action.mutate({ id: set.id, action: 'restore' })}>
                    恢复为草稿
                  </Button>
                )}
              </span>
            </div>
            <ul className="mt-2 grid gap-1 md:grid-cols-2">
              {Object.entries(set.params).map(([key, value]) => {
                const spec = module.params[key];
                return (
                  <li key={key}>
                    {spec ? spec.label : `${key}（已废弃）`}：{spec ? formatValue(spec, value) : String(value)}
                  </li>
                );
              })}
            </ul>
            {set.note && <p className="mt-1 text-xs text-muted-foreground">说明：{set.note}</p>}
            {set.reviewNote && <p className="mt-1 text-xs text-destructive">驳回原因：{set.reviewNote}</p>}
            {openSim === set.id && <SimulationPanel module={module} set={set} onDone={onChanged} />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EffectiveTable(props: { module: RuleModuleView; sets: RuleParamSetView[] }) {
  const active = props.sets.filter((s) => s.status === 'active');
  const global = active.find((s) => s.scopeType === 'global');
  const overrides = active.filter((s) => s.scopeType !== 'global');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">当前生效参数</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1">参数</th>
              <th>默认值</th>
              <th>全局</th>
              <th>覆盖</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(props.module.params).map(([key, spec]) => (
              <tr key={key} className="border-t">
                <td className="py-1" title={spec.help}>
                  {spec.label}
                </td>
                <td>{formatValue(spec, spec.default)}</td>
                <td>{global && key in global.params ? formatValue(spec, global.params[key]) : '—'}</td>
                <td>
                  {overrides
                    .filter((s) => key in s.params)
                    .map((s) => `${scopeText(s)} = ${formatValue(spec, s.params[key])}`)
                    .join('；') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function RuleCenterPage() {
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const roleCode = user?.role.code ?? '';
  const isAdmin = roleCode === 'super_admin';
  const canEdit = isAdmin || roleCode === 'pmc_planner';
  const modulesQuery = useQuery({ queryKey: ['rule-modules'], queryFn: api.getRuleModules });
  const modules = modulesQuery.data?.items ?? [];
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const module = useMemo(
    () => modules.find((m) => m.code === activeCode) ?? modules[0],
    [modules, activeCode],
  );
  const setsQuery = useQuery({
    queryKey: ['rule-param-sets', module?.code],
    queryFn: () => api.getRuleParamSets(module!.code),
    enabled: Boolean(module),
  });
  const sets = setsQuery.data?.items ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rule-param-sets', module?.code] });

  return (
    <div className="space-y-4">
      <PageHeader title="规则中心" description="按模块管理供应链规则参数；草稿需试算并经管理员审批后生效" />
      <div className="flex gap-2 border-b">
        {modules.map((m) => (
          <button
            key={m.code}
            type="button"
            className={cn(
              'border-b-2 px-3 py-2 text-sm',
              m.code === module?.code ? 'border-primary font-medium' : 'border-transparent text-muted-foreground',
            )}
            onClick={() => setActiveCode(m.code)}
          >
            {m.name}
          </button>
        ))}
      </div>
      {module && (
        <>
          <p className="text-sm text-muted-foreground">{module.description}</p>
          <EffectiveTable module={module} sets={sets} />
          <DraftEditor module={module} canEdit={canEdit} onCreated={refresh} />
          <ParamSetList module={module} sets={sets} canEdit={canEdit} isAdmin={isAdmin} onChanged={refresh} />
        </>
      )}
    </div>
  );
}
```

`PageHeader` 的 props 名以 `apps/web/src/components/PageHeader.tsx` 实际定义为准（若无 `description` 则去掉）；`Button` 的 `size` / `variant` 取值以 `components/ui/button.tsx` 为准。样式遵循 `scm-design` Skill。

- [ ] **Step 3: 路由**

`apps/web/src/router.tsx`：加 `import { RuleCenterPage } from '@/pages/RuleCenterPage';`，在 `<Route path="system/tasks" element={<SystemTasksPage />} />` 之后加 `<Route path="system/rules" element={<RuleCenterPage />} />`。

- [ ] **Step 4: 菜单迁移**

`packages/db/drizzle/0124_rule_center_menu.sql`：

```sql
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '规则中心', 'system.rules', 'SlidersHorizontal', '/system/rules',
       (SELECT id FROM menus WHERE code = 'system' LIMIT 1), 5, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'system.rules');

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
JOIN menus m ON m.code IN ('system', 'system.rules')
WHERE r.code IN ('super_admin', 'pmc_planner', 'viewer')
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
```

注意：授予 `pmc_planner`、`viewer` 父菜单 `system` 会让其看到「系统设置」分组；分组下其余菜单仍受各自 role_menus 控制。若前端菜单渲染要求父子同时授权才显示，以上写法已满足。若 `SlidersHorizontal` 不在前端图标映射中（检查菜单图标映射文件），改用 `Settings`。

`_journal.json` 追加：

```json
    {
      "idx": 105,
      "version": "6",
      "when": 1787573700000,
      "tag": "0124_rule_center_menu",
      "breakpoints": true
    }
```

- [ ] **Step 5: 构建与页面冒烟**

Run: `pnpm db:migrate`，然后 `pnpm build`
Expected: 均成功

本地 `pnpm dev`，分别以 `super_admin`、`pmc_planner`、`viewer` 登录：
- 三者都能看到「系统设置 → 规则中心」，能看到「当前生效参数」表。
- `viewer` 看不到「新建草稿」与操作按钮。
- `pmc_planner` 能新建草稿、试算（结果表出现）、提交审批；未试算时「提交审批」禁用。
- `super_admin` 能审批生效、驳回（驳回后回到草稿并显示原因）、从归档恢复。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/pages/RuleCenterPage.tsx apps/web/src/router.tsx packages/db/drizzle/0124_rule_center_menu.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat(rules): rule center page and menu"
```

---

### Task 10: 最终基线对照、文档与收尾

**Files:**
- Modify: `docs/business/scm-demand-supply-inventory-logic.md`
- Modify: `docs/superpowers/specs/2026-10-26-rule-modules-design.md`（标注第 0 期完成）

- [ ] **Step 1: 同日基线对照**

若 Task 1 的基线不是今天导出的，先在 worktree 重新导出：

```bash
git worktree add ../scm-agent-baseline rules-p0-baseline
cd ../scm-agent-baseline && pnpm install && pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts export ../../.tmp-rules-baseline.json
cd ../scm-agent && git worktree remove ../scm-agent-baseline
```

（worktree 与主目录共用同一 `.env` 数据库连接；路径中 `../../.tmp-rules-baseline.json` 相对 worktree 的 `apps/web`，导出前确认文件落到主仓库根目录，必要时改为绝对路径。）

确认 `SELECT count(*) FROM rule_param_sets WHERE status = 'active';` 为 0，然后：

Run: `pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts compare ../../.tmp-rules-baseline.json`
Expected: `与基线一致`

再做一次全量对照：在 baseline worktree 中 `export ../../.tmp-rules-baseline-full.json --full`，回到主目录 `compare ../../.tmp-rules-baseline-full.json`（全量单次可能超过 1 小时，两次须同一天完成）。
Expected: `与基线一致`

- [ ] **Step 2: 全量相关测试**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/core/param.test.ts server/rules/core/resolve.test.ts server/rules/core/store.test.ts server/rules/replenishment/qty.test.ts server/rules/replenishment/evaluate.test.ts server/rules/replenishment/defaults-consistency.test.ts server/rules/simulate.test.ts server/lib/inventory-timeline.test.ts server/lib/replenishment-coverage.test.ts server/lib/network-replenishment.test.ts server/lib/inventory-health-service.test.ts server/lib/stock-alert-timeline.test.ts server/lib/replenish-light-sync.test.ts`
Expected: `fail 0`

Run: `pnpm --filter @scm/web exec tsc --noEmit -p tsconfig.json`
Expected: 无新增报错

- [ ] **Step 3: 更新业务逻辑文档**

在 `docs/business/scm-demand-supply-inventory-logic.md`：

1. §0.3「关键常量速查」表上方加一段：
   > 自 2026-10 起，备货相关参数（单次补货覆盖天数、默认安全库存天数、超储阈值、滞销阈值、MOQ 取值顺序、黄灯联动、US 仓网延后）由「规则中心」（`/system/rules`，`rule_param_sets`）按 全局 → 项目组 → 仓库 分层覆盖；下表为无参数集时的默认值。补货任务与 SKU 规划页同源读取；驾驶舱与预警在第 1、2 期迁移前仍用默认值。
2. 表中「默认安全库存天数」「默认超储阈值」「单次补货覆盖上限」三行的「文件」列改为 `apps/web/server/rules/replenishment/params.ts`。
3. §2.3「① 补货建议」末尾加一条：「每次运行写 `rule_eval_runs`，建议 `metrics.ruleRunId` 指向本次使用的参数集版本；`metrics.ruleTrace` 记录判断依据。」

- [ ] **Step 4: 标注规格进度**

在规格文档 §7 表格「第 0 期」行的「内容」列末尾追加「（已完成）」，并在文档头部状态行改为「第 0 期已完成」。

- [ ] **Step 5: Commit**

```bash
git add docs/business/scm-demand-supply-inventory-logic.md docs/superpowers/specs/2026-10-26-rule-modules-design.md
git commit -m "docs: rule center phase 0 in business logic doc"
```

---

## 已知限制（第 0 期不处理，转入后续阶段）

- 驾驶舱分档（`alert-horizon-demand.ts`、`alert-network-coverage.ts`）、`stockAlert.ts`、`alert-list-supply.ts`、`demand-plan-service.ts` 仍用代码默认值（30 天、14 天、MOQ SKU 优先）。参数改动后这些页面与补货建议可能不一致，第 2 期迁移时统一；规则中心页面需在备货规则说明中提示这一点。
- 试算同步执行，单次最多 50 个 SKU；更大范围的试算需改为异步任务（复用 `task-runs`）。
- 交期默认值（生产 50 天、入仓 7 天）、远期预测缓冲、需求反推封顶属于事实层 / 需求域配置，不在备货规则模块内。
