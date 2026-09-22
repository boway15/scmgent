# 成本核算：结构短表、确认原材料、计算闸门 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 核算页先补核心元素并按类目规则展开结构件，确认原材料（库中无料则本单补价），最后点「计算成本」才出看板快照。

**Architecture:** 短表字段落在 `costing_projects`；`apply-facts` 用现有 `enrichBomFromProductFacts` + 五金 upsert 重写非手工结构/五金行。GET 仍匹配价目供确认，看板只读 `cost_summary` 快照。`POST /compute` 齐套校验后写入快照。手填 `unit_price_override` 不写回价目。

**Tech Stack:** Drizzle/Postgres、Hono、React Query、Node `tsx --test`。

**Spec:** `docs/superpowers/specs/2026-08-19-costing-facts-confirm-calc-design.md`

## Global Constraints

- 手填单价只记本单 `unit_price_override`，禁止写入 `material_price_book`
- 斗柜/床头柜：盖板、侧板落地、前拉条 `ceil((n-2)/2)`、抽侧长=柜深-50、抽侧宽=**抽面高-60**、抽底宽=抽面宽-45
- 书桌/梳妆台/其他：不 upsert 落地拉条/前拉条
- 未填短表五金不得臆造；计算前缺价或缺用量必须拦截
- 测试：`cd apps/web && pnpm exec tsx --test <file>`
- 中文 UI；提交信息 `feat(costing):`；Windows 用 `git commit -m "..."`（不要 bash heredoc）
- 不改 Dify DSL；不新增项目 status 枚举

---

## File Map

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema/product-costing.ts` | 项目短表 + 快照列 |
| `packages/db/drizzle/0081_costing_facts_cost_snapshot.sql` | 幂等 ALTER |
| `packages/db/drizzle/meta/_journal.json` | idx 83 / tag `0081_costing_facts_cost_snapshot` |
| `apps/web/server/lib/product-costing/types.ts` | `HardwareFact`、`ProductFacts` 厚度字段 |
| `apps/web/server/lib/product-costing/hardware-facts.ts` | 解析/规范化短表五金 |
| `apps/web/server/lib/product-costing/compute-gate.ts` | 齐套检查 |
| `apps/web/server/lib/product-costing/enrich-bom-from-facts.ts` | 类目门控 + 短表厚度优先 |
| `apps/web/server/lib/product-costing/apply-facts.ts` | 纯函数：enrich + upsert 五金 |
| `apps/web/server/lib/product-costing/service.ts` | 快照 GET/失效、applyFacts、compute |
| `apps/web/server/lib/product-costing/extract-runner.ts` | 解析结束带短表再 apply |
| `apps/web/server/lib/product-costing/export-costing.ts` | 无快照不写成本汇总金额 |
| `apps/web/server/routes/product-costing.ts` | PATCH 字段 + apply-facts + compute |
| `apps/web/src/lib/api.ts` | 类型与 client |
| `apps/web/src/pages/ProductCostingToolPage.tsx` | 短表、应用补全、计算按钮 |
| `apps/web/src/components/costing/CostDashboard.tsx` | 未计算态 |
| `apps/web/src/components/costing/BomLinesPanel.tsx` | 未匹配强调本单补价 |

---

### Task 1: Schema 0081

**Files:**
- Modify: `packages/db/src/schema/product-costing.ts`
- Create: `packages/db/drizzle/0081_costing_facts_cost_snapshot.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

**Produces:** `costingProjects.carcassThicknessMm`, `drawerBottomThicknessMm`, `hardwareFacts` (jsonb), `costComputedAt`, `costSummary` (jsonb)

- [ ] **Step 1: 写迁移**

```sql
ALTER TABLE "costing_projects"
  ADD COLUMN IF NOT EXISTS "carcass_thickness_mm" integer,
  ADD COLUMN IF NOT EXISTS "drawer_bottom_thickness_mm" integer,
  ADD COLUMN IF NOT EXISTS "hardware_facts" jsonb,
  ADD COLUMN IF NOT EXISTS "cost_computed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "cost_summary" jsonb;
```

journal 追加：`"idx": 83`, `"tag": "0081_costing_facts_cost_snapshot"`。

- [ ] **Step 2: Drizzle 列**

`costingProjects` 增加：

```ts
carcassThicknessMm: integer('carcass_thickness_mm'),
drawerBottomThicknessMm: integer('drawer_bottom_thickness_mm'),
hardwareFacts: jsonb('hardware_facts').$type<Array<{ name: string; spec: string; qty: number }>>(),
costComputedAt: timestamp('cost_computed_at', { withTimezone: true }),
costSummary: jsonb('cost_summary'),
```

