# 产品成本核算 M1（AI 拆清单）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在采购管理下交付「产品成本核算」M1：上传设计方案 → 多模态 AI 拆 BOM → 人审确认 → 导出清单 Excel。

**Architecture:** 独立 schema/router（不碰现有 `bom` 表）；附件与页图落本地卷；预处理在 scm-agent；推理经 `runWorkflow('DIFY_API_KEY_COSTING_BOM')` 异步跑批；前端列表+详情双 Tab。

**Tech Stack:** Drizzle/Postgres、Hono、React、Dify Workflow、PPT/PDF 预处理（LibreOffice/poppler 或可测的抽象层）、ExcelJS/现有 xlsx 导出习惯。

**Spec:** `docs/superpowers/specs/2026-08-07-product-costing-bom-design.md`

## Global Constraints

- 不读写 `bom` / `material_requirements`
- `qty_gross` 仅服务端计算：`qty_net * (1 + loss_rate)`
- 附件根目录：`COSTING_DATA_DIR`（默认与 Docker data 卷对齐）
- Dify 未配置时 extract 明确失败；手工 BOM + 导出仍可用
- 菜单码：`procurement.costing`；路径：`/procurement/costing`
- 中文 UI 文案；标识符英文 snake_case / camelCase 按仓库惯例

## File map

| 路径 | 职责 |
|------|------|
| `packages/db/src/schema/product-costing.ts` | 表与 enum |
| `packages/db/drizzle/0069_product_costing.sql` | 迁移 + 菜单/角色 |
| `apps/web/server/lib/product-costing/*` | 单号、毛用量、合并、校验、存储、预处理、extract 编排、导出 |
| `apps/web/server/routes/product-costing.ts` | HTTP API |
| `apps/web/server/integrations/dify.ts` | `isCostingBomWorkflowEnabled` |
| `apps/web/src/pages/ProductCosting*.tsx` | 列表/详情 |
| `apps/web/src/lib/api.ts` | client |
| `apps/web/src/router.tsx` / `packages/db/src/seed.ts` | 路由与种子菜单 |

---

### Task 1: Schema + 迁移 + 菜单

**Files:**
- Create: `packages/db/src/schema/product-costing.ts`
- Create: `packages/db/drizzle/0069_product_costing.sql`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/seed.ts`（`procurement.costing` 子菜单；`super_admin`/`purchaser`/`viewer` 授权，viewer 只读靠前端即可先同 follow_up）

**Interfaces:**
- Produces: Drizzle tables `costingProjects`, `costingAttachments`, `costingExtractRuns`, `costingBomLines` 及对应 enum

- [ ] **Step 1: 编写 schema 文件**

按 spec §5 定义 enum 与四张表；`skuId` 可选 FK → `skus.id`；attachments/runs/lines 对 project `onDelete: 'cascade'`。

- [ ] **Step 2: 编写 SQL 迁移**

含 CREATE TYPE / TABLE / INDEX；INSERT 菜单 `产品成本核算` sort_order=3；`role_menus` 给 `super_admin`、`purchaser`、`viewer`（及需要的 parent `procurement`）。

- [ ] **Step 3: export + seed 同步**

`index.ts` export；`seed.ts` children 增加 costing，角色数组加入 `procurement.costing`。

- [ ] **Step 4: 本地 migrate 验证**

Run: 项目惯用 migrate 命令（见 `z-docker-ops.md` / package scripts）  
Expected: 新表与菜单存在，无报错。

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/product-costing.ts packages/db/src/schema/index.ts packages/db/drizzle/0069_product_costing.sql packages/db/src/seed.ts
git commit -m "$(cat <<'EOF'
feat(db): add product costing schema and menu for M1

EOF
)"
```

---

### Task 2: 纯函数 — 毛用量、行校验、合并、单号

**Files:**
- Create: `apps/web/server/lib/product-costing/bom-math.ts`
- Create: `apps/web/server/lib/product-costing/bom-math.test.ts`
- Create: `apps/web/server/lib/product-costing/merge-lines.ts`
- Create: `apps/web/server/lib/product-costing/merge-lines.test.ts`
- Create: `apps/web/server/lib/product-costing/project-no.ts`

**Interfaces:**
- Produces:
  - `calcQtyGross(qtyNet: number, lossRate: number): number`（4 位小数）
  - `normalizeAiLine(raw: unknown): CostingBomLineDraft | null`
  - `mergeBomLines(batches: CostingBomLineDraft[]): CostingBomLineDraft[]`
  - `canConfirmBom(lines, force): { ok: boolean; reasons: string[] }`
  - `buildProjectNo(d: Date, rand: string): string` → `CST-YYYYMMDD-XXXX`

