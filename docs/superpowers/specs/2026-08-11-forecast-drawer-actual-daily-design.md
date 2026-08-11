# 预测明细弹窗加载实际日均设计

> **状态**：待实现  
> **日期**：2026-08-11  
> **目标**：在 `data/forecast` SKU 预测明细弹窗中对照「生效」日均展示实际日均，便于回看已发生月份的预测偏差；未到预测月显示 `-`。

---

## 1. 背景与决策

预测明细弹窗（`ForecastSkuDetailDrawer`）已展示系统 / 校准 / 生效日均，以及折叠的「近 N 个月实际日均」历史区，但**预测月份行本身没有实际对照**。当版本开始月落在过去、销售已发生时，用户需要在同一表内快速对比。

| 决策项 | 结论 |
|--------|------|
| 展示口径 | **实际日均**（件/天），与「生效」同口径 |
| 未来月 | `actualDailyAvg = null` → 前端显示 `-` |
| 当前自然月 | 不完全月日均（件数 ÷ 已过天数），标注「进行中」 |
| 已完整过去的月 | 整月件数 ÷ 当月天数；无销量显示 `0.00`（非 `-`） |
| 偏差列 | **不加**；用户自行对照「生效」 |
| 数据加载 | **打开弹窗时**经 `sku-detail` 拉取；不改列表矩阵 payload |
| 数据源 | `sales_history_monthly`，复用 `loadMonthlySalesBySkuIds` |
| 非范围 | 准确率页、`forecast_accuracy_monthly` 落库、列表矩阵列 |

---

## 2. API

扩展 `GET /api/sales-forecasts/sku-detail`。

### 2.1 请求

现有参数不变：`versionId`、`skuId` / `skuCode`、`station`、`platform`。

新增可选查询参数：

| 参数 | 说明 |
|------|------|
| `months` | 逗号分隔月标签，如 `2026-03,2026-04`；由弹窗按当前展示的预测月传入 |

未传 `months` 时：服务端按版本 `startMonth + monthCount`（或版本摘要等价字段）推算月份列表。

### 2.2 响应

新增字段：

```ts
actualByMonth: Array<{
  monthLabel: string;          // "2026-03"
  actualDailyAvg: number | null; // null → 前端 "-"
  inProgress: boolean;         // 当前自然月为 true
}>
```

其余 `versionSummary` / `context` / `reviewItems` / `sku` 不变。

### 2.3 计算规则

抽出纯函数（建议 `forecast-drawer-actual.ts`），`asOf` 默认今天，日历年月与现有 horizon **UTC** 一致：

1. 月份 **晚于** asOf 月 → `actualDailyAvg = null`，`inProgress = false`
2. 月份 **早于** asOf 月 → `qty / daysInCalendarMonth`；无行或 qty=0 → `0`
3. 月份 **等于** asOf 月 → `qty / max(1, asOf.getUTCDate())`，`inProgress = true`
4. 渠道与请求 `platform` 一致（含 `ALL` 全渠道汇总）
5. 日均保留两位小数，与 `buildHistoryCellsForSku` 一致

---

## 3. 前端

**组件**：`ForecastSkuDetailDrawer`

1. `months` 优先取弹窗入参 `row.months` 的 `monthLabel`；若 horizon 单行查询返回了更完整的 `months`，以 horizon 为准并写入 queryKey，触发 sku-detail 带 `months` 再请求一次（避免首屏无月标签时漏查）。
2. 预测明细表在「生效」列后新增「实际日均」列。
3. 有值：`formatNumber(actualDailyAvg)`；`inProgress` 时同格灰色小字「进行中」。
4. 无值：`-`。
5. 列头帮助：整月用当月天数；当月用已过天数；未来月为空。
6. sku-detail 失败时：实际列全 `-`，不阻断预测列展示。
7. 下方「近 N 个月实际日均」折叠区保留。

**API 客户端**：`api.getSalesForecastSkuDetail` 增加可选 `months`，响应类型增加 `actualByMonth`。

---

## 4. 测试

| 覆盖 | 断言 |
|------|------|
| 纯函数：未来月 | `actualDailyAvg === null`，`inProgress === false` |
| 纯函数：历史月 | `qty / 当月天数`；qty=0 → `0` |
| 纯函数：当月 | `qty / 已过天数`，`inProgress === true` |
| 路由 / 集成（可选轻量） | 传入 `months` 时响应含对齐的 `actualByMonth` |

渠道聚合不新写 SQL，复用 `loadMonthlySalesBySkuIds`，不单测其内部。

---

## 5. 实现要点（文件）

| 区域 | 文件 |
|------|------|
| 纯函数 + 单测 | `apps/web/server/lib/forecast-drawer-actual.ts`（+ `.test.ts`） |
| 路由 | `apps/web/server/routes/sales-forecast.ts`（`sku-detail`） |
| API 类型 | `apps/web/src/lib/api.ts` |
| 列帮助 | `apps/web/src/lib/forecast-horizon-column-help.ts` |
| UI | `apps/web/src/components/ForecastSkuDetailDrawer.tsx` |