- [ ] **Step 3: Commit** `feat(costing): add facts and cost snapshot columns`

---

### Task 2: 短表五金纯函数

**Files:**
- Create: `apps/web/server/lib/product-costing/hardware-facts.ts`
- Test: `apps/web/server/lib/product-costing/hardware-facts.test.ts`

**Produces:**

```ts
export const HARDWARE_FACT_NAMES = ['抽屉滑轨', '拉手', '防倾倒配件'] as const;
export type HardwareFact = { name: (typeof HARDWARE_FACT_NAMES)[number]; spec: string; qty: number };
export function parseHardwareFacts(raw: unknown): HardwareFact[];
export function upsertHardwareFacts(lines: CostingBomLineDraft[], facts: HardwareFact[]): CostingBomLineDraft[];
```

- [ ] **Step 1: 失败测试**

```ts
it('drops empty qty and unknown names', () => {
  assert.deepEqual(
    parseHardwareFacts([
      { name: '抽屉滑轨', spec: '12寸', qty: 6 },
      { name: '拉手', spec: '', qty: 0 },
      { name: '螺丝', spec: '', qty: 4 },
    ]),
    [{ name: '抽屉滑轨', spec: '12寸', qty: 6 }],
  );
});

it('upserts hardware without inventing empty facts', () => {
  const lines = upsertHardwareFacts(
    [{ category: '五金', materialName: '抽屉滑轨', spec: '', unit: '套', qtyNet: 0, lossRate: 0, sourceRef: '', confidence: 'low', origin: 'template', notes: '' }],
    [{ name: '抽屉滑轨', spec: '12寸', qty: 6 }],
  );
  assert.equal(lines[0]?.qtyNet, 6);
  assert.match(lines[0]?.notes ?? '', /人工补全/);
});
```

别名：`滚珠滑轨`→`抽屉滑轨`，`金属防倾倒装置`→`防倾倒配件`（用 `canonicalMaterialName`）。qty≤0 或 name 不在三件套则跳过（不造行）。

- [ ] **Step 2: 实现并跑测** `pnpm exec tsx --test server/lib/product-costing/hardware-facts.test.ts`

- [ ] **Step 3: Commit** `feat(costing): parse and upsert hardware facts`

---

### Task 3: 类目门控 + 短表厚度

**Files:**
- Modify: `apps/web/server/lib/product-costing/enrich-bom-from-facts.ts`
- Modify: `apps/web/server/lib/product-costing/enrich-bom-from-facts.test.ts`

**Produces:** `ProductFacts` 增加 `carcassThicknessMm?: number | null; drawerBottomThicknessMm?: number | null`。`isChestCategory(category)` 为斗柜/床头柜。仅 chest 才 `upsertRail` 落地/前/背拉条并取消底板。书桌有外形时仍可补桌面/侧板尺寸，但结果中不得出现 `落地拉条`。

短表厚度：若 `facts.carcassThicknessMm` 在 12–25，覆盖推断箱体厚；若 `facts.drawerBottomThicknessMm` 在 3–12，覆盖抽底厚。

- [ ] **Step 1: 测试**

```ts
it('does not add floor rails for desk', () => {
  const result = enrichBomFromProductFacts(
    [line({ materialName: '桌面' }), line({ materialName: '侧板' })],
    { category: '书桌', overallSize: { widthMm: 1200, depthMm: 600, heightMm: 750 }, drawerCount: 2 },
  );
  assert.equal(result.some((row) => row.materialName === '落地拉条'), false);
});

it('uses short-form carcass thickness', () => {
  const result = enrichBomFromProductFacts(
    [line({ materialName: '侧板' })],
    { category: '斗柜', overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 }, drawerCount: 6, carcassThicknessMm: 18 },
  );
  assert.match(result.find((row) => row.materialName === '侧板')?.spec ?? '', /18mm/);
});
```

保留现有 6 抽公式断言（抽侧 `350×` 且宽=抽面高-60）。

- [ ] **Step 2: 实现门控后跑测**

- [ ] **Step 3: Commit** `feat(costing): gate carcass rails by category`

---

### Task 4: apply-facts 纯函数 + 计算闸门

**Files:**
- Create: `apps/web/server/lib/product-costing/apply-facts.ts`
- Test: `apps/web/server/lib/product-costing/apply-facts.test.ts`
- Create: `apps/web/server/lib/product-costing/compute-gate.ts`
- Test: `apps/web/server/lib/product-costing/compute-gate.test.ts`

