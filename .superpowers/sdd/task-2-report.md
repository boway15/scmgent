# Task 2 Report: T4B 四处常量放宽（TDD）

## Status

**DONE**

## Summary

Plan A 温和乐观：仅放宽 T4B 四处常量（远月保守系数 0.75、近端 0.9、recent90 cap 1.0、recent30 cap 0.95）。未改动 Ghost 阈值、T4B flex decay、近端抬底或 T99。按 brief 走 TDD：先补失败断言 → RED → 改常量 → GREEN → 提交。

## Constants Changed

| Constant | Before | After |
|----------|--------|-------|
| `V41_T4B_CONSERVATIVE_FACTOR` | 0.6 | 0.75 |
| `V41_T4B_NEAR_CONSERVATIVE_FACTOR` | 0.8 | 0.9 |
| `V41_T4B_RECENT90_CAP` | 0.9 | 1.0 |
| `V41_T4B_RECENT30_CAP` | 0.85 | 0.95 |

## Files Modified

| File | Change |
|------|--------|
| `apps/web/server/lib/forecast-allcat-v41.ts` | 更新四处 T4B 常量；注释保留「缓解系统性低估」并追加「方案 A 温和乐观」 |
| `apps/web/server/lib/forecast-allcat-v41.test.ts` | tail upper bias 断言 cap 改为 `1.36 * 1.0`；新增 `T4B plan-A constants` 用例；import `V41_T4B_RECENT30_CAP` / `V41_T4B_RECENT90_CAP` |

## TDD Evidence

### RED (Step 2)

命令：

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts
```

结果：**FAIL** — 46/47 pass，1 fail。

```
✖ T4B plan-A constants: near 0.9 / far 0.75 / caps 0.95 & 1.0
  AssertionError: Expected values to be strictly equal:
  0.8 !== 0.9
      at forecast-allcat-v41.test.ts:983:12
```

（常量仍为旧值 `V41_T4B_NEAR_CONSERVATIVE_FACTOR = 0.8` 时，新断言按预期失败。）

### GREEN (Step 4)

命令：

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts
```

结果：**PASS**

- `forecast-allcat-v41.test.ts`: 46/46 pass
- `forecast-demand.test.ts`: 14/14 pass

## Commit

| SHA | Subject |
|-----|---------|
| `a362a9b` | feat(forecast): relax T4B conservative factor and recent caps |

## Review Fix (2026-08-12)

**Issue:** 原提交 `5800be0` 混入 ~70 行无关代码（`aggregateAllCatV41HorizonFactorsForDisplay`、`V41PlatformContribution`、`aggregatedPlatformCount` 解析/展示及聚合测试）。

**Fix:** `git reset --soft HEAD~1` → 自 `forecast-allcat-v41.ts` / `.test.ts` 还原无关 hunk → 仅保留四处 T4B 常量 + plan-A 测试 → 重新提交。

**Post-fix tests:**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts
```

- `forecast-allcat-v41.test.ts`: **46/46 pass**
- `forecast-demand.test.ts`: **14/14 pass**

**WIP:** 聚合/display 相关改动仍保留在其他文件的未提交工作区（如 `forecast-horizon.ts`、`forecast-v41-system-formula.ts` 等），未写入 Task 2 提交。

## Self-Review

### Scope

- 仅改 brief 指定的四处常量与对应测试；`V41_T4B_FLEX_*`、近端 floor、Ghost 阈值、T99 均未动。

### Concerns

- 无。T4B 放宽幅度与 Task 1 T99 discount 0.8 同属 Plan A，后续 Task 3+ 做端到端校验即可。
