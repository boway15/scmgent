# 销量预测开始月选择（严格回测）设计

> **状态**：已实现  

> **日期**：2026-08-10  
> **目标**：生成预测时可选择开始月（默认当月，最多往前 6 个月），便于用历史实绩验证准确率；训练数据严格截止至开始月之前。

---

## 1. 背景与决策

当前「生成草稿」仅有渠道 / 品类 / SKU / 预测月数，地平线固定从**当前自然月**起算。为支持回测验证，需要在生成时可选过去的开始月。

| 决策项 | 结论 |
|--------|------|
| 训练截断 | **严格回测**：仅使用开始月之前的历史，无未来信息泄漏 |
| 版本标识 | 版本名规则不变；列表 / 详情展示 `start_month` |
| 持久化 | 方案 2：`sales_forecast_versions.start_month` 落库 |

---

## 2. 数据模型

在 `sales_forecast_versions` 增加：

| 列 | 类型 | 说明 |
|----|------|------|
| `start_month` | `varchar(7)`，可空 | 预测地平线首月，`YYYY-MM` |

- 新建版本时写入所选开始月。
- 单 SKU 写入已有草稿时：以本次请求的 `startMonth` **更新**该草稿的 `start_month`（与地平线一致）。
- 历史版本迁移后为 `NULL`，UI 显示 `—`；本期不做回填。

迁移：`packages/db` 新增 Drizzle SQL + schema 字段。

---

## 3. API

`POST /api/sales-forecasts/generate-baseline` 增加可选 body：

```ts
startMonth?: string; // 'YYYY-MM'
```

| 规则 | 行为 |
|------|------|
| 缺省 / 空 | 视为当前 UTC 自然月 |
| 合法范围 | `[当前月 - 6, 当前月]`（共 7 档） |
| 非法格式或越界 | `400`，中文提示 |
| 映射 | `today = Date.UTC(y, m - 1, 1)`，传入 `generateBaselineForecastVersion({ today })` |
| 后台任务 | `forecast_baseline` 的 taskInput 携带 `startMonth`（及解析后的 `today`），同样校验 |

版本名：不改 `buildBaselineDraftVersionName`。

列表 / 详情响应：版本对象暴露 `startMonth: string | null`（读自 `start_month`）。

---

## 4. 严格回测截断

复用现有 `today` 驱动链路：

1. `buildMonthlyForecastHorizon(today, monthCount)` → 地平线从开始月起。
2. `effectiveRecentWindowEnd(today)` + 日/月销量加载窗口 → 训练数据自然截止到开始月之前。

**AllCat v41 `historyCapEnd`：**

| 场景 | 行为 |
|------|------|
| 任意开始月（含回测） | 传 `recentWindowEnd`（由 `today`/开始月推导），冻结批量地平线特征 |
| 严格无泄漏 | 靠 `today` 截断日/月历史加载；**不是**省略 `historyCapEnd` |

---

## 5. 前端

**页面**：`SalesForecastListPage` 生成草稿区。

- 「预测月数」旁增加「开始月」下拉。
- 选项：当月 + 往前 6 个月（`YYYY-MM`，新→旧），默认当月。
- 请求体带 `startMonth`。
- 选过去月时展示灰字提示：「训练数据截止至开始月之前（严格回测）」。

**展示**：

- 版本列表「范围」旁或同列展示开始月：`startMonth ?? '—'`。
- 详情页标题区展示「开始月：YYYY-MM」或 `—`。

辅助：在 `forecast-horizon-meta`（或邻近模块）提供生成可选开始月列表的小函数，前后端校验口径一致（UTC 自然月）。

---

## 6. 测试

- `startMonth` 解析与范围校验（合法 / 非法格式 / 越界）。
- 回测：`today` 为过去月时，horizon 从该月起；v41 路径不传 `historyCapEnd`。
- 当月生成：行为与现网一致（含 `historyCapEnd`）。
- 版本创建 / 单 SKU 更新时 `start_month` 写入正确。

---

## 7. 范围与非目标

**本期范围**

- 生成 UI + generate-baseline API + `start_month` 迁移 + 列表/详情展示。
- 严格回测截断（含 v41）。
- 相关单测。

**非目标**

- 不改版本名规则。
- 不在生成后自动计算准确率。
- 不改详情页既有 walk-forward 回测入口。
- 不为历史版本回填 `start_month`。
- 不支持开始月晚于当前月。