**Produces:**

```ts
export function applyFactsToLines(
  lines: CostingBomLineDraft[],
  facts: ProductFacts & { hardwareFacts?: HardwareFact[] },
): CostingBomLineDraft[];
// = finalize/template already elsewhere; here: enrichBomFromProductFacts then upsertHardwareFacts

export type ComputeBlocker = { materialName: string; reason: 'missing_price' | 'missing_qty' };
export function listComputeBlockers(
  lines: Array<{ materialName: string; qtyNet: number; effectiveUnitPrice: number | null }>,
): ComputeBlocker[];
```

闸门：每行 `qtyNet>0` 且 `effectiveUnitPrice != null`，否则列入 blockers。空清单也视为不可计算（`reason: 'missing_qty'` 一条名为「无材料行」）。

- [ ] **Step 1: 写测并实现**

- [ ] **Step 2: Commit** `feat(costing): apply-facts pipeline and compute gate`

---

### Task 5: Service 快照、apply、compute

**Files:**
- Modify: `apps/web/server/lib/product-costing/service.ts`
- Modify: `apps/web/server/lib/product-costing/service.test.ts`（闸门与 override 不写价目——纯函数已覆盖；service 测 `clearCostSnapshot` 可只测 helper）
- Modify: `apps/web/server/lib/product-costing/extract-runner.ts`（`applyTemplateAndFinish` 传入 thickness + hardwareFacts，完成后 `costComputedAt=null`）
- Modify: `apps/web/server/lib/product-costing/export-costing.ts` + test

**Produces:**

```ts
export async function clearCostSnapshot(projectId: string): Promise<void>;
export async function applyCostingFacts(projectId: string): Promise<NonNullable<Awaited<ReturnType<typeof getCostingProject>>>>;
export async function computeCostingProject(projectId: string): Promise<
  | { ok: true; project: NonNullable<Awaited<ReturnType<typeof getCostingProject>>> }
  | { ok: false; blockers: ComputeBlocker[] }
>;
```

`getCostingProject`：

- 仍 `calculateCostingLines` 更新 match/库价（确认清单需要）。
- 返回 `summary: project.costSummary ?? emptySummary`（全 0、missing 按当前行现算的 missing 计数可放在 `computeReady` 辅助字段）。
- 增加：`carcassThicknessMm`, `drawerBottomThicknessMm`, `hardwareFacts`, `costComputedAt`, `costStale: !costComputedAt`, `computeBlockers: listComputeBlockers(calculated.lines)`。
- **看板金额不得用现算 summary 覆盖快照。** 行上 `effectiveUnitPrice`/`lineAmount` 仍可现算，方便填补价。

`emptySummary`：`materialAmount/processAmount/feeAmount/totalAmount=0`，`byCategory=[]`，`feeItems=[]`，`missingPriceCount/missingQtyCount` 用现算（让 UI 知道还缺什么）。

失效：`updateCostingProject`、`createBomLine`、`updateBomLine`、`deleteBomLine`、`replaceBomLines`、`applyCostingFacts`、extract finish 都 `clearCostSnapshot`。

`applyCostingFacts`：读项目短表 + 全部 BOM 行转 draft → `applyFactsToLines` → 删除非 `isManual` 行再插入（与 extract finish 相同，保留手工行与其 override）。若担心冲掉已匹配行，改为：按 `canonicalMaterialName` 更新已有非手工行的 spec/qty/notes，新结构件/五金 insert；手工行不动。**采用后一种，避免丢掉本单补价。** 名称仍为标准件的手工行：若短表指定了同名五金，用量/规格以短表为准，**保留 unitPriceOverride**。

`computeCostingProject`：calculate → blockers 非空则 `{ok:false}`；否则 `cost_summary=summary`（完整 `CostSummary` JSON）、`cost_computed_at=now()`。

Export：`costStale` 或无快照时，汇总 sheet 第一行写「尚未计算成本」，金额列留空；清单 sheet 照常（单价可空）。

- [ ] **Step 1: 实现失效 helper + GET 行为测（可用纯函数测 summary 选择）**

```ts
export function resolveDisplaySummary(opts: {
  snapshot: CostSummary | null;
  live: CostSummary;
}): { summary: CostSummary; costStale: boolean } {
  if (!opts.snapshot) {
    return { summary: { ...opts.live, materialAmount: 0, processAmount: 0, feeAmount: 0, totalAmount: 0, byCategory: [], feeItems: [] }, costStale: true };
  }
  return { summary: opts.snapshot, costStale: false };
}
```