- [ ] **Step 1: 写失败测试（毛用量与合并）**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcQtyGross } from './bom-math.js';
import { mergeBomLines } from './merge-lines.js';

describe('calcQtyGross', () => {
  it('applies loss rate', () => {
    assert.equal(calcQtyGross(1, 0.08), 1.08);
  });
});

describe('mergeBomLines', () => {
  it('sums qty for same material+spec+unit', () => {
    const merged = mergeBomLines([
      { category: '板材', materialName: '多层板', spec: '18mm', unit: '张', qtyNet: 1, lossRate: 0.1, sourceRef: 'p1', confidence: 'high', notes: '' },
      { category: '板材', materialName: '多层板', spec: '18mm', unit: '张', qtyNet: 2, lossRate: 0.1, sourceRef: 'p2', confidence: 'low', notes: '' },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].qtyNet, 3);
    assert.equal(merged[0].confidence, 'low');
    assert.match(merged[0].sourceRef ?? '', /p1/);
  });
});
```

- [ ] **Step 2: Run 确认失败**

Run: `cd apps/web && node --import tsx --test server/lib/product-costing/bom-math.test.ts server/lib/product-costing/merge-lines.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯函数**

confidence 序：`high < medium < low` 取较差；`normalizeAiLine` 拒绝非法 confidence/缺 materialName。

- [ ] **Step 4: Run 确认通过**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/product-costing/
git commit -m "$(cat <<'EOF'
feat(costing): add bom math, merge, and confirm rules

EOF
)"
```

---

### Task 3: 本地存储 + 附件路径

**Files:**
- Create: `apps/web/server/lib/product-costing/storage.ts`
- Create: `apps/web/server/lib/product-costing/storage.test.ts`

**Interfaces:**
- Produces:
  - `getCostingDataDir(): string`
  - `projectDir(projectId: string): string`
  - `ensureProjectDir(projectId: string): Promise<string>`
  - `writeProjectFile(projectId, relativeName, buf): Promise<{ storagePath, byteSize }>`
  - `resolveStoragePath(storagePath: string): string`（防路径穿越）
  - `removeProjectDir(projectId: string): Promise<void>`

- [ ] **Step 1: 测试路径穿越拒绝**

```ts
it('rejects path traversal', () => {
  assert.throws(() => resolveStoragePath('../etc/passwd'));
});
```

- [ ] **Step 2: 实现 storage（基于 `COSTING_DATA_DIR` 或 `process.cwd()/data/costing`）**

- [ ] **Step 3: 测试通过后 Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(costing): add local attachment storage helpers

EOF
)"
```

---

### Task 4: 文档预处理抽象（可测假实现 + 真实适配器）

**Files:**
- Create: `apps/web/server/lib/product-costing/preprocess/types.ts`
- Create: `apps/web/server/lib/product-costing/preprocess/index.ts`
- Create: `apps/web/server/lib/product-costing/preprocess/pptx-pdf.ts`
- Create: `apps/web/server/lib/product-costing/preprocess/fixture.ts`
- Create: `apps/web/server/lib/product-costing/preprocess/preprocess.test.ts`

**Interfaces:**
- Produces:
  - `type PageBundle = { pageNo: number; text: string; imagePath: string }`
  - `preprocessDesignFile(opts: { projectId; sourceStoragePath; contentType }): Promise<PageBundle[]>`
  - 若 `COSTING_PREPROCESS_MODE=fixture`：从源文件旁或内置最小 PNG+text 生成 1 页，供无 LibreOffice 环境测通
  - 默认 mode：`libreoffice`——pptx/pdf → PDF → png（实现需检测二进制，缺失则抛明确错误）

- [ ] **Step 1: 契约测试用 fixture mode 产出至少 1 页**

- [ ] **Step 2: 实现 fixture + libreoffice 适配器骨架（命令失败信息可读）**

- [ ] **Step 3: 在 `z-docker-ops.md` 或发布 SOP 补一句：成本核算镜像需 poppler/LibreOffice（若本期改 Dockerfile，同步改）**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(costing): add design file preprocess adapters

