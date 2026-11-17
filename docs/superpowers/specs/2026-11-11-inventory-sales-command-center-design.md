# 存销经营指挥台（五维归类）设计

> **状态**：已实现  
> **日期**：2026-11-11  
> **基线**：[`2026-11-11-inventory-sales-analytics-design.md`](./2026-11-11-inventory-sales-analytics-design.md)  
> **目标**：在既有 SKU×仓 Cube 上，把存销分析升级为管理指挥台——经营四问 + 五维归类卷帘 + 明细下钻；补货动作指挥后置。

## 1. 定位

| 阶段 | 目标 | 本期 |
|------|------|------|
| 一期指挥台 | 卖了多少 / 库存多少 / 还能卖多久 / 是否健康 + 五维归类统计 + 下钻 | 是 |
| 二期补货指挥 | 缺货行生成 `reorder_suggestions`（pending），建议队列拍板 | 否（仅预留叙事） |

不改 cube 行键与重建主路径；只读聚合 + 筛选联动。

明细列「国内未发」= SKU 级 `IN-PRODUCTION` 在产量（已下单供应商未发出）；同 SKU 各仓行重复展示，**不计入**有效供给 / 覆盖 / 主风险。

## 2. 经营四问（`totals`）

同一套 list 筛选下：

| 字段 | 口径 |
|------|------|
| `rowCount` | 命中行数 |
| `effectiveQtySum` | 有效供给合计 |
| `sales7dSum` / `sales14dSum` / `sales30dSum` | 分摊销量窗口合计（null 当 0）；窗口截止日 = 上海业务日 − 2（销量入湖延迟，当天/昨天未同步） |
| `avgCoverDays` | 有 `cover_days` 的行的算术平均；无则 null |
| `withVelocityRowCount` | `cover_days IS NOT NULL` 行数 |
| `stockoutRisk` / `slowMoving` / `imbalance` / `unallocated` | 主风险计数（保留） |

## 3. 五维归类（`breakdowns`）

每桶：`key`、`label`、`rowCount`、`effectiveQtySum`、`sales30dSum`。

1. **主风险** `byRisk`：`stockout_risk` / `slow_moving` / `imbalance` / `unallocated` / `none`（空）
2. **物理仓** `byWarehouse`：按 `warehouse_code`
3. **品类** `byCategory`：空 → key=`__none__`，label=`未分类`
4. **生命周期** `byLifecycle`：空 → key=`__none__`，label=`未标注`
5. **覆盖组距** `byCoverBand`（`meta.coverBands.version = v1`）：
   - `d0_14`：0 ≤ cover ≤ 14
   - `d15_30`：15–30
   - `d31_90`：31–90
   - `d90_plus`：> 90
   - `no_velocity`：cover 为空

组距与缺货提前期阈值独立。五维均为当前筛选全集上的互斥分组，各维 `rowCount` 之和 = `totals.rowCount`。

## 4. API

| 方法 | 路径 | 作用 |
|------|------|------|
| `GET` | `/api/inventory-sales-analytics/overview` | `totals` + `breakdowns` + `meta` |
| `GET` | `/api/inventory-sales-analytics/rows` | 增加查询参数 `coverBand` |

筛选参数与 rows 对齐：`q` / `warehouseCode` / `category` / `lifecycle` / `primaryRisk` / `productScope` / `salesCountry` / `coverBand`。

交互：点击桶写入对应筛选并刷新 overview + rows（交叉过滤）。

## 5. 非范围（本期）

- 生成/采纳补货建议、PMC  
- 调拨单、飞书回写、金额毛利  
- 改重建流水线  

## 6. 二期预留

- 缺货桶/行：「生成补货建议」→ `reorder_suggestions`  
- 指挥台「已生成 / 待采纳」深链 `/pmc/suggestions`
