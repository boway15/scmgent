# Task 3 Report：从 M1 拷贝存储与预处理

## Status

**DONE**

## 实现内容

- 从 `feature/product-costing-bom-m1` 精确检出存储、项目编号、BOM 合并、工作流输出解析及 PPTX/PDF 预处理文件。
- 保留 Task 2 的 `types.ts` 与 `bom-math.ts`，未从 M1 覆盖。
- `parseWorkflowLines` 使用 Task 2 的 `normalizeAiLine`，返回包含 `origin` 的规范化 BOM 行。
- `mergeBomLines` 对缺少 `origin` 的旧草稿行回填 `explicit`，并增加回归断言。
- 未修改预处理算法。

## TDD 记录

- 新增 `origin` 回归断言后单独运行 `merge-lines.test.ts`，按预期以 `undefined !== 'explicit'` RED。
- 增加最小兼容处理后，指定测试集转为 GREEN。

## 验证结果

- Task 3 指定命令：**7/7 tests PASS，5/5 suites PASS**。
- IDE linter：`apps/web/server/lib/product-costing` 无错误。
- `git diff --cached --check`：提交前通过。
- 提交仅包含 14 个 `apps/web/server/lib/product-costing` 任务文件；未纳入工作区其他修改或未跟踪文件。

## Commit

`6023290 feat(costing): port M1 storage and PPTX preprocess`

## Concerns

- Brief 的 Produces 列表写为 `nextCostingProjectNo`，但指定 M1 源文件实际导出 `buildProjectNo` 与 `randomProjectSuffix`。为遵守“从分支检出、不要改业务语义”，本任务保留 M1 原导出，后续调用方需确认接口命名。

---

## Review fix: export `nextCostingProjectNo`

**Status:** DONE

**Change:** `project-no.ts` 新增 `nextCostingProjectNo()`，实现与 M1 `service.ts` 一致：`buildProjectNo(new Date(), randomProjectSuffix())`。

**Import check:**

```
cd apps/web && pnpm exec tsx -e "import { nextCostingProjectNo } from './server/lib/product-costing/project-no.ts'; console.log(typeof nextCostingProjectNo, nextCostingProjectNo());"
function CST-20260813-8438
```

**Covering tests:**

```
cd apps/web && pnpm exec tsx --test server/lib/product-costing/storage.test.ts server/lib/product-costing/merge-lines.test.ts server/lib/product-costing/parse-workflow-output.test.ts
```

```
▶ mergeBomLines
  ✔ sums qty for same material+spec+unit (4.6732ms)
✔ mergeBomLines (9.4084ms)
▶ parseWorkflowLines
  ✔ parses stringified lines (6.4221ms)
✔ parseWorkflowLines (10.5041ms)
▶ resolveStoragePath
  ✔ rejects path traversal (1.5868ms)
  ✔ accepts project-relative paths (0.8196ms)
✔ resolveStoragePath (4.6751ms)
ℹ tests 4
ℹ suites 3
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 929.0016
```

**Commit:** `fix(costing): export nextCostingProjectNo alias`
