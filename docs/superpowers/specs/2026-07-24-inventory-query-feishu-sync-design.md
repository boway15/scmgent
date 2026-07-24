# 库存查询 × 飞书「SKU库存周转情况查询-明细」同步设计

## 1. 背景与目标

库存总览权威源为飞书压缩宽表（约 66 列，`tblwvSHbqJ3szugE`）。其中区域列是近半年销售占比，**不是**各仓实物在库；业务需要按仓库查看在库/在途等明细。

飞书明细表（与本地样例「SKU库存周转情况查询-明细」同构，约 200 列）：

- Base：`HPJzbHdPea7elSs92T8c31BTnxe`
- 表：`tblubb08s6pe6DXI`
- 视图：`vew5Bp6EcY`
- 链接：https://chinabestwo.feishu.cn/base/HPJzbHdPea7elSs92T8c31BTnxe?table=tblubb08s6pe6DXI&view=vew5Bp6EcY

目标：

1. 在「库存管理」下新增独立菜单 **库存查询**
2. 每日 **07:20**（Asia/Shanghai）单向拉取飞书 → 本地按日归档
3. 页面完整镜像飞书明细字段（含各仓在库/在途等），可切换历史日期
4. **不改**库存总览同步、快照与业务口径

## 2. 决策

| 项 | 选择 |
|----|------|
| 实现方案 | 独立同步类型 + 独立快照表（与总览平行，不复用 `inventory_daily_snapshots`） |
| 同步类型 | `inventory_query` |
| App Token | 优先 `FEISHU_BITABLE_PROCUREMENT_APP_TOKEN`，否则 `FEISHU_BITABLE_APP_TOKEN` |
| Table | `FEISHU_BITABLE_TABLE_INVENTORY_QUERY=tblubb08s6pe6DXI` |
| 视图 | URL 中的 `vew5Bp6EcY` 仅作业务定位；同步按**整表**拉取，不按视图过滤（与总览一致） |
| 任务形态 | HTTP + `X-Cron-Secret`；Compose cron `20 7 * * *` |
| `task_runs.taskName` | `inventory_query_pull`（已有 `running` 则跳过并记失败） |
| 字段权威 | 飞书列原名原样写入 `payload` JSONB；不以系统别名重写 |
| SKU 关联 | 按飞书 `SKU` 匹配 `skus.sku_code`；匹配不到仍归档（`sku_id` 可空） |
| 写入边界 | **不**写 `inventory_records` / `turnoverSnapshot`；不驱动补货/预警 |
| 页面手动同步 | **不做**；仅 cron + 系统任务页触发 |
| Bitable preview/sync API | **不提供** `/api/bitable/sync/inventory_query*` |
| Excel 导入该类型 | **不做**（本期） |

## 3. 数据模型

### 3.1 `inventory_query_snapshot_runs`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| snapshot_date | date | Asia/Shanghai 业务日期 |
| synced_at | timestamptz | 实际同步时刻 |
| source | text | 如 `feishu` / `task` |
| status | text | `published` 等 |
| row_count | int | 发布行数 |
| created_at / updated_at | timestamptz | |

索引：`(snapshot_date, status)`。

### 3.2 `inventory_query_daily_snapshots`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| run_id | uuid | FK → runs |
| snapshot_date | date | 业务日期 |
| sku_id | uuid \| null | 匹配到的本地 SKU |
| sku_code | text | 飞书 SKU（归档键） |
| payload | jsonb | 该行完整飞书字段 |
| created_at / updated_at | timestamptz | |

约束/索引：

- 唯一：`(snapshot_date, sku_code)`
- 查询：`(sku_code, snapshot_date)`、`run_id`

### 3.3 发布规则

- `snapshot_date` = Asia/Shanghai 业务日；`synced_at` = 真实同步时刻
- 同日仅最后一次「成功且完整」批次生效（事务内替换同日旧 run/明细）
- 失败、空结果、或无任何有效行 → **不**覆盖已发布快照
- 缺 `SKU` 的行记 warning，不单独阻断；若整批无有效行则不发布
- 未知列原样进入 `payload`

## 4. API 与任务

### 4.1 读接口（`requireMenu('inventory.query')`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/inventory/query` | 列表；`snapshotDate`、关键词/筛选、分页 |
| GET | `/api/inventory/query/dates` | 可用归档日期 |
| GET | `/api/inventory/query/export` | CSV 导出当前筛选 |

默认读今日成功快照；今日无则回退最近成功日并返回 `stale: true` + 实际 `snapshotDate` / `syncedAt`。

### 4.2 任务

| 用途 | Endpoint |
|------|----------|
| Cron / 系统任务 | `POST /api/tasks/inventory-query-pull` |

Cron 条目：`20 7 * * *` → `/api/tasks/inventory-query-pull`（与总览 `30 7` 独立）。

## 5. 菜单、路由与页面

### 5.1 菜单

- code：`inventory.query`
- name：库存查询
- path：`/inventory/query`
- parent：`inventory`（库存管理）
- sortOrder：总览之后为 `2`；安全库存/缺货预警顺延

默认角色授权与 `inventory.overview` 相同：`super_admin`、`pmc_planner`、`warehouse`、`purchaser`、`viewer`。

### 5.2 页面行为

- 顶栏：标题、快照日期选择、stale 提示、导出、最近成功 `synced_at`
- 筛选：SKU / 品类 / 销售国家等（与 payload 字段对齐）
- 表格：飞书全列可配置显隐；默认可见列聚焦：
  - 基础：品类、SKU、SKU名称、销售国家、产品分类、生命周期
  - 在库：`海外仓库存_*`（各仓 + 合计）
  - 在途：`调拨在途_*`（各仓 + 合计）
- 行点击：右侧抽屉只读展示当日完整字段
- **无**「从飞书同步」按钮
- 不做 SKU 日趋势图（可二期）

## 6. 字段目录约定

- 权威来源：飞书表 `tblubb08s6pe6DXI` 实际字段名
- 实现时可参考本地样例 `docs/samples/kucun/库存表-SKU库存周转情况查询-明细*.xlsx`（约 200 列，含 `海外仓库存_美东`、`调拨在途_美东` 等）
- 同步时以飞书返回字段为准；样例仅作默认列分组与开发对照，不强制列数完全一致

## 7. 非范围

- 不回写飞书
- 不改库存总览（`inventory_turnover` / `inventory_daily_snapshots`）逻辑与字段
- 不写 `inventory_records`，不改变补货/预警/安全库存计算口径
- 不做该类型 Excel/CSV 上传导入
- 不做页面手动 preview/sync（`/api/bitable/sync/inventory_query*`）
- 不做 SKU 历史趋势图

## 8. 验收要点

1. 菜单「库存查询」可见，角色权限正确
2. 每天 07:20 cron 能拉取飞书并发布当日快照；系统任务页可手动触发同一任务
3. 页面可切换历史日期；今日无快照时回退并显示 stale
4. 各仓在库/在途等列可查、可导出
5. 库存总览行为与数据口径不变
