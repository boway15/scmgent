# SKU 项目组字段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `skus` 落库只读派生字段 `project_group`（值如 `项目1组`），从品类路径第二段解析，商品主数据 SKU 列表可展示与筛选。

**Architecture:** 共用 `extractProjectGroupFromCategory`；凡写 `skus.category` 的入口同步写 `project_group`；迁移加列+回填；`sku-overview` 暴露字段与筛选；前端 SKU Tab 加列与筛选项。

**Tech Stack:** Drizzle/Postgres、Hono、React、node:test

## Global Constraints

- 存值仅核心名 `项目\d+组`；不可手工写入
- 只从品类路径第二段解析
- 不改预测 seasonality 维度语义；不加 SPU 字段；不做导出/下拉枚举

## File Structure

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/sku-category.ts` | `extractProjectGroupFromCategory` |
| `apps/web/server/lib/sku-category.test.ts` | 解析单元测试 |
| `packages/db/src/schema/inventory.ts` | `skus.projectGroup` + 索引 |
| `packages/db/drizzle/0071_sku_project_group.sql` | 加列、索引、回填 |
| `packages/db/drizzle/meta/_journal.json` | 登记迁移 |
| `apps/web/server/lib/ensure-sku-from-import.ts` | 导入写 category 时同步 |
| `apps/web/server/routes/skus.ts` | POST/PUT 派生 projectGroup |
| `apps/web/server/routes/products.ts` | sku-overview 字段与筛选 |
| `apps/web/src/lib/api.ts` | 类型与 query |
| `apps/web/src/lib/product-master-sku-columns.ts` | 列表列 |
| `apps/web/src/pages/ProductMasterPage.tsx` | 筛选输入 |

---

### Task 1: 解析函数（TDD）

**Files:**
- Modify: `apps/web/server/lib/sku-category.ts`
- Modify: `apps/web/server/lib/sku-category.test.ts`

**Interfaces:**
- Produces: `extractProjectGroupFromCategory(category: string | null | undefined): string | null`

- [ ] **Step 1: 写失败测试**

在 `sku-category.test.ts` 增加：

```ts
import { extractProjectGroupFromCategory } from './sku-category.js';

it('extracts 项目x组 from category path second segment', () => {
  assert.equal(
    extractProjectGroupFromCategory(
      'DJ02-家具事业1部\\Amazon项目1组-第一曲线-US\\卧室-床头柜Nightstands',
    ),
    '项目1组',
  );
  assert.equal(
    extractProjectGroupFromCategory(
      'DJ01-郑州大件/非Amazon项目6组-第二曲线-US/客厅-电视柜',
    ),
    '项目6组',
  );
  assert.equal(extractProjectGroupFromCategory('Outdoor/Patio'), null);
  assert.equal(extractProjectGroupFromCategory('单段品类'), null);
  assert.equal(extractProjectGroupFromCategory(null), null);
  assert.equal(extractProjectGroupFromCategory(''), null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && node --import tsx --test server/lib/sku-category.test.ts`  
Expected: FAIL — `extractProjectGroupFromCategory` 未导出

- [ ] **Step 3: 最小实现**

在 `sku-category.ts`：

```ts
const PROJECT_GROUP_RE = /项目\d+组/;

export function extractProjectGroupFromCategory(
  category: string | null | undefined,
): string | null {
  const normalized = normalizeCategoryPath(category);
  if (!normalized) return null;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const match = segments[1].match(PROJECT_GROUP_RE);
  return match?.[0] ?? null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同上  
Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求时提交）

---

### Task 2: Schema + 迁移回填

**Files:**
- Modify: `packages/db/src/schema/inventory.ts`（`skus` 表，`category` 旁加字段与索引）
- Create: `packages/db/drizzle/0071_sku_project_group.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`（idx 73 / tag `0071_sku_project_group`）

- [ ] **Step 1: Schema**

```ts
/** 从品类路径第二段派生的项目组，如 项目1组 */
projectGroup: varchar('project_group', { length: 20 }),
```

索引：

```ts
projectGroupIdx: index('skus_project_group_idx').on(table.projectGroup),
```

- [ ] **Step 2: 迁移 SQL**

```sql
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "project_group" varchar(20);
CREATE INDEX IF NOT EXISTS "skus_project_group_idx" ON "skus" ("project_group");

UPDATE "skus"
SET "project_group" = (
  SELECT (regexp_match(
    split_part(replace(coalesce("category", ''), E'\\', '/'), '/', 2),
    '项目[0-9]+组'
  ))[1]
)
WHERE "category" IS NOT NULL AND btrim("category") <> '';
```

- [ ] **Step 3: Journal** 追加 entry idx 73

---

### Task 3: 写入同步

**Files:**
- Modify: `apps/web/server/lib/ensure-sku-from-import.ts`
- Modify: `apps/web/server/routes/skus.ts`

**Interfaces:**
- Consumes: `extractProjectGroupFromCategory`

- [ ] **Step 1: ensure-sku insert/update**

凡设置 `category` 处同时设：

```ts
projectGroup: extractProjectGroupFromCategory(categoryValue),
```

覆盖：新建 insert、`inventory` patch、以及 `if (input.category && !existing.category)` 分支。

- [ ] **Step 2: skus POST/PUT**

```ts
import { extractProjectGroupFromCategory } from '../lib/sku-category.js';

// POST values:
category: body.category,
projectGroup: extractProjectGroupFromCategory(body.category),

// PUT: 从 skuFields 去掉任何客户端 projectGroup；若 'category' in body：
projectGroup: extractProjectGroupFromCategory(body.category ?? null),
```

注意：`category` 未出现在 body 时不要改 `projectGroup`。

---

### Task 4: sku-overview API + 前端

**Files:**
- Modify: `apps/web/server/routes/products.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/product-master-sku-columns.ts`
- Modify: `apps/web/src/pages/ProductMasterPage.tsx`

- [ ] **Step 1: `buildSkuOverviewWhere` 增加 `projectGroup` ilike**
- [ ] **Step 2: select / map 增加 `projectGroup: skus.projectGroup`**
- [ ] **Step 3: `SkuOverview` 类型与 `getSkuOverview` params 增加 `projectGroup`**
- [ ] **Step 4: 列定义在 `category` 后插入 `{ id: 'projectGroup', label: '项目组', kind: 'text' }`，默认宽度约 88**
- [ ] **Step 5: `SkuFilters` / `EMPTY_SKU_FILTERS` / 筛选 Input「项目组」/ `toSkuFilterParams`**

---

### Task 5: 验证

- [ ] **Step 1:** `cd apps/web && node --import tsx --test server/lib/sku-category.test.ts`
- [ ] **Step 2:** 按需跑 ensure-sku / 相关测试
- [ ] **Step 3:** 更新 spec 状态为「已实现」（可选）