保留 live 的 `missingPriceCount`/`missingQtyCount` 到返回顶层 `computeBlockers`，不要写进未计算看板的 total。

- [ ] **Step 2: Commit** `feat(costing): snapshot cost and apply-facts service`

---

### Task 6: HTTP + api client

**Files:**
- Modify: `apps/web/server/routes/product-costing.ts`
- Modify: `apps/web/src/lib/api.ts`

PATCH 增加可选：`carcassThicknessMm`（null 或 8–40 整数）、`drawerBottomThicknessMm`（null 或 3–18）、`hardwareFacts`。非法 400。PATCH **只存短表并 clear snapshot，不改 BOM**。

```
POST /api/procurement/costing/projects/:id/apply-facts  → applyCostingFacts，200 详情
POST /api/procurement/costing/projects/:id/compute → ok true 200 详情；false 400 `{ message, blockers }`
```

Client：

```ts
applyCostingFacts: (id) => request<CostingProjectDetail>(`/api/procurement/costing/projects/${id}/apply-facts`, { method: 'POST' }),
computeCostingProject: (id) => request<CostingProjectDetail>(`/api/procurement/costing/projects/${id}/compute`, { method: 'POST' }),
```

`CostingProjectDetail` 补短表字段、`costComputedAt: string | null`、`costStale: boolean`、`computeBlockers: Array<{ materialName: string; reason: string }>`。`summary` 为快照或空金额。

- [ ] **Step 1: 实现路由与类型**

- [ ] **Step 2: Commit** `feat(costing): apply-facts and compute routes`

---

### Task 7: 核算页 UI

**Files:**
- Modify: `apps/web/src/pages/ProductCostingToolPage.tsx`
- Modify: `apps/web/src/components/costing/CostDashboard.tsx`
- Modify: `apps/web/src/components/costing/BomLinesPanel.tsx`

结构补全卡片（品类/结构/抽屉/基材已有）：加箱体板厚、抽底板厚；三行五金（名称只读、规格、数量）。按钮「应用补全」→ `applyCostingFacts`。主按钮「计算成本」：`computeBlockers.length>0` 时 disabled，title 列出缺价/缺用量。

看板：`costStale` 时标题「尚未计算成本」，金额显示 `—`，不把 live total 当正式成本。已计算则用 `summary` 快照。

BomLinesPanel：未匹配且无 override 的单价列 placeholder「本单补价」；高亮保留。

- [ ] **Step 1: UI**

- [ ] **Step 2: Commit** `feat(costing): facts form and compute gate UI`

---

### Task 8: 验收对齐

**Files:** 已有 `carcass-cut-rules.test.ts`、`enrich-bom-from-facts.test.ts`

核对 spec §11：

1. 斗柜 6 抽深 400：抽侧长 350、抽侧宽=抽面高-60、抽底宽=抽面宽-45、前拉条 2、无底板、顶板长=柜宽 — 现网测试已覆盖，门控后仍通过。
2. 短表五金 upsert — Task 2。
3. 缺价不能 compute — Task 4。
4. override 不写价目 — 无新写价目代码。
5. 改用量清快照 — Task 5。
6. 书桌无落地拉条 — Task 3。

跑：

```
cd apps/web
pnpm exec tsx --test server/lib/product-costing/hardware-facts.test.ts
pnpm exec tsx --test server/lib/product-costing/enrich-bom-from-facts.test.ts
pnpm exec tsx --test server/lib/product-costing/apply-facts.test.ts
pnpm exec tsx --test server/lib/product-costing/compute-gate.test.ts
pnpm exec tsx --test server/lib/product-costing/carcass-cut-rules.test.ts
pnpm exec tsx --test server/lib/product-costing/export-costing.test.ts
pnpm exec tsx --test server/lib/product-costing/service.test.ts
```

- [ ] **Step 1: 全绿**
- [ ] **Step 2: Commit 若有修复**

---

## Spec coverage

| Spec | Task |
|------|------|
| §3 三步流程 / 看板快照 | 5, 7 |
| §4 短表 | 1, 2, 6, 7 |
| §5 斗柜公式 / 书桌不套落地 | 3（公式已在 carcass-cut-rules） |
| §6 未匹配本单补价、不写回价目 | 4, 7 |
| §7 计算闸门 | 4, 5, 6 |
| §8 列 | 1 |
| §9 API | 6 |
| §11 验收 | 8 |
| 解析后再应用短表 | 5 extract-runner |
