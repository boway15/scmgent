# 预测准确率详情优化：草稿复盘 + 预测值/实际值 + 走步下线

> **状态**：待实现  
> **日期**：2026-08-12  
> **关联**：`2026-08-10-forecast-start-month-backtest-design.md`（开始月严格回测已落地）

---

## 1. 背景与目标

开始月可选「当月 + 往前 6 个月」后，用历史开始月生成草稿即可对齐预测与实绩，**产品侧不再依赖走步回测**理解准确率。

| 目标 | 结论 |
|------|------|
| 草稿可复盘 | **开放**：`draft` 也可进入详情「准确率复盘」Tab |
| 预测值 / 实际值 | 仅详情准确率区顶部汇总；**不进版本列表** |
| 展示规则 | 地平线含未结束月 → `进行中`；实绩空 → `-`；否则 `预测总量 / 实际总量` |
| 走步回测 | **产品 UI 去掉**；CLI/分析脚本保留；HTTP API 先保留不挂 UI（可标 deprecated） |
| 准确率落库 | 保留对**当前版本**的批量回测（按已结束月写 `forecast_accuracy_monthly`） |

### 非范围

- 不改 MAPE / WMAPE 公式与分层 KPI 口径
- 不改开始月 lookback=6、基线/AI 严格回测生成逻辑
- 版本列表不加「预测值/实际值」列；草稿列表「准确率」列仍固定 `-`（避免与发布版 KPI 混淆）
- 本迭代不删除 `forecast-walkforward-backtest` 服务端模块与 scripts

---

## 2. 产品路径

```
选历史开始月 → 生成草稿 → 详情 · 准确率复盘
  →（可选）运行回测写入准确率行
  → 查看诊断 / 明细 / 顶部「预测值/实际值」
```

发布版 / 归档版行为与现网一致，额外展示同一套顶部汇总。

---

## 3. 详情 · 准确率 Tab 开放规则

| `status` | 准确率复盘 Tab |
|----------|----------------|
| `draft` | **允许** |
| `published` | 允许 |
| `archived` | 允许 |

前端：`isViewAllowed(..., 'accuracy')` 对 draft 返回 true；详情页 view 切换与深链 `?view=accuracy` 同步放开。

列表「复盘」链接：草稿也可进入准确率视图（操作区增加「复盘」或与「查看」并存；文案可用「复盘」指向 `view=accuracy`）。

---

## 4. 预测值 / 实际值汇总

### 4.1 展示位置

版本详情 → **准确率复盘** Tab → 准确率 Card 标题区下方（诊断面板之上或紧挨 CardHeader），单行汇总，例如：

`预测值 / 实际值：12,345 / 11,900` 或 `进行中` 或 `-`

### 4.2 状态机（整格一个状态）

设版本地平线月份集合为 H（来自该版本 `sales_forecast_monthly` 去重年月；无行时用 `startMonth` + `monthCount` 推算）。

设「当前未结束月」= 今天所在日历月 `YYYY-MM`（与开始月工具同一 UTC 月初口径，或与现有 `formatForecastStartMonth(now)` 一致，实现时统一一处）。

| 条件（自上而下优先） | 展示 |
|----------------------|------|
| H 中存在 ≥ 当前未结束月的月份 | `进行中` |
| 否则，汇总范围内实际总量为空/0 且无任何实绩来源 | `-` |
| 否则 | `{预测总量} / {实际总量}`，整数千分位 |

说明：

- 「进行中」表示地平线尚未全部落在已结束月，**不展示部分数字**（与用户选项 A 一致）。
- 「实绩空」指已结束月汇总后实际销量为 0 且无日/月销量来源可计入（与准确率实绩解析一致：日表优先，否则月表；皆无则该 SKU×渠道×月贡献 0）。

### 4.3 数量口径

仅汇总 **已结束月**（严格 `< 当前未结束月`）内、与准确率列表相同的平台过滤（`FORECAST_V41_PLATFORM_CODES` / 现有 `forecastPlatformCondition`）。

