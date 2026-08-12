# T4B / T99 温和乐观放宽（方案 A） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 T4B / T99 水位常量温和抬高，缓解分层复盘中的系统性总量低估；本轮不改 Ghost / 断销闸。

**Architecture:** 仅改 `forecast-allcat-v41.ts` 与 `forecast-demand.ts` 中的常量及依赖它们的公式文案/单测；UI 中硬编码「×0.6」同步为「×0.8」。用现有 7 月离线脚本验证偏差方向。不强制重算已 published 版本。

**Tech Stack:** TypeScript、Node `tsx --test`、既有 V4.1 / T99 保底链路。

**Spec:** [`docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md`](../specs/2026-08-12-t4b-t99-optimistic-relax-design.md)

## Global Constraints

- T4B：`NEAR_CONSERVATIVE` 0.8→**0.9**；`CONSERVATIVE` 0.6→**0.75**；`RECENT30_CAP` 0.85→**0.95**；`RECENT90_CAP` 0.9→**1.0**
- T99：`T99_SYSTEM_FLOOR_DISCOUNT` 与补货 fallback 默认折扣 0.6→**0.8**
- **不变**：T99 `recent30≤0→0`；T99/T4B flex `k≥3 ×0.72`；Ghost 弱动销阈值；T1–T4A 常量；`t99FloorMode` 枚举名 `recent_max06` 保留
- 仅新生成版本生效；主 KPI 仍排除 T4B/T99
- 测试命令：`pnpm --filter @scm/web exec tsx --test <path>`

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/forecast-demand.ts` | T99 折扣常量 + fallback 默认 |
| `apps/web/server/lib/forecast-demand.test.ts` | T99 水位 / fallback 期望值 |
| `apps/web/server/lib/forecast-allcat-v41.ts` | T4B 四处常量；T99 公式/复核文案中的 ×0.6 |
| `apps/web/server/lib/forecast-allcat-v41.test.ts` | T4B cap / T99 floor 期望值 |
| `apps/web/src/components/ForecastStrategySection.tsx` | 策略表 T99 公式文案 |
| `apps/web/src/pages/SalesForecastListPage.tsx` | 列表 T99 说明 |
| `apps/web/scripts/validate-july-t4b-relax.ts` | 离线复盘（可选小改：打印常量版本；确认含 T99 重算） |
| `docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md` | 状态改为已实现（全部任务完成后） |

---

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

---

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

---

### Task 3: UI 文案同步 ×0.6→×0.8

**Files:**
- Modify: `apps/web/src/components/ForecastStrategySection.tsx`
- Modify: `apps/web/src/pages/SalesForecastListPage.tsx`

**Interfaces:**
- 无新 API；仅展示文案与后端折扣一致

- [ ] **Step 1: 改策略表与列表说明**

`ForecastStrategySection.tsx` T99 行：

```ts
'max(近30,近90)×0.8，远月×0.72；不进主 KPI'
```

`SalesForecastListPage.tsx`：

```tsx
max(近30,近90)×0.8
```

（整句其余部分不变。）

- [ ] **Step 2: 全库扫残留硬编码**

Run（在 `apps/web`）：

```bash
rg "近90\)×0\.6|recent90\)\*0\.6|max\(近30,近90\)×0\.6" -g "*.ts" -g "*.tsx"
```

Expected: 无业务文案命中（测试历史注释除外；`recent_max06` 枚举名可保留）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ForecastStrategySection.tsx apps/web/src/pages/SalesForecastListPage.tsx
git commit -m "docs(forecast): sync T99 UI copy to 0.8 floor discount"
```

---

### Task 4: 离线 7 月复盘 + 收尾

**Files:**
- Modify (可选): `apps/web/scripts/validate-july-t4b-relax.ts` — 在标题打印当前 `V41_T4B_*` / `T99_SYSTEM_FLOOR_DISCOUNT`
- Modify: `docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md` — 状态改为「已实现」

**Interfaces:**
- 脚本仍不写库；T99 行若 `old_system_d>0` 可走 `computeAllCatV41BoundedDaily`；脚本现有 `tier === 'T99' return 0` 需改为调用真实 T99 分支（否则复盘看不到折扣抬升）

- [ ] **Step 1: 修脚本 T99 重算**

将 `recompute` 中：

```ts
if (tier === 'T99') return 0;
```

改为照常调用 `computeAllCatV41BoundedDaily`（与其它层相同），让 T99 走系统保底。

文件头注释改为说明「T4B+T99 方案 A 常量复盘」。

在 `main` 开头 `console.log` 打印：

```ts
import {
  V41_T4B_CONSERVATIVE_FACTOR,
  V41_T4B_NEAR_CONSERVATIVE_FACTOR,
  V41_T4B_RECENT30_CAP,
  V41_T4B_RECENT90_CAP,
} from '../server/lib/forecast-allcat-v41.js';
import { T99_SYSTEM_FLOOR_DISCOUNT } from '../server/lib/forecast-demand.js';

console.log('constants', {
  T4B_near: V41_T4B_NEAR_CONSERVATIVE_FACTOR,
  T4B_far: V41_T4B_CONSERVATIVE_FACTOR,
  T4B_r30_cap: V41_T4B_RECENT30_CAP,
  T4B_r90_cap: V41_T4B_RECENT90_CAP,
  T99_discount: T99_SYSTEM_FLOOR_DISCOUNT,
});
```

- [ ] **Step 2: 跑离线复盘（环境允许时）**

Run: `pnpm --filter @scm/web exec tsx scripts/validate-july-t4b-relax.ts`

Expected: 输出含 T4B / T99 行；相对「旧系统」偏差应向 0 靠拢（不要求一次达标 0）。若本机无 Docker/DB，记录跳过原因，不阻塞合并；单测已覆盖常量。

- [ ] **Step 3: 标记 spec 已实现**

将设计文档头部改为：

```markdown
> **状态**：已实现  
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/scripts/validate-july-t4b-relax.ts docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md
git commit -m "chore(forecast): validate July T4B/T99 plan-A relax offline"
```

---

## Spec coverage checklist

| Spec 要求 | Task |
|-----------|------|
| T4B 四常量 | Task 2 |
| T99 折扣 0.8 + fallback 对齐 | Task 1 |
| 不断销闸 / 不 Ghost | 全任务不改相关阈值 |
| 单测 | Task 1–2 |
| UI ×0.6 同步 | Task 3 |
| 7 月离线复盘 | Task 4 |
| 仅新版本生效 | 无代码强制重算 |
| 方案 B 不做 | 未列入任务 |

## Self-review

- 无 TBD / 「类似 Task N」占位
- T99 数值：`max(2,4)*0.8=3.2`，`*0.72=2.304`；`max(3,2)*0.8=2.4`；fallback `max(2,1)*0.8=1.6` — 与实现一致
- `recent_max06` 枚举名按 spec 保留
