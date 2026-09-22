# 产品成本核算中短期优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **先做 Task 1–4（阶段 S）；Task 5–7（阶段 M）须等 S 合入且本 spec 已评审。**

**Goal:** 近期让采购在第三步按异常处理并看清行来源、支持图片上传；中期保留提取原值、按计价日匹配价目、按工厂覆盖包装公式参数。

**Architecture:** 计算与开料仍在 scm-agent；Dify 只识别。S 用纯函数从现有 BOM 字段派生 `reviewIssues` 与来源标签。M 才加 `extract_snapshot`、`price_as_of` / 价目生效日、`pack_profile`。

**Tech Stack:** Drizzle/Postgres、Hono、React Query、Node `tsx --test`。

**Spec:** `docs/superpowers/specs/2026-08-20-costing-short-mid-term-design.md`

## Global Constraints

- 手填单价只记本单 `unit_price_override`，禁止写入 `material_price_book`
- 斗柜/床头柜开料公式不得改入 LLM；不改 Dify DSL
- 不拆四套成本表；不加供应商维；不把 SLA 当测试断言
- bundled 五金、独立加工行、部门页脚、装饰件：不进计算 block（沿用 `compute-gate.ts`）
- 测试：`cd apps/web && pnpm exec tsx --test <file>`
- 中文 UI；提交 `feat(costing):`；Windows 用 `git commit -m "..."`
- 下一迁移号：journal 当前最大 `0089`，S3 不强制迁库；M 从 `0090` 起

---

## File Map

| File | Responsibility |
|------|----------------|
| `apps/web/server/lib/product-costing/review-issues.ts` | `listReviewIssues`、`lineProvenanceTags` |
| `apps/web/server/lib/product-costing/review-issues.test.ts` | S 验收用例 |
| `apps/web/server/lib/product-costing/compute-gate.ts` | 保持 block 语义；issues 复用 blockers |
| `apps/web/server/lib/product-costing/service.ts` | GET 带 `reviewIssues`；附件扩展名 |
| `apps/web/server/lib/product-costing/preprocess/raster-image.ts` | 单页图片预处理 |
| `apps/web/server/lib/product-costing/preprocess/index.ts` | 路由到 raster |
| `apps/web/src/lib/api.ts` | `CostingReviewIssue`、`provenanceTags` |
| `apps/web/src/pages/ProductCostingToolPage.tsx` | 第三步队列、图片 accept、计价日（M） |
| `apps/web/src/components/costing/BomLinesPanel.tsx` | 来源 Pill；原值 tooltip（M） |
| `apps/web/src/components/costing/ReviewIssuesPanel.tsx` | 异常列表 UI |
| `packages/db/src/schema/product-costing.ts` | M 列 |
| `packages/db/drizzle/0090_costing_extract_snapshot.sql` | M1 |
| `packages/db/drizzle/0091_costing_price_as_of.sql` | M2 |
| `packages/db/drizzle/0092_costing_factory_pack_profile.sql` | M3 |
| `apps/web/server/lib/product-costing/price-match.ts`（或现有匹配模块） | 生效日过滤 |
| `apps/web/server/lib/product-costing/packaging.ts`（或 enrich 内包装） | merge pack_profile |

---

### Task 1: 异常与来源纯函数

**Files:**
- Create: `apps/web/server/lib/product-costing/review-issues.ts`
- Create: `apps/web/server/lib/product-costing/review-issues.test.ts`
- Modify: `apps/web/server/lib/product-costing/compute-gate.ts`（仅导出 blocker→issue 映射所需类型，不改拦截规则）

**Produces:**

