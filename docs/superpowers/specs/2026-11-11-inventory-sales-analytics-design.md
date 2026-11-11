# 存销分析（库存 × 销售数字化）设计

> **状态**：待实现  
> **日期**：2026-11-11  
> **目标**：在预测体系稳定后，基于库存周转头寸与销售占比，建设计划/运营共用的「存销分析」日拍看板；分仓明细仅作对账下钻。

## 1. 背景与决策

预测链路已稳定；飞书「库存周转」「库存查询（分仓明细）」日同步已入湖。周转驱动规划；分仓明细偏只读镜像。销售侧已有销售分析看板与 `sales_history`，但缺少 **SKU × 物理仓** 的存销合一经营视图。

| 决策项 | 结论 |
|--------|------|
| 产品定位 | 经营合一看板 + 存销联动分析（A+C） |
| 用户 | 计划 + 运营共用一板；同一指标，角色仅影响默认筛选/可见列 |
| 主粒度 | SKU × 物理仓；销售国家/站点仅筛选与下钻 |
| 分仓销量 | 用周转销售占比把 SKU 日销分摊到仓（与规划头寸同构） |
| 一期指标 | 分仓库存 + 分仓销量 + 存销联动 + 风险标签 |
| 预测对照 | 二期 |
| 入口 | 独立页「存销分析」 |
| 实现架构 | 日预聚合行表 Cube（非在线全量聚合、非改写 `warehouse_stock_facts`） |

## 2. 架构

```
飞书库存周转(07:40) → inventory_records / turnoverSnapshot
飞书分仓明细(07:20) → inventory_query_daily_snapshots（下钻对账，不驱动 cube 主指标）
sales_history（日销）
        │
        ▼  周转发布成功后触发（日流水线尾部）或手动 rebuild
inventory_sales_cube_runs + inventory_sales_cube_rows
        │  固化：库存 / 分摊销量 / 覆盖·动销 / 风险标签
        ▼
GET /api/inventory-sales-analytics/*
React 页 /data/inventory-sales-analytics
```

### 边界

- Cube **主库存口径** = 周转头寸 + 销售占比分仓，与 `resolveInventoryPosition` 同构，与补货一致。
- 分仓明细 / `warehouse_stock_facts` 仅 **对账与详情下钻**，不改写 cube 主数字。
- **不改**预测发布、补货引擎、周转/查询拉取链路；本能力只读经营数字化。
- 同一业务日（上海时区）最多一个成功对外可读的 `ready` 批次；重建失败保留上一 `ready` 并暴露失败状态。

## 3. 指标与风险口径

### 3.1 行键

`(sku_id, warehouse_code)`

- 有销售占比：拆到物理仓（美东/美西/欧等，映射同 `TURNOVER_BUCKET_WAREHOUSE_MAP`）。
- 无占比可拆且仍有海外库存：保留 `OVERSEAS` 一行，`share_method = unallocated`。
- 本仓已有原生分仓数量时：`share_method` 可为 `native_warehouse`（与规划分配枚举对齐）。

### 3.2 库存

| 字段 | 口径 |
|------|------|
| `qty_available` | 规划同构可售 |
| `qty_in_transit` | 规划同构在途 |
| `effective_qty` | 同 `resolveInventoryPosition` 有效供给 |
| `share_method` | `sales_share` \| `unallocated` \| `native_warehouse` |
| `share_weight` | 归一化后该仓权重；`unallocated` 可空 |

### 3.3 销量（历史分摊）

| 字段 | 口径 |
|------|------|
| `sales_7d` / `sales_14d` / `sales_30d` | SKU 口径日销窗口合计 × 该仓归一化销售占比 |
| `avg_daily_30d` | `sales_30d / 30` |

验收约束：同一 SKU 各仓 `sales_30d` 之和 ≈ 该 SKU 窗口日销合计（占比归一化后，允许整数舍入误差）。