| 指标 | 计算 |
|------|------|
| 预测总量 | Σ (`forecastDailyAvg` × 该月日历天数)，对版本内预测行 |
| 实际总量 | Σ (SKU×站点×平台×月的销量件数)；日汇总优先，否则 `sales_history_monthly.qty_sold` |

不做日均展示；与列表准确率列无关。

### 4.4 API

新增（或挂在现有 version stats / accuracy summary 上）只读接口，例如：

`GET /api/sales-forecasts/versions/:id/qty-totals`

响应示例：

```json
{
  "status": "in_progress" | "empty_actual" | "ready",
  "forecastQty": 12345,
  "actualQty": 11900,
  "label": "进行中" | "-" | "12,345 / 11,900"
}
```

- `status=in_progress` → 前端显示 `进行中`（可忽略 qty）
- `status=empty_actual` → 显示 `-`
- `status=ready` → 用服务端格式化或前端千分位格式化 `forecastQty / actualQty`

草稿与已发布均可调用。无预测行时：若能用 `startMonth` + `monthCount` 推出 H 且含未结束月 → `in_progress`；否则 → `empty_actual`（展示 `-`）。

---

## 5. 批量回测（保留，替代走步产品入口）

- 保留「运行回测」：对**当前详情版本 id** 按已结束月调用既有 `computeForecastAccuracyBacktest` / `computeForecastAccuracyForMonth`。
- UI 文案调整：如「按开始月复盘回测」；去掉「走步影子版本」相关说明。
- 默认 `versionId` = 当前详情版本（含草稿），不再优先切到其它草稿或走步影子 id。
- 回测月份数默认取版本地平线月数与 6 的较小值，仍允许 1–24 可调。

定时任务 `forecast_accuracy`（主发布版算上月）不变。

---

## 6. 走步回测下线（产品）

从 `SalesForecastVersionDetailPage` **移除**：

- 「走步回测」按钮与分层 select
- `WalkForwardMonthTierTable` 展示
- `walkForwardMutation`、影子版本 `sessionStorage`、`viewingWalkForwardAccuracy` 切换与「恢复当前版本」

保留：

- `apps/web/scripts/run-forecast-walkforward-backtest.ts` 及 analyze-walkforward-* 脚本
- 服务端 `forecast-walkforward-backtest.ts` 与 `POST .../accuracy/walkforward`（本迭代可不删；路由注释 deprecated）

空状态文案改为引导「运行回测」或「确认历史开始月版本已有实绩月份」，不再提走步。

---

## 7. 列表页微调

- 草稿行操作：增加进入 `?view=accuracy` 的「复盘」（或等价入口）。
- 「准确率」列：草稿仍为 `-`；已发布/归档逻辑不变（`avg(mape)` 格式化为百分比）。

---

## 8. 测试要点

| 场景 | 期望 |
|------|------|
| draft + `?view=accuracy` | Tab 可进，不重定向 |
| 地平线含当月 | qty-totals → `进行中` |
| 地平线均为过去月、无销量 | `-` |
| 地平线均为过去月、有预测与销量 | `预测/实际` 数字正确（抽查 Σ 日均×天数） |
| 运行回测（草稿） | 写入当前 versionId 的准确率行；明细表有数据 |
| 详情页 | 无走步按钮 / 无影子版本提示 |

---

## 9. 实现触及面（预估）

| 区域 | 文件（示意） |
|------|----------------|
| 服务端汇总 | 新 lib 或 `forecast-accuracy.ts` / `forecast-version.ts`；route 挂 versions |
| 前端详情 | `SalesForecastVersionDetailPage.tsx`（Tab 权限、去掉走步、汇总展示） |
| 前端列表 | `SalesForecastListPage.tsx`（草稿复盘入口） |
| API 类型 | `apps/web/src/lib/api.ts` |
| 单测 | qty-totals 状态机纯函数；回测仍绑当前 versionId |

---

## 10. 验收

1. 历史开始月草稿可不发布即可复盘准确率。  
2. 详情可见「预测值/实际值」三态：`进行中` / `-` / 数字比。  
3. 产品路径无走步回测；批量回测针对当前版本。  
4. 列表无新列；草稿列表准确率仍为 `-`。