```ts
export type ReviewSeverity = 'block' | 'warn';
export type ReviewIssueCode =
  | 'missing_price'
  | 'missing_qty'
  | 'missing_thickness'
  | 'unmatched'
  | 'template_pending'
  | 'low_confidence'
  | 'inferred_cut';

export type ReviewIssue = {
  lineId?: string;
  materialName: string;
  code: ReviewIssueCode;
  severity: ReviewSeverity;
  message: string;
};

export type ProvenanceTag =
  | '设计明示'
  | '规则开料'
  | '模板补全'
  | '库价'
  | '本单补价'
  | '人工修改';

export function listReviewIssues(input: {
  blockers: Array<{ lineId?: string; materialName: string; reason: string }>;
  lines: Array<{
    id?: string;
    materialName: string;
    category: string;
    origin: string;
    isManual: boolean;
    confidence: string;
    matchStatus: string;
    unitPriceOverride: number | null;
    qtyNet: number;
  }>;
}): ReviewIssue[];

export function lineProvenanceTags(line: {
  origin: string;
  category: string;
  isManual: boolean;
  matchStatus: string;
  unitPriceOverride: number | null;
}): ProvenanceTag[];
```

- [ ] **Step 1: 写失败测试**

`review-issues.test.ts` 至少覆盖 spec §7 S1–S3：

