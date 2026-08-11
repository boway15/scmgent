# AI 辅助预测对齐开始月（严格回测）设计

> **状态**：待实现  
> **日期**：2026-08-11  
> **目标**：AI 辅助预测与系统「开始月」严格回测同口径——历史截断至开始月之前，地平线从版本 `startMonth` 起共 N 月并整段覆盖写入。

---

## 1. 背景与决策

系统基线生成已支持 `sales_forecast_versions.start_month` 严格回测；AI 辅助（`runDifySingleSkuForecast` / `POST /sales-forecasts/dify/single`）始终用**今天**拼历史与地平线，造成回测版本上跑 AI 会泄漏开始月之后的实绩、地平线与版本不一致。

| 决策项 | 结论 |
|--------|------|
| 方案 | 服务端强制读版本 `startMonth`，不另传可偏离的开始月 |
| 无开始月 | **拒绝** AI（HTTP 400）；前端禁用并提示重新生成 |
| 写入范围 | 地平线内 Dify 日均 > 0 的月份 **整段覆盖**（替换系统值） |
| 草稿 | 仍仅草稿可写 |
| 非范围 | 准确率落库、偏差列、改 Dify 工作流 DSL、已发布可写 |

---

## 2. 服务端

**入口**：`POST /sales-forecasts/dify/single` → `runDifySingleSkuForecast`。

### 2.1 前置校验

1. **必须**提供 `versionId`；缺失则 `400`（不再 `getOrCreateDraftVersion` 隐式建无开始月草稿）。  
2. 加载版本；不存在 / 非草稿 → 现有错误。  
3. `startMonth = version.startMonth?.trim()`；空 → `400`，文案：  
   `AI 辅助预测需要版本开始月；请带开始月重新生成草稿后再试`  
4. `asOf = resolveForecastStartMonthAsOf(startMonth)`（UTC 月初）。  
5. `monthCount` 仍取请求/默认，受 `MAX_FORECAST_MONTH_COUNT` 限制。

### 2.2 时间口径（全部用 `asOf`，替换原 `today`）

| 用途 | 行为 |
|------|------|
| `buildSalesHistory24(..., asOf)` | 历史月标签不含开始月 |
| `loadMonthlySalesBySkuIds` | `maxYear/maxMonth` 截止到开始月**上月** |
| `historyCapEnd` | `Date.UTC(asOf.y, asOf.m, 0)` → 开始月上月末 |
| `buildMonthlyForecastHorizon(asOf, monthCount)` | 地平线从开始月起 |
| `buildCategoryTrendForHorizon(..., asOf)` | 同地平线 |
| 外生因子月校验 | 对照该地平线月标签 |
| V4.1 anchor（若仍计算） | 同上 `historyCapEnd` + 地平线首月 |

### 2.3 写入

保持现有 upsert：地平线内 `forecastDailyAvg > 0` 写入/覆盖；`forecastModel = dify_single_sku`；分层保留策略不变。

---

## 3. 前端

1. `getVersionForecastSummary` / sku-detail 的 `versionSummary` 增加 `startMonth: string | null`（服务端已查询该列，补返回）。  
2. API 类型同步。  
3. `ForecastAssistPanel`（或抽屉）：  
   - 无 `startMonth`：禁用 AI 按钮，提示「本版本无开始月，无法严格回测；请带开始月重新生成草稿」。  
   - 有开始月：短提示「按开始月 {startMonth} 严格回测（历史截止上月）」；外生因子月份仍用传入的 `monthLabels`。  
4. 请求体不传 `startMonth`（以版本为准）。

---

## 4. 测试

| 覆盖 | 断言 |
|------|------|
| 无 `startMonth` | 明确错误 / 400 |
| `startMonth=2026-02` | 地平线首月 `2026-02`；历史不含 `2026-02`；`historyCapEnd` 为 2026-01-31；销量查询 max 为 2026-01 |
| Dify mock | 入参 `sales_history_json` / `forecast_horizon_json` 口径正确 |
| 前端（可选轻量） | 无开始月时按钮 disabled |

---

## 5. 实现要点（文件）

| 区域 | 文件 |
|------|------|
| AI 单 SKU | `apps/web/server/lib/forecast-dify-single.ts`（+ `.test.ts`） |
| 路由错误透传 | `apps/web/server/routes/sales-forecast.ts`（若需） |
| versionSummary | `apps/web/server/lib/forecast-sku-context.ts` |
| API 类型 | `apps/web/src/lib/api.ts` |
| UI | `apps/web/src/components/ForecastAssistPanel.tsx` 和/或 `ForecastSkuDetailDrawer.tsx` |
