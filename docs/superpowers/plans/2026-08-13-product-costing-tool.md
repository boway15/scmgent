# 产品成本核算工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 采购管理下交付单页「产品成本核算」工具：共用价目、上传打样 PPT、AI 拆清单、现算材料成本；菜单不再 404。

**Architecture:** 从 `feature/product-costing-bom-m1` **拷贝**预处理与 Dify 调用（不要整支 rebase，0069 号与 cron 修复已在 main 冲突）。新迁移 `0075` 幂等建表+加列。工具页一条路由；成本现算不落快照。Dify 只收筛过的压缩页图，每批 1 页，成功批立即落库。

**Tech Stack:** Drizzle/Postgres、Hono、React Query、recharts、Dify Workflow、Node `tsx --test`。

**Spec:** `docs/superpowers/specs/2026-08-13-product-costing-tool-design.md`

## Global Constraints

- 不读写 `bom` / `material_requirements` / `skus.unit_cost`
- 只算材料；人民币；`qty_gross` 仅后端：`round(qty_net * (1 + loss_rate), 4)`
- 附件根目录 `COSTING_DATA_DIR`；禁止把 PPT/PDF 二进制传给 Dify
- `COSTING_EXTRACT_BATCH_SIZE` 默认 **1**；`DIFY_WORKFLOW_TIMEOUT_MS` 默认 **300000**
- 上传上限 **80MB**、**20 页**；扩展名仅 `.pptx` / `.pdf`
- 菜单码 `procurement.costing`，路径 `/procurement/costing`；`super_admin` / `purchaser` 可写，`viewer` 只读
- 不做确认清单闸门；无独立列表页
- 中文 UI；标识符英文 camelCase / snake_case 按仓库习惯
- 测试：`cd apps/web && pnpm exec tsx --test <file>`
- 提交信息英文 `feat(costing):` / `fix(costing):`；Windows 用 `git commit -m "..."`（不要 bash heredoc）

---