- 缺价 blocker → `missing_price` + severity `block`
- `origin=template`、`category=包装`、`isManual=false`、有价 → `template_pending` warn，且无 block
- 板材 + origin template → tags 含 `规则开料`；`isManual=true` 另含 `人工修改`

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec tsx --test server/lib/product-costing/review-issues.test.ts`  
Expected: 模块不存在或断言失败

- [ ] **Step 3: 实现**

- blocker reason 映射：`missing_price` / `missing_qty` / `missing_thickness` → 同 code、message 用中文（缺单价 / 缺用量 / 缺板厚）
- `inferred_cut`：`origin==='template' && category==='板材'`
- `template_pending`：`origin==='template' && !isManual && category !== '板材'`（板材走 inferred_cut，避免双 warn；若两者都适用只保留 inferred_cut）
- `unmatched`：`matchStatus==='unmatched'` 且该行没有 missing_price block（已有 override 时仍 warn）
- `low_confidence`：`confidence==='low'`
- 同一 lineId+code 去重；block 排在 warn 前

- [ ] **Step 4: 跑测试通过**

Run: 同上  
Expected: PASS

- [ ] **Step 5: Commit**

```text
feat(costing): classify review issues and provenance tags
```

---

### Task 2: GET 返回 reviewIssues，第三步队列

**Files:**
- Modify: `apps/web/server/lib/product-costing/service.ts`（`getProject` 组装 `reviewIssues`）
- Modify: `apps/web/src/lib/api.ts`（`CostingProjectDetail.reviewIssues`、`CostingBomLine.provenanceTags` 可选由服务端带上以免双写）
- Create: `apps/web/src/components/costing/ReviewIssuesPanel.tsx`
- Modify: `apps/web/src/pages/ProductCostingToolPage.tsx`（step 3 在区域选择之上渲染队列；点击 `onJumpToLine` → `setStep(2)` + 把 `highlightLineId` 传给 BomLinesPanel）
- Modify: `apps/web/src/components/costing/BomLinesPanel.tsx`（高亮 `highlightLineId` 行）

**Consumes:** Task 1 函数  
**Produces:** GET `/projects/:id` JSON 含 `reviewIssues`；行上建议同时返回 `provenanceTags: string[]`（服务端算，前端只展示）

- [ ] **Step 1: service 单测或扩展现有 service.test**  
缺价项目 `reviewIssues` 含 block；计算按钮逻辑仍看 `computeBlockers.length`（不要改成只看 warn）

- [ ] **Step 2: UI**  
`ReviewIssuesPanel`：block 一组、warn 一组；每条按钮「去处理」。空队列显示「没有待处理异常」。

- [ ] **Step 3: 手动核对文案后 commit**

```text
feat(costing): show step-3 review issue queue
```

---

### Task 3: 第二步来源标签

**Files:**
- Modify: `apps/web/src/components/costing/BomLinesPanel.tsx`  
  替换 `ORIGIN_LABELS` 单列：用 `line.provenanceTags`（API 已带）渲染多个 muted Pill；无 tags 时回退 `ORIGIN_LABELS`

- [ ] **Step 1:** 规则开料行可见「规则开料」；有 override 可见「本单补价」
- [ ] **Step 2:** Commit

```text
feat(costing): show multi provenance tags on BOM lines
```

---

### Task 4: 图片作为单页源文件（阶段 S 结束）

**Files:**
- Modify: `apps/web/server/lib/product-costing/service.ts` `assertCostingSourceAttachment`
- Modify: `apps/web/server/lib/product-costing/service.test.ts`（jpg/png 通过，.xlsx 仍拒）
- Create: `apps/web/server/lib/product-costing/preprocess/raster-image.ts`
- Create: `apps/web/server/lib/product-costing/preprocess/raster-image.test.ts`
- Modify: `apps/web/server/lib/product-costing/preprocess/index.ts`
- Modify: 上传控件 `accept`（`ProductCostingToolPage.tsx` 或附件按钮所在组件）

**Produces:** 图片 → 1 个 `page_image`，不跑 soffice

- [ ] **Step 1:** `assertCostingSourceAttachment('size.png', 100)` 不抛；`note.webp` 不抛；超 80MB 抛
- [ ] **Step 2:** raster 预处理：写入 `pages/page-1.png`（jpeg/png 可原样或转 png）；返回 `pages.length === 1`
- [ ] **Step 3:** 前端 file input `accept=".pptx,.pdf,.jpg,.jpeg,.png,.webp"`
- [ ] **Step 4:** Commit

```text
feat(costing): accept raster images as single-page sources
```

---

### Task 5: 提取原值快照（阶段 M，S 合入后再做）

**Files:**
- Modify: `packages/db/src/schema/product-costing.ts` — `extractSnapshot` jsonb
- Create: `packages/db/drizzle/0090_costing_extract_snapshot.sql`  
  `ALTER TABLE costing_bom_lines ADD COLUMN IF NOT EXISTS extract_snapshot jsonb;`
- Modify: `packages/db/drizzle/meta/_journal.json` idx 92 / tag `0090_costing_extract_snapshot`
- Modify: 写入 AI/模板行的路径（`extract-runner` / `apply-facts` / enrich）：INSERT 时写入 snapshot；PATCH 人改 **不** 更新该列
- Modify: `BomLinesPanel` tooltip：有 snapshot 且与当前 name/spec/qty 不同时显示对照
- Modify: 导出 xlsx 可选列「提取原名/原用量」

- [ ] 人改 qty 后 GET 行 `extractSnapshot.qtyNet` 仍为旧值  
- [ ] 重拆非手工行：snapshot 换成新提取  
- [ ] Commit: `feat(costing): persist extract snapshot on BOM lines`

---

### Task 6: 计价日与价目生效区间

**Files:**
- Schema：`costing_projects.price_as_of` date default `CURRENT_DATE`；`material_price_book.effective_from` date not null default `'2000-01-01'`；`effective_to` date null
- 迁移 `0091_costing_price_as_of.sql` + journal
- 匹配逻辑：在现有 region/factory 切片之后按 spec §2 过滤；多条取 `effective_from` 最大
- POST/PATCH 价目：相交区间 400，body 说明冲突 id
- PATCH project `priceAsOf`：调用 `clearCostSnapshot`
- UI：第三步日期控件；价目表两列生效起止
- 测试：spec §7 M2、M4

- [ ] Commit: `feat(costing): match price book by price-as-of date`

---

### Task 7: 工厂包装档案

**Files:**
- `costing_factories.pack_profile` jsonb 或表 `0092_costing_factory_pack_profile.sql`
- 包装计算 merge 默认常量（现网 +80mm、保利龙 20mm/280、纸箱 4.9、护角 0.5）
- 配置入口：成本配置面板工厂行可编辑 JSON 或五个数字字段（优先五个数字，禁止自由 JSON 给采购）
- 测试：spec §7 M3；无 profile 与现网金标准夹具结果一致

- [ ] Commit: `feat(costing): factory pack profile overrides packaging formula`

---

## 阶段门禁

- **S 完成**：Task 1–4 测试绿、第三步队列可用、图片可上传。此时即可发布专用机。
- **M 开始前**：确认价目是否已有「同名多行靠停用」的运维习惯；M2 上线要给采购一页说明：不要重叠生效区间。
- **M 完成后**：再评估连接件模板、多图、包装新材料——不在本计划内。
