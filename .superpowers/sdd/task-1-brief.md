### Task 1: T99 折扣 0.6→0.8（TDD）

**Files:**
- Modify: `apps/web/server/lib/forecast-demand.test.ts`
- Modify: `apps/web/server/lib/forecast-demand.ts`
- Modify: `apps/web/server/lib/forecast-allcat-v41.test.ts`（本任务只改 T99 相关断言；T4B 留给 Task 2）
- Modify: `apps/web/server/lib/forecast-allcat-v41.ts`（公式字符串与 `buildT99ReviewMessage` 中的 ×0.6）

**Interfaces:**
- Consumes: 现有 `resolveT99SystemFloorDaily` / `resolveT99ReplenishmentFallbackDaily`
- Produces: `T99_SYSTEM_FLOOR_DISCOUNT = 0.8`；fallback 默认 `discount = 0.8`；数值期望 `max(r30,r90)*0.8`

- [ ] **Step 1: 改失败单测（demand）**

将 `forecast-demand.test.ts` 中下列断言改为 0.8 口径：

```ts
it('resolveT99SystemFloorDaily uses max(r30,r90)*0.8 near and *0.72 far', () => {
  // max(2, 4) * 0.8 = 3.2; far = 3.2 * 0.72 = 2.304
  const near = resolveT99SystemFloorDaily({
    recent30DailyAvg: 2,
    recent90DailyAvg: 4,
    horizonIndex: 1,
  });
  const far = resolveT99SystemFloorDaily({
    recent30DailyAvg: 2,
    recent90DailyAvg: 4,
    horizonIndex: 3,
  });
  assert.equal(near.daily, 3.2);
  assert.equal(near.mode, 'recent_max06');
  assert.equal(far.daily, 2.304);
  assert.equal(far.mode, 'recent_max06');
});
```

将「T99 zero forecast falls back…」中期望 `1.2` 改为 `1.6`（`max(2,1)*0.8`），两处 `assert.equal(..., 1.2)` → `1.6`。

断销闸测例（daily=0）**不要改**。

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts`

Expected: FAIL（仍为 2.4 / 1.2）

- [ ] **Step 3: 改实现常量**

在 `forecast-demand.ts`：

```ts
export const T99_SYSTEM_FLOOR_DISCOUNT = 0.8;
```

`resolveT99ReplenishmentFallbackDaily` 注释与默认：

```ts
  /** 相对近期动销的折扣，默认 0.8（与 T99_SYSTEM_FLOOR_DISCOUNT 对齐） */
  discount?: number;
}): number {
  const discount =
    input.discount != null && Number.isFinite(input.discount) && input.discount > 0
      ? input.discount
      : 0.8;
```

优先：默认折扣直接引用常量，避免漂移：

```ts
      : T99_SYSTEM_FLOOR_DISCOUNT;
```

- [ ] **Step 4: 同步 allcat T99 断言与文案**

`forecast-allcat-v41.test.ts` 中 `computeAllCatV41ForecastForMonth writes T99 floor...`：

```ts
assert.equal(result.forecastDaily, 2.4); // max(3,2)*0.8
assert.equal(result.formula, 'max(recent30,recent90)*0.8 with far decay');
assert.equal(result.horizonFactors.t99FloorDaily, 2.4);
```

`forecast-allcat-v41.ts`：

- `tierFormula` T99 分支：`'max(recent30,recent90)*0.8 with far decay'`
- `buildT99ReviewMessage`：`（max(近30,近90)×0.8，远月衰减）`

- [ ] **Step 5: 跑测通过**

Run:

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts
```

Expected: PASS（若 allcat 因 T4B 旧 cap 断言尚未改而失败，可先只确认 demand + T99 相关用例；完整 allcat 在 Task 2 后必绿）

- [ ] **Step 6: Commit**

```bash
git add apps/web/server/lib/forecast-demand.ts apps/web/server/lib/forecast-demand.test.ts apps/web/server/lib/forecast-allcat-v41.ts apps/web/server/lib/forecast-allcat-v41.test.ts
git commit -m "feat(forecast): raise T99 floor discount 0.6→0.8"
```
