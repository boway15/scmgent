# 采购运营 × 飞书多维表格同步设计

## 1. 背景与目标

业务在飞书 Base「供应链/采购」多维表格（与库存周转、库存查询、大件备货、供应商跟单同源）中维护 **采购运营** 宽表，需在 scm-agent **库存运营** 模块内只读查阅，并每日自动入湖。

飞书表：

- Base：`HPJzbHdPea7elSs92T8c31BTnxe`
- 表：`tblWUnYLwD8UATAS`
- 视图：`vewh32YnLB`（仅业务定位）
- 链接：https://chinabestwo.feishu.cn/base/HPJzbHdPea7elSs92T8c31BTnxe?table=tblWUnYLwD8UATAS&view=vewh32YnLB

目标：

1. 在 **库存运营** 下新增菜单 **采购运营**（只读日快照，非「采购发运」下的大件备货/跟单）
2. 每日 **06:00**（Asia/Shanghai）单向拉取飞书 → 本地按日归档
3. 页面镜像飞书列（可切换历史日期、筛选、导出）
4. **不改**库存总览、库存查询、补货/预警/三池口径；**不回写**飞书

## 2. 决策

| 项 | 选择 |
|----|------|
| 实现方案 | **方案 A**：平行复制「库存查询」链路（独立表 + 独立任务 + 独立页面） |
| 飞书应用 | 现有 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`（与 OAuth、其他 Bitable 拉取相同） |
| App Token | 优先 `FEISHU_BITABLE_PROCUREMENT_APP_TOKEN`，否则 `FEISHU_BITABLE_APP_TOKEN` |
| Table | `FEISHU_BITABLE_TABLE_PROCUREMENT_OPS=tblWUnYLwD8UATAS` |
| 视图 | `vewh32YnLB` 仅定位；同步 **整表** 拉取，不按视图过滤 |
| 同步类型（拉取 guard） | `procurement_ops`（`upload-guard` 行数上限建议 50_000，与库存查询同级） |
| 任务形态 | HTTP + `X-Cron-Secret`；Compose cron `0 6 * * *` |
| `task_runs.taskName` | `procurement_ops_pull`（已有 `running` 则跳过并记失败） |
| 字段权威 | 飞书列原名原样写入 `payload` JSONB |
| SKU 关联 | 复用库存查询 SKU 别名解析；匹配 `skus.sku_code` 填 `sku_id`，匹配不到仍归档 |
| 商业状态 | **本期不同步**到 `skus.commercial_status`（避免未知列误写主数据） |
| 页面手动同步 | **不做**；仅 cron + 系统任务页触发 |
| Bitable preview/sync API | **不提供** `/api/bitable/sync/procurement_ops*` |
| Excel 导入 | **不做**（本期） |
| 与其他 morning 任务 | 仅新增 06:00 采购运营；**07:20** 库存查询、**07:40** 库存周转等现网时刻 **不变** |

## 3. 数据模型

### 3.1 `procurement_ops_snapshot_runs`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| snapshot_date | date | Asia/Shanghai 业务日期 |
| synced_at | timestamptz | 实际同步时刻 |
| source | varchar(50) | 默认 `feishu-bitable` |
| status | varchar(20) | `published` / `superseded` 等 |
| row_count | int | 发布行数 |
| columns | jsonb | 飞书字段名顺序 |
| created_at | timestamptz | |

索引：`(snapshot_date, status)`。

### 3.2 `procurement_ops_daily_snapshots`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| run_id | uuid | FK → runs，`on delete cascade` |
| snapshot_date | date | 业务日期 |
| sku_id | uuid \| null | 匹配到的本地 SKU |
| sku_code | varchar(100) | 飞书 SKU（归档键，非唯一） |
| payload | jsonb | 该行完整飞书字段 |
| created_at | timestamptz | |

索引：

- `(snapshot_date, sku_code)` — **非唯一**（同一 SKU 可多行）
- `(sku_code, snapshot_date)`
- `(run_id)`

### 3.3 发布规则

- `snapshot_date` = Asia/Shanghai 业务日；`synced_at` = 真实同步时刻
- 事务内：`pg_advisory_xact_lock(hashtext('procurement-ops-snapshot:' + snapshot_date))`
- 同日旧 `published` run 标 `superseded`，删除同日旧明细后插入新批次
- 失败、空结果、或整批无有效 SKU 行 → **不**覆盖已发布快照
- 缺 SKU 的单行计 `warningCount`；若 `items.length === 0` 则抛错不发布
- 未知列原样进入 `payload`

## 4. API 与任务

### 4.1 读接口（`requireMenu('inventory.procurement_ops')`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/inventory/procurement-ops` | 列表：`snapshotDate`、关键词、常见 payload 筛选、分页、`productScope`（有 SKU 时） |
| GET | `/api/inventory/procurement-ops/dates` | 可用归档日期 |
| GET | `/api/inventory/procurement-ops/export` | CSV 导出当前筛选 |

