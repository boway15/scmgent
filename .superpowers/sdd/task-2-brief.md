### Task 2: T4B 四处常量放宽（TDD）

**Files:**
- Modify: `apps/web/server/lib/forecast-allcat-v41.ts`
- Modify: `apps/web/server/lib/forecast-allcat-v41.test.ts`

**Interfaces:**
- Consumes: `tierConservativeFactor` / `applyV41TailUpperBiasCap` / `computeAllCatV41BoundedDaily`
- Produces: 新常量值如下

```ts
export const V41_T4B_CONSERVATIVE_FACTOR = 0.75;
export const V41_T4B_NEAR_CONSERVATIVE_FACTOR = 0.9;
export const V41_T4B_RECENT90_CAP = 1.0;
export const V41_T4B_RECENT30_CAP = 0.95;
```

- [ ] **Step 1: 改/补失败断言**

现有用例已用常量符号断言 `tierConservativeFactor`，常量一改即自动跟新。需改硬编码 cap：

`computeAllCatV41BoundedDaily caps T4B with tail upper bias`：

```ts
assert.ok(bounded.forecastDaily <= 1.36 * 1.0); // V41_T4B_RECENT90_CAP
```

在同文件追加（或扩展现有 near horizon 用例）显式锁定数值：

```ts
it('T4B plan-A constants: near 0.9 / far 0.75 / caps 0.95 & 1.0', () => {
  assert.equal(V41_T4B_NEAR_CONSERVATIVE_FACTOR, 0.9);
  assert.equal(V41_T4B_CONSERVATIVE_FACTOR, 0.75);
  assert.equal(V41_T4B_RECENT30_CAP, 0.95);
  assert.equal(V41_T4B_RECENT90_CAP, 1.0);
  assert.equal(tierConservativeFactor('T4B', 'C', 0), 0.9);
  assert.equal(tierConservativeFactor('T4B', 'C', 3), 0.75);
});
```

确保 import 含 `V41_T4B_RECENT30_CAP`、`V41_T4B_RECENT90_CAP`（若尚未 import）。

- [ ] **Step 2: 跑测确认失败（常量仍为旧值时）**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts`

Expected: 新常量断言 FAIL

- [ ] **Step 3: 改常量**

在 `forecast-allcat-v41.ts` 将注释「缓解系统性低估」保留，更新四值：

```ts
/** T4B 稳定保底层：远月压 ghost；近端 k≤2 放宽保守系数并抬底（方案 A 温和乐观） */
export const V41_T4B_CONSERVATIVE_FACTOR = 0.75;
export const V41_T4B_NEAR_CONSERVATIVE_FACTOR = 0.9;
// ...
export const V41_T4B_RECENT90_CAP = 1.0;
export const V41_T4B_RECENT30_CAP = 0.95;
```

勿改 `V41_T4B_FLEX_*`、近端抬底、Ghost 阈值。

- [ ] **Step 4: 跑全量相关单测**

Run:

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/forecast-allcat-v41.ts apps/web/server/lib/forecast-allcat-v41.test.ts
git commit -m "feat(forecast): relax T4B conservative factor and recent caps"
```
