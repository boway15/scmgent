# FOB 分账主体改为工厂名称 Implementation Plan

> **For agentic workers:** Use TDD; steps use checkbox syntax for tracking.

**Goal:** 截单清单体积导入以工厂名称为分账主体，平账 UI 突出工厂名、订舱号为辅助。

**Architecture:** 仅改 `parseTransferVolumeSheet` 的 `merchantCode`/`merchantName` 取值；分摊引擎键逻辑不变。平账矩阵副标题与 tooltip 强化工厂展示。

**Tech Stack:** TypeScript、现有 `fob-bill-parsers` / `FobContainerMatrixPanel` / `FobSettlementDetailPage`

## Global Constraints

- 主体唯一键 = 工厂名称原文（trim），不做别名合并
- 工厂名为空 → 该行报错，不回退订舱号
- ED / 简易 CSV 不改键逻辑
- 历史批次不自动迁移

---

## Task 1: 解析单测 RED → 改解析 GREEN

**Files:**
- Modify: `apps/web/server/lib/fob-bill-parsers.test.ts`
- Modify: `apps/web/server/lib/fob-bill-parsers.ts`

- [x] 更新混柜用例：断言 `merchantCode` = 工厂名称
- [x] 新增：同订舱三工厂 → 3 个 distinct merchantCode
- [x] 新增：工厂名为空 → errors 含「工厂名称」
- [x] 跑测确认 RED
- [x] 改 `parseTransferVolumeSheet`：`merchantCode`/`merchantName` = 工厂名称；空名报错
- [x] 跑测 GREEN

## Task 2: 平账 UI + 文案

**Files:**
- Modify: `apps/web/src/components/FobContainerMatrixPanel.tsx`
- Modify: `apps/web/src/pages/FobSettlementDetailPage.tsx`
- Modify: `.cursor/rules/fob-settlement-dev.mdc`

- [x] 柜副标题：`N 工厂/主体`，业务编号可选后缀
- [x] tooltip 增加工厂名称列表
- [x] 体积导入 hint：主体 = 工厂名称
- [x] 更新开发记忆规则

## Task 3: 验证

- [x] `npx tsx --test server/lib/fob-bill-parsers.test.ts`
- [x] 确认无新增 lint 问题
