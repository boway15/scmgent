# 库存总览 × 飞书「SKU周转相关信息」同步设计

## 1. 背景与目标

库存总览依赖 SKU 周转宽表（分仓库存 + 合计在途/在产/销量/周转）。业务权威数据源改为飞书多维表格：

- Base：`HPJzbHdPea7elSs92T8c31BTnxe`
- 表：`tblwvSHbqJ3szugE`（SKU周转相关信息）
- 规模：66 列 Text，约 5800+ 行

目标：

1. 每日 **07:30**（Asia/Shanghai）单向拉取飞书 → 本地
2. 写入 `inventory_records` 快照 + `skus.encoding_meta.turnoverSnapshot`
3. 库存总览可直接展示飞书合计/分仓字段

## 2. 决策

| 项 | 选择 |
|----|------|
| 同步类型 | 新类型 `inventory_turnover`（不复用 6 字段 `inventory`） |
| App Token | 优先 `FEISHU_BITABLE_PROCUREMENT_APP_TOKEN`，否则 `FEISHU_BITABLE_APP_TOKEN` |
| Table | `FEISHU_BITABLE_TABLE_INVENTORY=tblwvSHbqJ3szugE` |
| 任务形态 | HTTP + `X-Cron-Secret`，Compose cron `30 7 * * *`（每天 07:30，非妙搭） |
| Snapshot | 飞书 66 列原名为总览权威；导入仍可双键写 Excel 兼容别名供分仓展开 |
| 分仓在途 | 仅合计，不伪造分仓 `qty_in_transit` |
| 区域与合计不一致 | warning 计数，合计以 `海外仓在库` 为准 |
| 生命周期 | 系统按销量自动计算（`classifySalesLifecycle` → 中文标签）；飞书/库存导入不覆盖 |

## 3. 字段映射摘要

### 主数据 → `skus`

SKU / SKU名称 / 品类 / 销售国家 / 产品分类 / 负责人 / 开发人员 / 供应商编码·简称 / 采购周期 / 采购价；币种进 snapshot；Id/ProductBaseID/SupplierId 进 `encoding_meta.feishuIds`。

### 分仓 → `inventory_records`

飞书「美东…平台仓_欧」为**近半年海外仓销售单占比**（迅捷同义），仅写入 `turnoverSnapshot`，**不**映射为分仓 `qty_available`。

实物库存：`海外仓在库` → `海外仓库存_合计`，导入时写入汇总仓 `OVERSEAS` 的 `qty_available`；`调拨在途合计` → 同仓 `qty_in_transit`。Excel 旧表若仍有 `海外仓库存_美东` 等真分仓数量列，仍按 `US-EAST`… 分仓写入。供应商订单 → `IN-PRODUCTION.qty_in_production`；预下单仅 snapshot / 总览 `qtyPreOrder`。

### 合计与指标 → `turnoverSnapshot`

`海外仓在库`→`海外仓库存_合计`；`调拨在途合计`→`调拨在途_合计`；`供应商订单`→`供应商订单合计`；ETA 管道字段按 `|` 拆合计；相对月销量/预测按同步日展开为日历月列；毛利率 AMZ 列映射到亚马逊列名；括号归一体积/毛重。

## 4. API

| 用途 | Endpoint |
|------|----------|
| 预览 | `POST /api/bitable/sync/inventory_turnover/preview` |
| 同步 | `POST /api/bitable/sync/inventory_turnover` |
| Cron | `POST /api/tasks/inventory-turnover-pull` |

`task_runs.taskName`：`inventory_turnover_pull`。同任务已有 `running` 时跳过并记失败。

## 5. 非范围

- 不回写飞书
- 不改采购两表同步
- 保留 Excel/CSV 上传导入能力
