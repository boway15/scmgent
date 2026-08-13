### Task 3: UI 文案同步 ×0.6→×0.8

**Files:**
- Modify: `apps/web/src/components/ForecastStrategySection.tsx`
- Modify: `apps/web/src/pages/SalesForecastListPage.tsx`

**Interfaces:**
- 无新 API；仅展示文案与后端折扣一致

- [ ] **Step 1: 改策略表与列表说明**

`ForecastStrategySection.tsx` T99 行：

```ts
'max(近30,近90)×0.8，远月×0.72；不进主 KPI'
```

`SalesForecastListPage.tsx`：

```tsx
max(近30,近90)×0.8
```

（整句其余部分不变。）

- [ ] **Step 2: 全库扫残留硬编码**

Run（在 `apps/web`）：

```bash
rg "近90\)×0\.6|recent90\)\*0\.6|max\(近30,近90\)×0\.6" -g "*.ts" -g "*.tsx"
```

Expected: 无业务文案命中（测试历史注释除外；`recent_max06` 枚举名可保留）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ForecastStrategySection.tsx apps/web/src/pages/SalesForecastListPage.tsx
git commit -m "docs(forecast): sync T99 UI copy to 0.8 floor discount"
```