EOF
)"
```

---

### Task 5: Dify 开关 + extract 编排

**Files:**
- Modify: `apps/web/server/integrations/dify.ts`（`isCostingBomWorkflowEnabled` + `getDifyConfigSummary`）
- Create: `apps/web/server/lib/product-costing/extract-runner.ts`
- Create: `apps/web/server/lib/product-costing/extract-runner.test.ts`（mock `runWorkflow`）

**Interfaces:**
- Consumes: `runWorkflow`, `PageBundle`, `mergeBomLines`, `normalizeAiLine`, storage
- Produces:
  - `startExtractRun(projectId, userId, pageRange?): Promise<{ runId: string }>`（创建 pending/running，**fire-and-forget** `void executeExtractRun(runId)`）
  - `executeExtractRun(runId)`：读附件页 → 批大小 4 → 调 Dify → 合并 → 事务写 lines（保留 `is_manual`）→ 更新 project status
  - 批次 inputs：`{ category, pages_json }`；pages 内 image 读文件转 base64

- [ ] **Step 1: 单测 mock workflow 返回两行，断言 DB 写入逻辑用内存假或对 normalize/merge 集成**

优先单测「解析 outputs.lines + merge + 保留 manual」而不强依赖真 DB；若仓库路由测试惯用 DB，可跟 `cs-reply-quality` 模式。

- [ ] **Step 2: 实现 runner；未配置 key → run failed + project `extract_failed`**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(costing): wire Dify extract runner with batching

EOF
)"
```

---

### Task 6: HTTP Routes

**Files:**
- Create: `apps/web/server/routes/product-costing.ts`
- Create: `apps/web/server/routes/product-costing.test.ts`（至少：创建项目、confirm 拒绝 low、export 列头）
- Modify: `apps/web/server/index.ts` — `app.route('/api', productCostingRoutes)`

**Interfaces:**
- Produces: spec §6 全部 M1 端点；鉴权与现有 `procurement` 路由一致（require user session）

- [ ] **Step 1: 实现 CRUD + upload（`assertUploadFile`）+ pages 读**

Upload 仅允许 `application/vnd.openxmlformats-officedocument.presentationml.presentation`、`application/pdf` 及扩展名兜底。

- [ ] **Step 2: extract / runs 轮询 + bom-lines CRUD + confirm-bom + export-bom**

Export 列：`大类,物料名称,规格,单位,净用量,损耗率,毛用量,来源,置信度,备注`

- [ ] **Step 3: 跑路由相关测试**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(costing): add product costing API routes

EOF
)"
```

---

### Task 7: API client + 前端页面

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/pages/ProductCostingListPage.tsx`
- Create: `apps/web/src/pages/ProductCostingDetailPage.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/pages/ProcurementPages.tsx`（可选 re-export）

**Interfaces:**
- Produces: `api.productCosting.*` 方法与页面

- [ ] **Step 1: api.ts 类型与方法**（list/create/get/patch/delete/upload/extract/getRun/bomLines/confirm/export）

- [ ] **Step 2: 列表页** — PageHeader「产品成本核算」、新建对话框、状态徽章、进详情

- [ ] **Step 3: 详情页** — Tab 方案（上传、页预览、AI 拆解按钮+轮询）；Tab 清单（可编辑表格、确认、导出）；对齐现有 Table/Button/Tabs 组件

- [ ] **Step 4: router 注册**

```tsx
<Route path="procurement/costing" element={<ProductCostingListPage />} />
<Route path="procurement/costing/:id" element={<ProductCostingDetailPage />} />
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(costing): add product costing list and detail UI

EOF
)"
```

---

### Task 8: Dify DSL 说明 + 验收文档

**Files:**
- Create: `docs/dify/workflows/product-costing-bom-extract.md`（inputs/outputs、模型需多模态、导入步骤；若可提供最小 YAML 骨架则放同目录）
- Modify: `docs/superpowers/specs/2026-08-07-product-costing-bom-design.md` 可链到该文档（可选一行）

- [ ] **Step 1: 写清 env、Workflow 变量名、`pages_json` 示例、失败排查**

- [ ] **Step 2: 用样本 PPT 做一次手工验收清单（勾选 spec §10）记在 md 末尾「验收记录」模板**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(costing): add Dify workflow setup for BOM extract

EOF
)"
```

---

## Spec coverage check

| Spec 项 | Task |
|---------|------|
| 独立表不碰 bom | T1 |
| 本地附件 | T3 |
| 多模态预处理 | T4 |
| Dify 分批 extract | T5 |
| API 全表 | T6 |
| 菜单/页面 | T1 + T7 |
| 导出清单 | T6–T7 |
| 未配置 Dify 可手工 | T5–T6 |
| M2 价目 | 明确不在本 plan |

## 执行说明

完成 Task 1–8 即 M1。M2（价目/核算）另开 plan，勿塞进本文件。