## File Map

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema/product-costing.ts` | 表 + enum |
| `packages/db/drizzle/0075_product_costing_tool.sql` | 幂等迁移 + 菜单 |
| `packages/db/drizzle/meta/_journal.json` | 登记 0075 |
| `packages/db/src/schema/index.ts` / `packages/db/src/seed.ts` | export 与菜单种子 |
| `apps/web/server/lib/product-costing/types.ts` | 共享类型 |
| `apps/web/server/lib/product-costing/bom-math.ts` | 毛用量、normalize AI 行 |
| `apps/web/server/lib/product-costing/match-price.ts` | 价目匹配 |
| `apps/web/server/lib/product-costing/cost-calc.ts` | 行金额 + 看板汇总 |
| `apps/web/server/lib/product-costing/page-classify.ts` | 页类型 + 是否送 Dify |
| `apps/web/server/lib/product-costing/category-template.ts` | 品类补结构件空行 |
| `apps/web/server/lib/product-costing/storage.ts` 等 preprocess | 从 M1 拷贝 |
| `apps/web/server/lib/product-costing/price-book.ts` | 价目 CRUD / 导入 |
| `apps/web/server/lib/product-costing/service.ts` | 产品/清单/详情现算 |
| `apps/web/server/lib/product-costing/extract-runner.ts` | 异步拆解 |
| `apps/web/server/lib/product-costing/export-costing.ts` | 两 sheet xlsx |
| `apps/web/server/routes/product-costing.ts` | HTTP |
| `apps/web/server/integrations/dify.ts` | `isCostingBomWorkflowEnabled`；超时默认 300s |
| `apps/web/src/pages/ProductCostingToolPage.tsx` | 单页工具 |
| `apps/web/src/components/costing/*` | 价目表、清单、看板 |
| `apps/web/src/lib/api.ts` / `router.tsx` | client + 路由 |
| `docker-compose.yml` | `COSTING_DATA_DIR`、超时、batch=1、volume |
| `docs/dify/workflows/product-costing-bom-extract.yml` | 从 M1 拷贝并改 prompt |

不要创建 `ProductCostingListPage.tsx` / `ProductCostingDetailPage.tsx`。不要改已执行的 `0069_product_costing.sql`（main 上不存在该文件即可）。

---

### Task 1: Schema、迁移、菜单

**Files:**
- Create: `packages/db/src/schema/product-costing.ts`
- Create: `packages/db/drizzle/0075_product_costing_tool.sql`
- Modify: `packages/db/src/schema/index.ts`（加 `export * from './product-costing';`）
- Modify: `packages/db/src/seed.ts`（采购 children + 角色数组）
- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: Drizzle 表 `costingProjects`、`costingAttachments`、`costingExtractRuns`、`costingBomLines`、`materialPriceBook`

- [ ] **Step 1: 写 schema**

`packages/db/src/schema/product-costing.ts` 要点：

- `costingProjectStatusEnum` 值：`'draft' | 'extracting' | 'ready' | 'extract_failed'`。若库里仍有旧值，迁移会映射掉；Drizzle 只声明这四个（新库 CREATE TYPE 用这四个）。**若目标库已有旧 TYPE**（含 `bom_draft`），迁移用 `ADD VALUE 'ready'` 并 UPDATE，**不要 DROP TYPE**。此时 Drizzle enum 仍只写四个新值——旧行已更新后即可。
- `costing_projects`：无 `confirmed_bom_at`（新表不建该列；旧表可留列不用）。
- `costing_bom_lines` 增加：`origin varchar(20) default 'explicit'`、`priceBookId uuid`、`unitPriceOverride numeric(14,4)`、`matchStatus varchar(20) default 'unmatched'`。
- `material_price_book`：字段见 spec §7.4；`spec` 默认 `''`；`is_active` 默认 true。
- FK：`price_book_id` → `material_price_book.id` ON DELETE SET NULL。

从分支拷贝骨架再改：

```powershell
git show feature/product-costing-bom-m1:packages/db/src/schema/product-costing.ts
```

改 status enum 为四值；删 `confirmedBomAt`（schema 侧）；给 lines 加四列；追加 `materialPriceBook` 表与 relations。

- [ ] **Step 2: 写迁移 `0075_product_costing_tool.sql`**

必须全部 `IF NOT EXISTS` / `WHERE NOT EXISTS`。顺序：

1. 若 TYPE `costing_project_status` 不存在，则 `CREATE TYPE` 为 `draft, extracting, ready, extract_failed`。
2. 若 TYPE 已存在，则：

```sql
DO $$ BEGIN
  ALTER TYPE "public"."costing_project_status" ADD VALUE IF NOT EXISTS 'ready';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
UPDATE "costing_projects" SET "status" = 'ready'
WHERE "status"::text IN ('bom_draft', 'bom_ready', 'costed');
```

3. 复制 M1 的四张表 `CREATE TABLE IF NOT EXISTS`（见 `git show feature/product-costing-bom-m1:packages/db/drizzle/0069_product_costing.sql`）。
4. `ALTER TABLE costing_bom_lines ADD COLUMN IF NOT EXISTS "origin" varchar(20) DEFAULT 'explicit' NOT NULL;` 同样加 `price_book_id`、`unit_price_override`、`match_status`。
5. 建 `material_price_book` + unique index：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "material_price_book_name_spec_unit_uidx"
  ON "material_price_book" (lower("material_name"), lower("spec"), lower("unit"));
```

6. 菜单 + role_menus 与 M1 相同（`procurement.costing`，角色 `super_admin`、`purchaser`、`viewer`）。

- [ ] **Step 3: journal**

在 `_journal.json` 的 `entries` 末尾追加（idx 77，tag `0075_product_costing_tool`）。

- [ ] **Step 4: seed.ts**

采购 `children` 增加：

```ts
{
  code: 'procurement.costing',
  name: '产品成本核算',
  path: '/procurement/costing',
  sortOrder: 3,
  isLeaf: true,
},
```

`ROLE_MENU_CODES` 的 `super_admin`、`purchaser`、`viewer` 数组加入 `'procurement.costing'`。

- [ ] **Step 5: index export + migrate**

`packages/db/src/schema/index.ts` 增加 export。

Run: `pnpm db:migrate`  
Expected: 无报错；`\dt costing*` 与 `material_price_book` 存在；菜单 `procurement.costing` 存在。

- [ ] **Step 6: Commit**

```powershell
git add packages/db/src/schema/product-costing.ts packages/db/src/schema/index.ts packages/db/drizzle/0075_product_costing_tool.sql packages/db/drizzle/meta/_journal.json packages/db/src/seed.ts
git commit -m "feat(db): add product costing tool schema and menu"
```

---

### Task 2: 纯函数 — 匹配、核算、分页、模板

**Files:**
- Create: `apps/web/server/lib/product-costing/types.ts`
- Create: `apps/web/server/lib/product-costing/bom-math.ts` + `bom-math.test.ts`
- Create: `apps/web/server/lib/product-costing/match-price.ts` + `match-price.test.ts`
- Create: `apps/web/server/lib/product-costing/cost-calc.ts` + `cost-calc.test.ts`
- Create: `apps/web/server/lib/product-costing/page-classify.ts` + `page-classify.test.ts`
- Create: `apps/web/server/lib/product-costing/category-template.ts` + `category-template.test.ts`

**Interfaces:**
- Produces 以下签名，后续任务必须原样使用：

```ts
export type BomConfidence = 'high' | 'medium' | 'low';
export type BomOrigin = 'explicit' | 'template';
export type MatchStatus = 'exact' | 'name_only' | 'unmatched';
export type PageKind = 'bom_list' | 'cmf' | 'size' | 'explosion' | 'notes' | 'cover' | 'render';

export type CostingBomLineDraft = {
  category: string;
  materialName: string;
  spec: string;
  unit: string;
  qtyNet: number;
  lossRate: number;
  sourceRef: string;
  confidence: BomConfidence;
  origin: BomOrigin;
  notes: string;
};

export function calcQtyGross(qtyNet: number, lossRate: number): number;
export function normalizeAiLine(raw: unknown): CostingBomLineDraft | null;

export type PriceBookEntry = {
  id: string;
  materialName: string;
  spec: string;
  unit: string;
};

export function matchPriceBook(
  line: { materialName: string; spec: string; unit: string },
  book: PriceBookEntry[],
): { status: MatchStatus; priceBookId: string | null; hint?: string };

export type CostLineInput = {
  qtyNet: number;
  lossRate: number;
  unitPriceOverride: number | null;
  bookUnitPrice: number | null;
  category: string;
};

export type CostSummary = {
  totalAmount: number;
  byCategory: Array<{ category: string; amount: number; share: number }>;
  missingPriceCount: number;
  missingQtyCount: number;
  lines: Array<{ qtyGross: number; effectiveUnitPrice: number | null; lineAmount: number }>;
};

export function calcCostSummary(lines: CostLineInput[]): CostSummary;

export function classifyPage(pageNo: number, text: string): PageKind;
export function shouldSendPageToDify(kind: PageKind, text: string): boolean;

export function applyCategoryTemplate(
  category: string | null | undefined,
  lines: CostingBomLineDraft[],
): CostingBomLineDraft[];
```

- [ ] **Step 1: 写失败测试 `bom-math.test.ts`**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcQtyGross, normalizeAiLine } from './bom-math.js';

describe('bom-math', () => {
  it('calcQtyGross rounds 4 decimals', () => {
    assert.equal(calcQtyGross(1, 0.08), 1.08);
    assert.equal(calcQtyGross(2.5, 0.1), 2.75);
  });

  it('normalizeAiLine accepts qty 0 template rows and origin', () => {
    const line = normalizeAiLine({
      category: '板材',
      material_name: '侧板',
      spec: '',
      unit: '块',
      qty_net: 0,
      loss_rate: 0,
      source_ref: '',
      confidence: 'low',
      origin: 'template',
    });
    assert.equal(line?.qtyNet, 0);
    assert.equal(line?.origin, 'template');
  });

  it('normalizeAiLine infers explicit when source_ref present', () => {
    const line = normalizeAiLine({
      material_name: '滑轨',
      unit: '副',
      qty_net: 2,
      confidence: 'high',
      source_ref: 'p4',
    });
    assert.equal(line?.origin, 'explicit');
  });

  it('normalizeAiLine maps unknown category to 其他', () => {
    const line = normalizeAiLine({
      category: '乱七八糟',
      material_name: 'x',
      unit: '个',
      qty_net: 1,
      confidence: 'medium',
    });
    assert.equal(line?.category, '其他');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && pnpm exec tsx --test server/lib/product-costing/bom-math.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `types.ts` + `bom-math.ts`**

`calcQtyGross`：`Math.round(qtyNet * (1 + lossRate) * 10000) / 10000`。

`normalizeAiLine`：

- 允许 `qtyNet === 0`；拒绝 `qtyNet < 0` 或非数。
- `CATEGORIES = ['板材','五金','表面工艺','包装','其他']`，不在集合则 `'其他'`。
- `origin`：显式 `explicit|template`；否则 `source_ref` 非空 → `explicit`，否则 `template`。
- **不要**实现 `canConfirmBom`。

- [ ] **Step 4: 测试通过**

Run: `cd apps/web && pnpm exec tsx --test server/lib/product-costing/bom-math.test.ts`  
Expected: PASS

- [ ] **Step 5: `match-price.test.ts` + 实现**

测试用例：

1. 名+规格+单位全等（忽略大小写与首尾空格）→ `exact`  
2. 仅名+单位相同且 book 里只有 1 条 → `name_only`  
3. 同名同单位多条 → `unmatched`，`hint` 含「规格待确认」  
4. 无候选 → `unmatched`，`priceBookId` null  

比较前：`s.trim().toLowerCase()`；`spec` 空与 `''` 相同。

- [ ] **Step 6: `cost-calc.test.ts` + 实现**

```ts
it('uses override over book price', () => {
  const s = calcCostSummary([
    { qtyNet: 2, lossRate: 0, unitPriceOverride: 10, bookUnitPrice: 99, category: '五金' },
  ]);
  assert.equal(s.lines[0].lineAmount, 20);
  assert.equal(s.totalAmount, 20);
});

it('counts missing price and qty; zero total share is 0', () => {
  const s = calcCostSummary([
    { qtyNet: 0, lossRate: 0, unitPriceOverride: null, bookUnitPrice: null, category: '板材' },
  ]);
  assert.equal(s.missingQtyCount, 1);
  assert.equal(s.missingPriceCount, 1);
  assert.equal(s.totalAmount, 0);
  assert.equal(s.byCategory[0].share, 0);
});
```

规则：`effective = override ?? book`；无单价或金额按 0；`missingPriceCount` 在 `effective == null` 时 +1；`missingQtyCount` 在 `qtyNet === 0` 时 +1；`share = total ? amount/total : 0`。按 category 聚合 `byCategory`。

- [ ] **Step 7: `page-classify.test.ts` + 实现**

按 spec §5.3 **先匹配先得** 顺序：`bom_list` → `cmf` → `size` → `explosion` → `notes` → `cover`（pageNo===1 或仅品名部门）→ `render`。

材料关键词常量（包含即可）：`板`、`密度板`、`颗粒板`、`实木`、`五金`、`滑轨`、`拉手`、`封边`、`mm`、`插排`、`防倾倒`（大小写不敏感）。

`shouldSendPageToDify`：`notes|explosion|size|cmf|bom_list` 为 true；`cover|render` 仅当文本命中材料关键词为 true。

用例：爆炸图页、纯「产品方案」短文、封面第 1 页、CMF「材质选择：密度板」。

- [ ] **Step 8: `category-template.test.ts` + 实现**

斗柜缺失「侧板」时补一行：`origin='template'`、`confidence='low'`、`qtyNet=0`、`notes='用量待补'`、`category='板材'`、`unit='块'`。  
已有名称包含「侧板」则不补。  
`category` 空或其他 → 不补。  
书桌必有：桌面、侧板、抽盒。  
**不**补五金。

名称匹配：`line.materialName.includes(slotName)`。

- [ ] **Step 9: Commit**

```powershell
git add apps/web/server/lib/product-costing
git commit -m "feat(costing): add match, cost, page classify, and template helpers"
```

---

### Task 3: 从 M1 拷贝存储与预处理

**Files:**
- Create（从分支检出，不要改业务语义）：  
  `storage.ts`、`storage.test.ts`、`project-no.ts`、`merge-lines.ts`、`merge-lines.test.ts`、`parse-workflow-output.ts`、`parse-workflow-output.test.ts`、`preprocess/*`

**Interfaces:**
- Consumes: 无  
- Produces: `writeProjectFile`、`resolveStoragePath`、`nextCostingProjectNo`、`mergeBomLines`、`parseWorkflowLines`、`preprocessDesignFile`  
- `parseWorkflowLines` 必须改成走新的 `normalizeAiLine`（含 origin）

- [ ] **Step 1: 检出 M1 文件**

```powershell
git checkout feature/product-costing-bom-m1 -- `
  apps/web/server/lib/product-costing/storage.ts `
  apps/web/server/lib/product-costing/storage.test.ts `
  apps/web/server/lib/product-costing/project-no.ts `
  apps/web/server/lib/product-costing/merge-lines.ts `
  apps/web/server/lib/product-costing/merge-lines.test.ts `
  apps/web/server/lib/product-costing/parse-workflow-output.ts `
  apps/web/server/lib/product-costing/parse-workflow-output.test.ts `
  apps/web/server/lib/product-costing/preprocess
```

若 `merge-lines.ts` 的 draft 类型缺 `origin`，合并后行补 `origin: line.origin ?? 'explicit'`。

- [ ] **Step 2: 跑拷贝来的测试**

Run:

```
cd apps/web && pnpm exec tsx --test server/lib/product-costing/storage.test.ts server/lib/product-costing/merge-lines.test.ts server/lib/product-costing/parse-workflow-output.test.ts server/lib/product-costing/preprocess/pptx-text.test.ts server/lib/product-costing/preprocess/preprocess.test.ts
```

Expected: PASS。失败则先改类型对齐，不要改预处理算法。

- [ ] **Step 3: Commit**

```powershell
git add apps/web/server/lib/product-costing
git commit -m "feat(costing): port M1 storage and PPTX preprocess"
```

---

### Task 4: 价目 API

**Files:**
- Create: `apps/web/server/lib/product-costing/price-book.ts`
- Create: `apps/web/server/lib/product-costing/price-book-import.ts` + `price-book-import.test.ts`
- Create: `apps/web/server/routes/product-costing.ts`（本任务只挂价目路由）
- Modify: `apps/web/server/index.ts`（`app.route('/api', productCostingRoutes)`）
- Modify: `apps/web/server/integrations/dify.ts`（本任务只加 `isCostingBomWorkflowEnabled`，超时默认改 300000）

**Interfaces:**
- Produces:

```ts
export async function listPriceBook(opts: {
  q?: string;
  category?: string;
  activeOnly?: boolean;
}): Promise<MaterialPriceBookRow[]>;

export async function createPriceBookItem(input: {
  category: string;
  materialName: string;
  spec?: string;
  unit: string;
  unitPrice: number;
  notes?: string;
}): Promise<MaterialPriceBookRow>;

export async function updatePriceBookItem(id: string, patch: Partial<{
  category: string; materialName: string; spec: string; unit: string; unitPrice: number; notes: string;
}>): Promise<MaterialPriceBookRow | null>;

export async function disablePriceBookItem(id: string): Promise<boolean>;

export function parsePriceBookSheet(aoa: unknown[][]): Array<{
  category: string; materialName: string; spec: string; unit: string; unitPrice: number; notes: string;
}>;
```

导入列（第 1 行表头，允许同义）：大类/`category`、材料名称/`material_name`、规格/`spec`、单位/`unit`、单价/`unit_price`、备注/`notes`。按键 upsert，不删未出现行。单价 `< 0` 的行跳过并计入 errors。

- [ ] **Step 1: `price-book-import.test.ts` 失败用例**（表头映射 + 空规格当 `''` + 负单价跳过）
- [ ] **Step 2: 实现 parse + upsert 函数，测试通过**
- [ ] **Step 3: 路由**

前缀与 spec 一致：

- `GET /procurement/costing/price-book`
- `POST /procurement/costing/price-book`
- `PATCH /procurement/costing/price-book/:id`
- `POST /procurement/costing/price-book/:id/disable`
- `POST /procurement/costing/price-book/import` multipart 字段 `file`

全部 `requireMenu('procurement.costing')`；写操作用 `requireWrite()`。唯一键冲突返回 409，文案「同名规格单位已存在」。

`dify.ts`：增加

```ts
export function isCostingBomWorkflowEnabled(): boolean {
  return isDifyKeyConfigured('DIFY_API_KEY_COSTING_BOM');
}
```

将文件顶部 `WORKFLOW_TIMEOUT_MS` 默认改为 `300_000`。

`index.ts` 在 `procurementListRoutes` 旁 `app.route('/api', productCostingRoutes)`。

- [ ] **Step 4: Commit**

```powershell
git commit -m "feat(costing): add shared material price book API"
```

---

### Task 5: 产品 / 清单 / 现算详情 API

**Files:**
- Create: `apps/web/server/lib/product-costing/service.ts`（可从 M1 拷贝后改）
- Modify: `apps/web/server/routes/product-costing.ts`

**Interfaces:**
- Consumes: `calcQtyGross`、`matchPriceBook`、`calcCostSummary`、`applyCategoryTemplate`
- Produces:

```ts
export async function listCostingProjects(): Promise<Array<{
  id: string; name: string; status: string; updatedAt: Date; category: string | null;
}>>; // 按 updatedAt desc，limit 20

export async function createCostingProject(input: {
  name: string; category?: string; userId: string;
}): Promise<{ id: string; projectNo: string; name: string; status: 'draft' }>;

export async function getCostingProject(id: string): Promise<null | {
  id: string;
  projectNo: string;
  name: string;
  category: string | null;
  status: string;
  extractError: string | null;
  lines: Array<{
    id: string; lineNo: number; category: string; materialName: string; spec: string | null;
    unit: string; qtyNet: string; lossRate: string; qtyGross: string;
    origin: string; confidence: string; matchStatus: string;
    unitPriceOverride: string | null; priceBookId: string | null;
    effectiveUnitPrice: number | null; lineAmount: number;
    sourceRef: string | null; notes: string | null; isManual: boolean;
  }>;
  summary: CostSummary;
  pageCount: number;
}>;

export async function saveSourceAttachment(opts: {
  projectId: string; fileName: string; contentType: string; buffer: Buffer;
}): Promise<void>; // 校验 80MB、pptx/pdf；页数在 extract 时再拦 20 页
```

**不要**实现 `confirmBom`。  
`GET` 详情时：对无 override 的行用当前价目 `matchPriceBook` + book 单价现算（可写回 `match_status`/`price_book_id`，避免每次只读算）。  
保存行时重算 `qty_gross`，`is_manual=true`。

路由（spec §8.2–8.3，除 extract/export 外本任务做完）：

- `GET/POST /procurement/costing/projects`
- `GET/PATCH/DELETE /procurement/costing/projects/:id`
- `POST /procurement/costing/projects/:id/attachments`
- `GET/PUT/POST /procurement/costing/projects/:id/bom-lines`
- `PATCH/DELETE /procurement/costing/projects/:id/bom-lines/:lineId`
- `GET /procurement/costing/status` → `{ difyEnabled, preprocessMode }`

从 M1 `service.ts` 拷贝 CRUD 后：列表改为 20 条无分页；status 写入 `ready` 而非 `bom_draft`；详情拼 `summary`。

- [ ] **Step 1: 实现 service + 路由**
- [ ] **Step 2: 详情 GET 必须调用 `calcCostSummary`**

`getCostingProject` 把每行的 `qtyNet`/`lossRate`/`unitPriceOverride`/`bookUnitPrice`/`category` 填进 `CostLineInput[]`，返回的 `summary` 即该函数结果。不要另写一套金额公式。

- [ ] **Step 3: Commit**

```powershell
git commit -m "feat(costing): add project and BOM line APIs with live cost"
```

---

### Task 6: 单页工具 UI（先闭环手工清单）

**Files:**
- Create: `apps/web/src/pages/ProductCostingToolPage.tsx`
- Create: `apps/web/src/components/costing/PriceBookPanel.tsx`
- Create: `apps/web/src/components/costing/BomLinesPanel.tsx`
- Create: `apps/web/src/components/costing/CostDashboard.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: Task 4–5 API
- localStorage key：`costing.currentProjectId`

- [ ] **Step 1: `api.ts` 增加方法**（紧挨 `export const api` 内采购段）

类型与路径对齐 Task 4–5。至少：`listCostingPriceBook`、`createCostingPriceBookItem`、`updateCostingPriceBookItem`、`disableCostingPriceBookItem`、`importCostingPriceBook`、`listCostingProjects`、`createCostingProject`、`getCostingProject`、`patchCostingProject`、`deleteCostingProject`、`uploadCostingAttachment`、`saveCostingBomLines`、`createCostingBomLine`、`patchCostingBomLine`、`deleteCostingBomLine`、`getCostingStatus`。

上传用 `apiFetch` + `FormData`，不要 JSON。参考 `apps/web/src/lib/api.ts` 里采购列表 import。

- [ ] **Step 2: 路由**

`router.tsx` 在 `procurement/follow-up` 下增加：

```tsx
<Route path="procurement/costing" element={<ProductCostingToolPage />} />
```

- [ ] **Step 3: 页面结构**

`PageHeader` 标题「产品成本核算」。顶栏：产品 `<select>`（最近 20）+ outline「新建」+ 主按钮「解析」（本任务可先 disabled，直到 Task 7）+ 隐藏 file input「上传设计方案」。

空态文案：「新建产品并上传打样 PPT，或先维护价目、手工添加材料行。」

① `PriceBookPanel`：默认可折叠（`useState(true)` 折叠）。表格列：大类、名称、规格、单位、单价、备注、停用。outline「新增」「导入」。

② `BomLinesPanel`：按 `category` 分组。列见 spec §9。`low` / `unmatched` / `qtyNet==0` 行 `bg-highlight-warm`。改单元格失焦 PATCH。数字 `font-mono`。

③ `CostDashboard`：三张数字（总成本、缺价行、缺用量）+ recharts `PieChart`（`summary.byCategory`）+ 分类表。项目已有 `recharts`，用它，不要新依赖。

主按钮：仅顶栏「解析」`variant="default"`。价目新增/导入用 `outline`。

- [ ] **Step 4: 浏览器确认**

登录超级管理员，点「产品成本核算」不再 404；可建产品、加价目、手工加一行、看板金额 = 用量×单价。

- [ ] **Step 5: Commit**

```powershell
git commit -m "feat(costing): add single-page costing tool UI"
```

---

### Task 7: 解析流水线（筛页、压图、分批落库）

**Files:**
- Create: `apps/web/server/lib/product-costing/extract-runner.ts`（从 M1 拷贝后改）
- Create: `apps/web/server/lib/product-costing/compress-page-image.ts` + test（可对 1x1 PNG 返回空 base64）
- Modify: `apps/web/server/routes/product-costing.ts`（extract 端点）
- Modify: `apps/web/src/pages/ProductCostingToolPage.tsx`（轮询进度）
- Modify: `apps/web/src/lib/api.ts`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `classifyPage`、`shouldSendPageToDify`、`preprocessDesignFile`、`parseWorkflowLines`、`applyCategoryTemplate`、`matchPriceBook`、`calcQtyGross`、`runWorkflow('DIFY_API_KEY_COSTING_BOM')`
- `COSTING_EXTRACT_BATCH_SIZE` 默认 1

**分批落库（必须按 spec §5.4）：**

1. 预处理全部页；页数 > 20 则失败（run failed，中文「超过 20 页，请拆分或指定页范围」）。  
2. 过滤 `shouldSendPageToDify`。  
3. 无页范围的整单：第一批成功后才 `delete` 非 `is_manual` 行。第一批失败则原清单不动。  
4. 每批成功：按该批 `source_ref` 页码删除这些页上的非手工行，插入新行（origin/匹配已算）。  
5. 一批失败：`error_message` 含页码，如 `第 5 页 Dify 超时`；`extract_failed`；已写入行保留。  
6. 全部成功：`applyCategoryTemplate` 一次（对当前全部非手工行），补缺件，status=`ready`。模板行也跑匹配。  
7. `pages_json` 每项含 `page`、`page_type`、`text`、`image_base64`。1×1 或 <512 字节图 → `image_base64: ''`。  
8. 压缩：最长边 1280；转 JPEG；>400KB 则 quality 0.6。无 `sharp` 则用纯函数跳过缩放（测试可 mock），能读 PNG/JPEG 的可用现有依赖；**不要为压缩新增重依赖**。若无法压缩，仍送原图但继续分批 1 页。

进度推算（不改 run 表）：`batchTotal = ceil(filteredPages / BATCH_SIZE)`；`batchCurrent` 用内存计数，写入 `raw_response: { batchCurrent, batchTotal }` 每次批结束后 update run 行的 `raw_response`（该列已存在）。`GET .../extract/runs/:runId` 返回这些字段。

未配置 key：`POST extract` **503**，文案：「未配置 DIFY_API_KEY_COSTING_BOM，无法 AI 拆解；可手工维护清单」。

- [ ] **Step 1: `page-classify` 已覆盖筛选；给 extract 抽 `planExtractBatches(pages, batchSize)` 单测**

```ts
export function planExtractBatches<T>(pages: T[], batchSize: number): T[][];
```

默认 batchSize=`Math.max(1, Number(process.env.COSTING_EXTRACT_BATCH_SIZE ?? 1) || 1)`。

- [ ] **Step 2: 实现 runner + 路由**

`POST /procurement/costing/projects/:id/extract` body `{ pageFrom?, pageTo? }`  
`GET /procurement/costing/projects/:id/extract/runs/:runId`  
`GET /procurement/costing/projects/:id/pages/:pageNo` 鉴权读页图

从 M1 checkout `extract-runner.ts` 再改，不要整文件照抄 BATCH_SIZE=2 与整表替换逻辑。

- [ ] **Step 3: docker-compose.yml `web.environment` 增加**

```yaml
COSTING_DATA_DIR: /data/costing
COSTING_PREPROCESS_MODE: ${COSTING_PREPROCESS_MODE:-auto}
DIFY_WORKFLOW_TIMEOUT_MS: ${DIFY_WORKFLOW_TIMEOUT_MS:-300000}
COSTING_EXTRACT_BATCH_SIZE: ${COSTING_EXTRACT_BATCH_SIZE:-1}
```

`web.volumes` 增加 `- costingdata:/data/costing`；`volumes:` 根级增加 `costingdata:`。

- [ ] **Step 4: 前端**

「解析」启用：有当前产品且已上传。轮询 2s。`AiProgressBar` 文案「正在解析第 {batchCurrent}/{batchTotal} 批」。失败 `AiBanner` +「重试」调 extract（不带页范围）或带失败页。

- [ ] **Step 5: Commit**

```powershell
git commit -m "feat(costing): extract BOM in filtered one-page Dify batches"
```

---

### Task 8: 导出、Dify DSL、文档

**Files:**
- Create: `apps/web/server/lib/product-costing/export-costing.ts` + `export-costing.test.ts`
- Modify: `apps/web/server/routes/product-costing.ts`
- Create: `docs/dify/workflows/product-costing-bom-extract.yml` + `.md`（从 M1 拷贝后改）
- Modify: `apps/web/src` 工具页增加「导出」outline 按钮

**Interfaces:**
- `exportCostingXlsx(projectId: string): Promise<Buffer>`
- Sheet「材料清单」列：大类、名称、规格、单位、净用量、损耗、毛用量、生效单价、金额、来源、置信度、匹配状态
- Sheet「成本汇总」列：大类、金额、占比；末行总成本；再一行缺价行数、缺用量行数

用项目已有 `xlsx` 包（`XLSX.utils.aoa_to_sheet`），与 FOB 导出习惯一致。

- [ ] **Step 1: 导出单测（内存 aoa，不断言 zip 细节）**

```ts
export function buildCostingExportAoa(input: {
  lines: Array<{ category: string; materialName: string; spec: string; unit: string;
    qtyNet: number; lossRate: number; qtyGross: number; effectiveUnitPrice: number | null;
    lineAmount: number; origin: string; confidence: string; matchStatus: string }>;
  summary: CostSummary;
}): { list: unknown[][]; summary: unknown[][] };
```

- [ ] **Step 2: `GET /procurement/costing/projects/:id/export` 下载 xlsx**  
  `Content-Disposition: attachment; filename="costing-{projectNo}.xlsx"`

- [ ] **Step 3: Dify 文档**

从分支拷贝 yml/md。inputs 增加每页 `page_type`。Prompt 增加：

- 禁止编造未在图/文出现的五金  
- 结构件不确定时 `origin=template`、`qty_net=0`  
- 输出 `lines` JSON 数组，字段含 `origin`  
- 工作流超时需 ≥ 300s  

- [ ] **Step 4: 用 `d:\我的文档\bom测试\0416菱形斗柜6抽打样文件.pptx` 手工走一遍**（有 Dify key 时）

验收：效果图页不送；清单有分组；看板有数或缺价提示。

- [ ] **Step 5: Commit**

```powershell
git commit -m "feat(costing): export cost workbook and update Dify extract workflow"
```

---

## Spec coverage

| Spec | Task |
|------|------|
| 单页工具 / 无 404 / 菜单 | 1, 6 |
| 价目 CRUD + xlsx upsert | 4, 6 |
| 本单改价 / 现算 / 只算材料 | 2, 5, 6 |
| PPT 非 BOM、筛页、压图、batch=1、失败不覆盖 | 2, 7 |
| 品类模板空行 | 2, 7 |
| 匹配 exact/name_only/unmatched | 2, 5 |
| 导出两 sheet | 8 |
| Dify 不传整包、300s、DSL | 7, 8 |
| 80MB / 20 页 | 5 附件、7 页数 |
| 不读写 bom 表 | 全局 |
| 无确认闸门 | 5 不实现 confirmBom |

## 执行手递

Plan complete and saved to `docs/superpowers/plans/2026-08-13-product-costing-tool.md`. Two execution options:

**1. Subagent-Driven（推荐）** — 每任务新开子代理，任务间复查  
**2. Inline Execution** — 本会话按 plan 逐步实现  

Which approach?
