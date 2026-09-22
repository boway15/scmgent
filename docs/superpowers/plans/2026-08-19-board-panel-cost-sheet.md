# 板材成本宽表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline; user asked to execute immediately). Skip git commit unless the user asks.

**Goal:** 第三步按业务表展开每块板的张价÷片数与五列工艺；材料小计含螺丝包与包装；独立加工行不再进总额。

**Architecture:** 纯函数 `board-sheet.ts` 算片数/周长/行明细；`calcCostSummary` 改口径并把 `boardSheet` 写入汇总；BOM 行增加 `process_overrides` jsonb。螺丝包/包装已有 `ensureScrewPack` / `upsertPackagingLines`，本计划只补第三步配件卡、导出 sheet、闸门与展示。

**Tech Stack:** TypeScript、`tsx --test`、Drizzle/Postgres、React、xlsx。

## Global Constraints

- 大板采购 1220×2440 mm；开料净料 1200×2400 mm（长沿长边、宽沿短边，不旋转）；板材成本不乘 8% 损耗（片数&lt;1 才退回面积法）。
- 独立加工行（大类加工且名为开料/封边/打孔/开槽/喷漆）金额 0、不拦计算。
- 手填工艺只本单，不写回价目。不 commit，除非用户要求。

---

### Task 1: 板材片数与行明细纯函数

**Files:**
- Create: `apps/web/server/lib/product-costing/board-sheet.ts`
- Test: `apps/web/server/lib/product-costing/board-sheet.test.ts`

**Produces:** `piecesPerSheet`, `perimeterMeters`, `buildBoardSheetRow`, types `ProcessOverrides`, `BoardSheetRow`, `ProcessRates`

- [x] 实现与测试（本会话 TDD）

### Task 2: calcCostSummary 新口径

**Files:**
- Modify: `apps/web/server/lib/product-costing/cost-calc.ts`, `types.ts`, `compute-gate.ts`
- Test: `cost-calc.test.ts`, `compute-gate.test.ts`

**Produces:** `CostSummary.boardSheet`；板材 `lineAmount`=行小计；`processAmount`=五列之和；`isRolledProcessLine`

### Task 3: 价目工艺单价 + 计算管线

**Files:**
- Modify: `apps/web/server/lib/product-costing/service.ts` `calculateCostingLines`

从价目解析开料/封边/打孔/开槽/喷漆单价传入 `calcCostSummary`。

### Task 4: process_overrides 列与 PATCH

**Files:**
- Create: `packages/db/drizzle/0086_costing_process_overrides.sql` + journal
- Modify: `packages/db/src/schema/product-costing.ts`, routes, api client, `updateBomLine`

### Task 5: UI 宽表 + 配件包装 + 导出

**Files:**
- Create: `apps/web/src/components/costing/BoardSheetPanel.tsx`, `AccessoriesPackPanel.tsx`
- Modify: `ProductCostingToolPage.tsx`, `export-costing.ts` + test

### Task 6: 核对螺丝包/包装/板厚闸门已落地

已有代码则只补缺口（第三步配件卡、导出分类）。
