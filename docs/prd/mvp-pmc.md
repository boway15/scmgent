# MVP PRD：PMC 需求计划（平台 → 商家）

**版本**：v2.0（2026-06-06 修订）  
**定位**：平台向商家下发的 SKU 需求计划，**不含 BOM / 物料拆解**。本期不做正式采购单。

## 1. 需求分析

### 背景

跨境供应链中，平台需按商家、目标仓、交期汇总 SKU 需求量，形成可下发商家的计划单。商家线下或飞书确认后，平台在系统内跟踪执行进度。

### 用户角色

| 角色 | 操作 |
|------|------|
| PMC 计划员 | 创建/合并计划、导出计划发给商家、更新状态 |
| 采购员 | 查看计划、维护采购跟单台账 |
| 仓库员 | 查看计划与执行进度 |
| 管理员 | 全部 |

### 用户故事

- 作为 PMC 计划员，我希望将补货建议合并为同商家草稿计划，以便统一下发
- 作为 PMC 计划员，我希望导出 Excel/CSV 计划单，以便人工发送给商家
- 作为采购员，我希望计划确认后自动生成采购跟单记录，以便内部跟踪商家履约

---

## 2. 数据模型

### 表：pmc_plans（需求计划头）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | |
| plan_no | varchar(100) | ✅ ✦唯一 | 计划编号（PMC-YYYYMM0001） |
| name | varchar(200) | ✅ | 计划名称 |
| merchant_code | varchar(100) | ✅ | 商家编号 |
| merchant_name | varchar(200) | | 商家名称 |
| target_warehouse_code | varchar(100) | | 目标入库仓（一计划一商家一仓） |
| plan_date | date | ✅ | 计划日期 |
| delivery_date | date | ✅ | 交期 |
| status | enum | ✅ | `draft` / `confirmed` / `in_progress` / `completed` / `cancelled` |
| remark | text | | 备注 |
| created_by | uuid FK | | |
| created_at / updated_at | timestamptz | ✅ | |

**索引**：`(status, plan_date)`

### 表：pmc_plan_items（计划行 — SKU）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | |
| plan_id | uuid | ✅ FK | |
| sku_id | uuid | ✅ FK | |
| planned_qty | int | ✅ | 计划数量 |
| completed_qty | int | | 已完成数量 |
| warehouse_code | varchar(100) | | 行级目标仓 |
| unit | varchar(20) | ✅ | 单位 |
| sort_order | int | | 行序号 |

### 表：purchase_drafts（采购跟单 — 内部台账）

> 表名保留兼容；产品名称为 **采购跟单**，非采购单。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | |
| draft_no | varchar(100) | ✅ ✦唯一 | 跟单单号 |
| sku_id | uuid | ✅ FK | |
| qty | int | ✅ | 跟单数量 |
| expected_date | date | | 期望交期 |
| source | enum | ✅ | `pmc` / `reorder` / `manual` |
| source_ref_id | uuid | | 来源计划 id |
| status | enum | ✅ | `draft` / `confirmed` / `in_production` / `ready_to_ship` / `in_transit` / `partial_received` / `received` / `exception` / `cancelled` |
| plan_item_id | uuid FK | | 关联 pmc_plan_items |
| supplier_confirmed_at | timestamptz | | 供应商确认时间 |
| confirmed_delivery_date | date | | 供应商承诺交期 |
| actual_ship_date | date | | 实际发货日期 |
| actual_received_date | date | | 最近收货日期 |
| received_qty | int | | 累计收货数量 |
| exception_reason | text | | 异常原因 |
| owner_user_id | uuid FK | | 责任人 |
| remark | text | | |
| created_by | uuid FK | | |

---

## 3. 页面流程

### 计划列表（`/pmc/list`）

- 列表：计划编号、名称、商家、目标仓、计划日期、交期、状态
- 操作：新建、批量导入、**导出 CSV**（按行）、确认计划、状态推进
- 补货建议采纳后自动合并到同商家+同仓草稿计划

### 计划详情（`/pmc/:id`）

- 计划头信息 + SKU 行（计划数量、已完成数量）
- **导出 CSV**（供人工发给商家）
- 草稿状态：「确认计划并生成采购跟单」

### 采购跟单（`/pmc/tracking`）

- 计划确认后自动生成的内部跟单列表
- 操作：确认交期、标记生产中/待发货/在途、登记到货、标记异常、取消
- 登记到货后回写库存并更新 PMC 计划行进度
- 数据不可手工新建（403）

### 导入计划（`/data/import?type=pmc_plans`）

| sku_code | planned_qty | delivery_date | merchant_code | remark |
|----------|-------------|---------------|---------------|--------|

---

## 4. 业务逻辑

### 计划状态机

```
draft → confirmed → in_progress → completed
  ↓                      ↓
cancelled            cancelled
```

### 确认计划（A + C）

1. 状态 `draft` → `confirmed`
2. **不**自动飞书推送（人工导出后线下/飞书发送）
3. 按 plan_items 写入 `purchase_drafts`（采购跟单台账）

### 计划导出 CSV 字段

**表头区（首行注释或独立段）**：plan_no, name, merchant_code, merchant_name, target_warehouse, plan_date, delivery_date

**明细行**：sku_code, sku_name, planned_qty, unit, warehouse_code

### 补货建议合并规则

- 同 `merchant_code` + `target_warehouse_code` + `status=draft` 的计划合并行
- 同 SKU 累加 `planned_qty`

---

## 5. 集成

| 集成点 | 本期 | 说明 |
|--------|------|------|
| 飞书推送计划 | 不做 | 人工导出后发送 |
| 正式采购单 | 不做 | 采购跟单仅为内部台账 |
| 飞书预警群 | 可选 | 与库存预警共用插件 |

---

## 6. 质量检查

- [ ] 一计划一商家一仓
- [ ] 确认后采购跟单条数 = 计划行数
- [ ] 导出 CSV 含商家与 SKU 明细
- [ ] 全站文案无「采购单」「确认下单」误导
