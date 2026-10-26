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

