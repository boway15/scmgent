### Task 2: 接入健康/补货 historical 回退

**Files:**
- Modify: `apps/web/server/lib/inventory-health-service.ts`
- Modify: `apps/web/server/lib/replenishment.ts`（若 `calcDailyStats` 可委托）
- Optional loader: �?`inventory_records` �?SKU+仓拉窗口内每日最�?qty_available（按 recorded_date�?- Modify: metrics + `reorder-suggestion-explain` 展示 `stockoutAdjusted`

**Interfaces:**
- 在算 `eoqCalc.avgDaily` / historical 路径前调�?effective demand；metrics 增加�?
```ts
{
  stockoutAdjusted: boolean,
  inStockDays: number,
  demandWindowDays: number,
}
```

加载可用性策略（实现选一，文档写死）�?
- **A（推�?MVP�?*：对窗口内每个有 `inventory_records` �?`recorded_date` 取该日最新一条；缺日不插值。仅�?`availability.length >= minCoverage`（如窗口�?30%）才 `stockoutAdjusted: true`，否则日历均摊�?- 常量：`MIN_AVAILABILITY_COVERAGE = 0.3`

- [ ] **Step 1: 单测 loader 合并�?health metrics shape**

- [ ] **Step 2: 实现接入；预测路径不�?*

- [ ] **Step 3: 更新 `formatSuggestionExplain`：历史来源时标注「断货修正�?*

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: use stockout-adjusted demand for historical replenishment fallback"
```

---