### 3.4 存销联动

| 字段 | 口径 |
|------|------|
| `cover_days` | `effective_qty / avg_daily_30d`；`avg_daily_30d ≤ 0` 时为 `null`（不造无穷大） |
| `sell_through_30d` | `sales_30d / (sales_30d + effective_qty)`；分母为 0 则为 `null` |

一期 **只展示 `cover_days`**，不并行展示易冲突的「周转天数」第二套公式。覆盖一律用 **历史 30 日日均**；预测需求对照明确二期。

无日销：销量与覆盖为 `null`，可标展示态「无动销」，**不**把覆盖当成 0。

### 3.5 风险标签

行可带多标签；`primary_risk` 按优先级取一：

1. `stockout_risk` — `cover_days` 有值且 `≤` 该 SKU 总提前期（交期配置；缺省用现网 lead 默认汇总天数）
2. `slow_moving` — `isSlowMovingStock`（默认日均 ≤ 0.1 且覆盖 ≥ 90）或灰灯生命周期关键词
3. `imbalance` — 同 SKU：至少一仓 `cover_days ≤ 该 SKU 总提前期`，且另一仓 `cover_days ≥ overstockThresholdDays`（默认 180）
4. `unallocated` — `share_method = unallocated` 且 `effective_qty > 0`

阈值写入 cube `meta.thresholds`（含版本说明），便于复盘。

### 3.6 筛选维（非行键）

品类、生命周期、产品范围（成品/配件）、物理仓、主风险、销售国家/站点（用 SKU 主数据 + 日销站点过滤后再看分摊行）。

## 4. 数据模型

### 表：`inventory_sales_cube_runs`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid PK | |
| `snapshot_date` | date | 上海业务日 |
| `status` | varchar | `running` \| `ready` \| `failed` |
| `source_turnover_date` | date 可空 | 源周转快照日 |
| `source_sales_as_of` | date 可空 | 销量窗口截止日 |
| `row_count` | int | ready 时行数 |
| `meta` | jsonb | 仓枚举、阈值、源统计、角色默认筛模板版本等 |
| `error_message` | text 可空 | |
| `started_at` / `finished_at` | timestamptz | |
| `created_by` | uuid 可空 | 手动触发人；Cron 为空 |
| `created_at` | timestamptz | |

对外读取：最新 `status = ready` 一行；`failed` 仍保留供 status API。同一 `snapshot_date` 允许历史 runs，列表以最新 ready 为准。

### 表：`inventory_sales_cube_rows`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid PK | |
| `run_id` | uuid FK → runs | |
| `sku_id` | uuid | |
| `sku_code` | varchar | 冗余便查询 |
| `warehouse_code` | varchar | |
| `product_scope` | varchar | goods / accessory 等 |
| `category` / `lifecycle` / `sales_country` | 可空 | 冗余筛选项 |
| 库存/销量/存销/风险字段 | 见 §3 | 数值列 + `primary_risk` + `risk_tags` jsonb |
| `created_at` | timestamptz | |

唯一约束：`(run_id, sku_id, warehouse_code)`。索引：`(run_id, primary_risk)`、`(run_id, warehouse_code)`、`(run_id, sku_code)`。

不用单行巨型 jsonb 存全表，以便分页、筛选、导出。

## 5. API

| 方法 | 路径 | 作用 |
|------|------|------|
| `GET` | `/api/inventory-sales-analytics/status` | 最新 ready/failed/running、`snapshot_date`、行数、错误、源日期、`meta` 枚举摘要 |
| `GET` | `/api/inventory-sales-analytics/rows` | 最新 ready 分页列表；查询参数：q/仓/品类/风险/生命周期/产品范围/国家或站点；响应含当前筛选下的 `summary` KPI |
| `GET` | `/api/inventory-sales-analytics/sku/:skuId` | 下钻：该 SKU 各仓行 + 可选分仓明细对账摘要 |
| `POST` | `/api/inventory-sales-analytics/rebuild` | 手动重建；已有 running → 409 |
| `POST` | `/api/tasks/inventory-sales-cube-rebuild` | Cron / 日流水线；需 `X-Cron-Secret` |
| 导出 | 走既有下载中心（若已接好）或 `POST .../export` | 当前筛选 CSV |