默认读当日成功快照；当日无则回退最近成功日，响应带 `stale: true` 及实际 `snapshotDate` / `syncedAt`（与库存查询一致）。

### 4.2 任务

| 用途 | Endpoint |
|------|----------|
| Cron / 系统任务 | `POST /api/tasks/procurement-ops-pull` |

Cron：`0 6 * * *` → `/api/tasks/procurement-ops-pull`。

实现文件建议（对齐库存查询命名）：

- `apps/web/server/lib/procurement-ops-feishu-pull.ts`
- `apps/web/server/lib/procurement-ops-feishu-mapper.ts`（可先 re-export/共用 SKU 解析，payload 映射独立）
- `apps/web/server/lib/procurement-ops-snapshot.ts`
- `apps/web/server/lib/procurement-ops-pull-task.ts`
- `apps/web/server/lib/procurement-ops-service.ts`（列表筛选/分页）
- `apps/web/server/tasks/procurementOpsPull.ts`
- 路由：`inventory.ts` 增加读 API；`tasks.ts` 增加 pull

## 5. 菜单、路由与页面

### 5.1 菜单

- code：`inventory.procurement_ops`
- name：采购运营
- path：`/inventory/procurement-ops`
- parent：`inventory`（库存运营）
- sortOrder：`65`（紧挨 `inventory.query` 的 60）

默认角色授权与 `inventory.query` 相同：`super_admin`、`pmc_planner`、`warehouse`、`purchaser`、`viewer`。

迁移：幂等 `INSERT ... WHERE NOT EXISTS` + `role_menus` 与 `inventory.query` 同范围。

### 5.2 前端

- 路由：`/inventory/procurement-ops` → `ProcurementOpsPage.tsx`
- 交互克隆 `InventoryQueryPage`：日期、stale、导出、列选择器、行详情抽屉
- 列显隐 localStorage 独立 key（如 `scm.procurement-ops.visible-columns-v1`）
- **无**「从飞书同步」按钮
- 若 payload 含可识别 SKU 列，启用 `ProductScopeSwitch`；否则隐藏配件范围开关

### 5.3 默认可见列

- **权威来源**：实现首日调用 `listBitableFields` 对 `tblWUnYLwD8UATAS` 探测，将推荐默认列写入 `procurement-ops-columns.ts`（或同目录常量）
- 探测前 spec 不臆测列名；至少保证 `SKU`（或别名）在默认集中（若表存在）

## 6. 配置与运维

```env
FEISHU_BITABLE_PROCUREMENT_APP_TOKEN=HPJzbHdPea7elSs92T8c31BTnxe
# 或与主数据共用：
# FEISHU_BITABLE_APP_TOKEN=...
FEISHU_BITABLE_TABLE_PROCUREMENT_OPS=tblWUnYLwD8UATAS
```

前置：飞书应用已开通 Bitable 权限，且为表协作者。

文档更新（实现 PR 内）：

- `docs/feishu-bitable-sync.md` — 环境变量与任务表
- `docs/business/scm-sop-operating-standard.md` — 日节奏增加 06:00 采购运营拉取
- `apps/web/src/lib/scheduled-tasks.ts` — 与 `deploy/cron/crontab` 对齐

## 7. 非范围

- 不回写飞书
- 不复用 `procurement_list_rows` / 大件备货、供应商跟单双向列表
- 不写 `inventory_records`、不驱动补货/预警/三池/PMC 规划
- 不做通用「飞书日快照引擎」重构（不先改库存查询）
- 不做页面 bitable preview/sync、不做 CSV 上传导入

## 8. 验收要点

1. 菜单「采购运营」在库存运营下可见，角色权限与库存查询一致
2. 配置 env 后，`POST /api/tasks/procurement-ops-pull`（带 `X-Cron-Secret`）成功写入 `task_runs` 并发布当日快照
3. Cron 06:00 自动执行；系统任务页可手动触发同一任务
4. 页面可切换历史日期；当日无快照时 stale 回退；列表/导出与飞书列一致
5. 库存总览、库存查询、补货与预警行为与数据口径不变

## 9. 附录：与库存查询对照

| 维度 | 库存查询 | 采购运营 |
|------|----------|----------|
| 表 ID | `tblubb08s6pe6DXI` | `tblWUnYLwD8UATAS` |
| 菜单 code | `inventory.query` | `inventory.procurement_ops` |
| Cron | 07:20 | 06:00 |
| taskName | `inventory_query_pull` | `procurement_ops_pull` |
| 商业状态回写 | 有（query snapshot） | 无（本期） |
| DB 表前缀 | `inventory_query_*` | `procurement_ops_*` |
