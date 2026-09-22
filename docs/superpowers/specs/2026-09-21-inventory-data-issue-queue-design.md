# 库存数据异常队列（来源治理）

**版本**：v1.0（2026-09-21）  
**定位**：把现网已经静默跳过的脏数据做成可处理工单，与健康异常单（缺货/积压）分开。  
**本期不做**：96% 完整度仪表盘、SKU 新旧映射表、双跟单对账、迅捷/WMS 连接器、网络优化求解器。

**关联**：S&OP Demo 数据治理页；`2026-09-17` 时间轴；`2026-09-18` 分仓投影；已确认落地顺序第 1 步。

用户确认：要 Demo 的「问题 / 影响模块 / 示例 / 处理」清单，不要分数盘；数据队列与行动工作台分表。

---

## 1. 背景与目标

规划引擎已经会：

- 无 `available_at` 的批次不进时间轴
- 无销售占比的 OVERSEAS 跳过 7/15/30
- 占比合计偏离 100% 仍相对拆仓并只给文案

这些行为正确，但没有工单。`inventory_exceptions` 扫的是健康灯结果，不是数据原因。

成功标准：

- 每日流水线在三池同步后扫描，把上述三类问题 upsert 成开放工单。
- 页面可按类型筛选、处理（处理中 / 已解决 / 忽略）。
- 扫描不再检出时，开放工单自动结案；已忽略的指纹本轮不重开。
- 不改时间轴公式、不改健康灯、不把数据问题写入 `inventory_exceptions`。

---

## 2. 决策摘要

| 项 | 选择 |
|----|------|
| 载体 | 新表 `inventory_data_issues`，不扩健康异常枚举 |
| 本期类型 | `missing_available_at` / `unallocated_warehouse` / `share_sum_mismatch` |
| 检测 | 纯函数 `detectInventoryDataIssues`，扫描任务只负责读库与 upsert |
| 粒度 | SKU × 仓 × 类型 × 来源指纹；无期批次按 lot 来源一条 |
| 消失 | 本轮未检出的 `open`/`in_progress` → `resolved`，备注 `scan_cleared` |
| 忽略 | `dismissed` 同指纹本轮不 insert |
| 菜单 | `inventory.data_issues` → `/inventory/data-issues` |
| 权限 | 与库存总览相同角色可读；写操作用现有登录用户 |
| 分数盘 | 不做；列表上方只显示各类型开放条数 |

---

## 3. 检测规则

输入：开放供给批次 + SKU 的海外在库（`inventory_records` OVERSEAS 最新快照）+ 周转占比解析。

| 类型 | 条件 | 影响模块 | 仓 | 数量 |
|------|------|----------|----|------|
| `missing_available_at` | lot `status=open` 且 `qty>0` 且（`dateUnknown` 或 `availableAt` 空） | `timeline` | lot 目的仓 | lot.qty |
| `unallocated_warehouse` | OVERSEAS `qtyAvailable>0` 且占比 `method=unallocated` | `horizon` | `OVERSEAS` | 海外在库 |
| `share_sum_mismatch` | 占比 `shareSumWarning=true` | `planning` | `OVERSEAS` | 海外在库 |

指纹：

- 无期：`missing_available_at:{skuId}:{warehouse}:{source}:{sourceId\|\|none}`
- 未分仓：`unallocated_warehouse:{skuId}:OVERSEAS`
- 占比：`share_sum_mismatch:{skuId}:OVERSEAS`

同一 SKU 可同时有未分仓与无期批次（不同类型）。未分仓与占比偏离互斥（`unallocated` 时 `shareSumWarning=false`）。

示例文案（中文，供列表）：

- 无期：`{pool} 批次 {sourceId} 缺可用日，不进时间轴`
- 未分仓：`飞书无销售占比，海外在库 {qty} 停在 OVERSEAS，7/15/30 不可用`
- 占比：`销售占比合计 {shareSum}，已按相对权重拆仓`

---

## 4. 架构

```text
lots + records(OVERSEAS) + encoding_meta 占比
        → detectInventoryDataIssues
        → upsertInventoryDataIssues
                ↓
     GET /api/inventory/data-issues
     PATCH /api/inventory/data-issues/:id
     数据问题页
```

任务挂在每日流水线 `supply_lot_sync` 之后；也可单独 `POST /api/tasks/inventory-data-issue-scan`。digest 增加「待处理数据问题」条数。规划驾驶舱加一张卡片入口。

---

## 5. 非范围

- 查询表 vs 周转表数量差、双跟单、SKU 替换映射：有数据源后再加类型，不改表结构以外的枚举扩展方式（后续 `ALTER TYPE ... ADD VALUE`）。
- 不自动改 lots 日期、不自动写占比、不阻断补货任务。
- 不与 `inventory_exceptions` 联表展示。