一期不提供整包 jsonb `GET .../cube`；列表分页 + `summary` 即主读模型。

## 6. 页面

- 路由：`/data/inventory-sales-analytics`
- 菜单 code：`data.inventory_sales_analytics`，文案「存销分析」；与「销售分析看板」「库存总览」并列（挂在 data 分组）
- RBAC：计划、运营角色默认可见（迁移种子与现网角色对齐）

结构：

1. 顶栏：业务日、cube 状态、手动重建、产品范围  
2. KPI：行数、缺货风险、滞销、结构失衡、无法分仓  
3. 主表：SKU、仓、有效供给、7/14/30 销、日均、覆盖天数、动销率、主风险  
4. 抽屉：各仓对比 + 分仓明细对账只读区  
5. 导出：当前筛选 CSV  

角色默认筛选（写在 `meta` / 前端常量，可改）：

- 计划：主风险优先 `stockout_risk`、`unallocated`  
- 运营：主风险优先 `slow_moving`、`imbalance`

## 7. 触发与流水线

- **主路径**：日流水线在库存周转发布成功后调用 rebuild（`taskName`: `inventory_sales_cube_rebuild`）。  
- 周转当日失败未发布：不强制重建坏数；页面仍读上一 ready，status 提示「源周转未发布」。  
- 手动 rebuild：管理/计划可触发；与 Cron 互斥（running 锁）。

## 8. 错误与降级

| 场景 | 行为 |
|------|------|
| 重建失败 | 保留上一 ready；本 run `failed` + `error_message`；页顶告警 |
| 无销售占比 | `OVERSEAS` + `unallocated`；默认可筛出，不进入「低覆盖优先」默认列表时可隐藏 |
| 无日销 | 销量/覆盖 `null`；展示「无动销」 |
| 并发 rebuild | 409；读接口不受影响 |
| 分仓明细缺失 | 主表可用；抽屉对账显示「无查询快照」 |

## 9. 非范围（一期）

- 与发布版预测同屏对照  
- 用本 cube 驱动补货/预警改写  
- 回写飞书；改周转/分仓拉取  
- 金额、毛利、费用  
- 仓×站点交叉行键  
- 实时库存流式更新  
- 并行「周转天数」第二指标（与 cover 重复）

## 10. 验收

- 抽样 SKU×仓：`effective_qty` 与库存总览/规划头寸一致  
- 同 SKU 各仓 `sales_30d` 之和 ≈ 窗口日销合计（舍入可接受）  
- KPI 与主表筛选计数一致  
- 周转未发布日：可读昨日 cube，并明示源状态  
- 计划/运营菜单与 RBAC 生效  
- 单测：占比分摊、覆盖空值、风险优先级、rebuild 并发/失败保留上一 ready  

## 11. 主要落地文件（实现时）

| 区域 | 预期 |
|------|------|
| Schema / drizzle | `inventory_sales_cube_runs` / `_rows` + 菜单种子 |
| Server lib | `inventory-sales-cube.ts`（构建、读写、风险） |
| Routes / tasks | `inventory-sales-analytics.ts`、`inventory-sales-cube-rebuild` 任务 |
| 日流水线 | 周转成功后挂钩 |
| Frontend | `InventorySalesAnalyticsPage.tsx` + 路由/菜单 |
| Tests | 分摊、覆盖、风险、并发 |

## 12. 二期（记录，不实施）

- 覆盖天数可选「发布版预测需求」  
- 更细站点下钻矩阵、经营金额  
- 与预警/调拨建议只读深链
