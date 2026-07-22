# FOB 平账矩阵货柜号可拖选复制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 平账矩阵父行货柜号可鼠标拖选并用系统复制，展开/收起仍由左侧箭头控制。

**Architecture:** 将 `FobContainerMatrixPanel` 父行中包住「箭头 + 状态 + 柜号」的单个 `<button>` 拆开：可点击区域仅含箭头与平账状态图标；柜号移出 button，作为普通可选中文本，保留现有 `TruncatedTip`。

**Tech Stack:** React 18 + TypeScript + Tailwind（现有组件，无新依赖）

## Global Constraints

- 方案：柜号移出展开按钮，支持拖选后 Ctrl+C / 右键复制（不做一键点击复制）
- 不做：Copy 图标、toast、副标题改动、其他页面柜号复制扩展
- 改动文件：仅 `apps/web/src/components/FobContainerMatrixPanel.tsx`
- 验收以手工 UI 为准（纯结构拆分，无业务逻辑变更）

---

### Task 1: 拆分父行柜号单元格

**Files:**
- Modify: `apps/web/src/components/FobContainerMatrixPanel.tsx`（约 618–650 行父行首列）
- Test: 手工验收（见步骤 3）

**Interfaces:**
- Consumes: 现有 `toggleExpanded(containerNo, defaultExpanded)`、`TruncatedTip`、`group.containerNo`、`scopeTotals.balanced`
- Produces: 无新导出 API；仅 DOM 结构变化

- [x] **Step 1: 将整块 button 拆为「展开按钮 + 可选中柜号」**

把父行首列内当前结构：

```tsx
<button type="button" className="flex w-full ..." onClick={() => toggleExpanded(...)}>
  {/* chevron + status + TruncatedTip(containerNo) */}
</button>
```

改为：

```tsx
<div className="flex w-full min-w-0 items-center gap-1.5">
  <button
    type="button"
    className="flex shrink-0 items-center gap-1.5 text-left"
    aria-expanded={open}
    aria-label={open ? '收起货柜明细' : '展开货柜明细'}
    onClick={() => toggleExpanded(group.containerNo, !scopeTotals.balanced)}
  >
    {open ? (
      <ChevronDown className="h-4 w-4 shrink-0 text-text-sub" />
    ) : (
      <ChevronRight className="h-4 w-4 shrink-0 text-text-sub" />
    )}
    {scopeTotals.balanced ? (
      <CheckCircle2
        className="h-4 w-4 shrink-0 text-emerald-600"
        aria-label="已平账"
      />
    ) : (
      <AlertCircle
        className="h-4 w-4 shrink-0 text-primary"
        aria-label="未平账"
      />
    )}
  </button>
  <TruncatedTip
    tip={containerHoverTip}
    className="min-w-0 flex-1 select-text font-mono font-semibold text-text-main"
  >
    {group.containerNo}
  </TruncatedTip>
</div>
```

副标题块（`pl-[2.125rem]`）保持不变。

- [x] **Step 2: 确认无残留整行 button / `user-select: none`**

检查该单元格：柜号不在 `<button>` 内；`TruncatedTip` 内柜号无 `select-none`。

- [ ] **Step 3: 手工验收**（请业务侧确认）

1. 打开有分摊结果的 FOB 批次 → 平账矩阵「按柜平账与调账」
2. 拖选某柜号 → Ctrl+C → 粘贴，内容一致
3. 点击左侧箭头，展开/收起仍正常；悬停 tip 仍显示

- [x] **Step 4: Commit**

```bash
git add apps/web/src/components/FobContainerMatrixPanel.tsx
git commit -m "fix: make FOB reconcile container numbers selectable for copy"
```
