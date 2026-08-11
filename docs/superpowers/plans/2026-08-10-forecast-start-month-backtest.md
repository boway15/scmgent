# Forecast Start Month Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成销量预测时可选择开始月（默认当月、最多往前 6 个月），严格回测截断训练数据，并在版本上落库展示。

**Architecture:** 新增 `startMonth` 解析/校验工具；generate-baseline API 与后台任务透传 `today`；`sales_forecast_versions.start_month` 持久化；AllCat v41 回测时省略 `historyCapEnd`；列表页增加开始月选择与展示。

**Tech Stack:** Drizzle/Postgres、Hono、React、现有 forecast-collaboration / forecast-baseline。

## Global Constraints

- 严格回测：训练仅用开始月之前历史
- 版本名规则不变
- `start_month` 可空 varchar(7) `YYYY-MM`
- 合法范围：`[当前月-6, 当前月]`（UTC）
- 历史版本不回填

---

## File Map

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema/sales-forecast.ts` | `startMonth` 列 |
| `packages/db/drizzle/0070_*.sql` | 迁移 |
| `apps/web/server/lib/forecast-start-month.ts` | 解析、范围、可选列表、`today` 映射 |
| `apps/web/server/lib/forecast-start-month.test.ts` | 单测 |
| `apps/web/server/routes/sales-forecast.ts` | API 校验与透传 |
| `apps/web/server/lib/forecast-baseline-task.ts` / collaboration | `today` + `start_month` 写入 + v41 historyCapEnd |
| `apps/web/src/lib/forecast-horizon-meta.ts` | 前端可选月列表（或复用共享逻辑） |
| `apps/web/src/lib/api.ts` | 类型与请求字段 |
| `apps/web/src/pages/SalesForecastListPage.tsx` | UI 选择与列表展示 |
| `apps/web/src/pages/SalesForecastVersionDetailPage.tsx` | 详情展示 |

---

### Task 1: startMonth 工具 + 单测

- [x] 写 `forecast-start-month.test.ts`（合法/非法/越界/默认当月/`toAsOfDate`）
- [x] 实现 `forecast-start-month.ts`
- [x] 跑测通过

### Task 2: DB 迁移

- [x] schema 加 `startMonth`
- [x] 新增 drizzle SQL
- [x] journal 登记（若项目惯例需要）

### Task 3: 生成链路

- [x] `generateBaselineForecastVersion` 写入/更新 `start_month`
- [x] 批量生成始终传 `historyCapEnd`（严格回测靠 today 截断）
- [x] route + background task 传 `startMonth`/`today`
- [x] 列表 API 暴露 `startMonth`

### Task 4: 前端

- [x] api 类型
- [x] 列表页开始月下拉 + 提示
- [x] 列表/详情展示

### Task 5: 验证

- [x] 相关单测通过
- [x] 手工核对无类型/lint 明显问题
