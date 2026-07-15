# 有限业务闭环 PRD

**版本**：v1.0（2026-06-25）  
**定位**：在不做正式 PO / 物流 API / 供应商门户的前提下，跑通「预测 → 补货 → PMC → 采购跟单 → 到货入库」的业务闭环。

## 1. 需求分析

### 背景

当前系统模块齐全，但用户容易停留在数据维护。本期将各模块串联为一条可验收的履约链路，让 PMC / 采购员每天从看板进入处理，直到到货回写库存。

### 用户角色

| 角色 | 权限 | 典型操作 |
|------|------|----------|
| PMC 计划员 | 预测、补货建议、PMC 计划 | 发布预测、采纳建议、确认计划、登记到货 |
| 采购员 | 采购跟单 | 供应商确认交期、跟进生产/发货、登记到货 |
| 仓库员 | 库存总览 | 查看入库结果 |
| 管理员 | 全部 | 配置角色菜单、查看看板 |

### 用户故事

- 作为 PMC，我希望发布销售预测后能看到对补货的影响，以便决策是否发布
- 作为 PMC，我希望采纳补货建议后合并到草稿计划并确认，以便下发商家
- 作为采购员，我希望在采购跟单中记录供应商确认与履约状态，以便跟踪交期
- 作为采购员，我希望登记到货后自动回写库存，以便闭环完成
- 作为管理者，我希望在看板看到闭环漏斗与异常待办，以便定位卡点

## 2. 闭环流程

```mermaid
flowchart LR
  forecastPublish["销售预测发布"] --> replenishmentTask["补货预测任务"]
  replenishmentTask --> reorderSuggestion["补货建议"]
  reorderSuggestion --> pmcPlan["PMC计划"]
  pmcPlan --> purchaseTracking["采购跟单"]
  purchaseTracking --> supplierConfirm["供应商确认"]
  supplierConfirm --> inboundReceipt["到货登记"]
  inboundReceipt --> inventoryUpdate["库存回写"]
  inventoryUpdate --> dashboard["闭环看板"]
```

## 3. 数据模型变更

### 表：purchase_drafts（采购跟单 — 扩展）

| 字段 | 类型 | 说明 |
|------|------|------|
| plan_item_id | uuid FK | 关联 pmc_plan_items.id |
| supplier_confirmed_at | timestamptz | 供应商确认时间 |
| confirmed_delivery_date | date | 供应商承诺交期 |
| actual_ship_date | date | 实际发货日期 |
| actual_received_date | date | 最近收货日期 |
| received_qty | int | 累计收货数量 |
| exception_reason | text | 异常原因 |
| owner_user_id | uuid FK | 责任人 |

### 状态机：purchase_drafts.status

```
draft → confirmed → in_production → ready_to_ship → in_transit → partial_received → received
  ↓         ↓            ↓              ↓              ↓
cancelled  exception ←────────────────────────────────┘
              ↓
          confirmed（恢复）
```

| 状态 | 展示名 | 说明 |
|------|--------|------|
| draft | 待确认 | 计划确认后自动生成 |
| confirmed | 已确认 | 供应商已确认交期 |
| in_production | 生产中 | 工厂生产中 |
| ready_to_ship | 待发货 | 生产完成待发货 |
| in_transit | 在途 | 已发货在途 |
| partial_received | 部分到货 | 累计收货 < 计划数量 |
| received | 已收货 | 全部到货 |
| exception | 异常 | 需人工处理 |
| cancelled | 已取消 | 终止跟单 |

**兼容**：历史 `submitted` 迁移为 `confirmed`。

## 4. 页面流程

| 页面 | 路由 | 闭环动作 |
|------|------|----------|
| 销售预测 | /data/forecast | 发布前影响预览 |
| 补货建议 | /pmc/suggestions | 采纳 → PMC 草稿 |
| PMC 详情 | /pmc/:id | 确认计划、查看跟单、到货登记 |
| 采购跟单 | /pmc/tracking | 确认交期、状态推进、到货登记 |
| 经营看板 | /dashboard | 闭环漏斗、风险待办 |

## 5. 业务规则

### 预测 → 补货

- 补货预测任务优先使用**已发布**销售预测版本（按站点）
- 补货建议 `metrics` 记录 `demandSource`、`forecastVersionId`
- 看板展示当前补货口径版本

### 到货回写

- 采购跟单或 PMC 详情登记到货时：
  1. 写入 `inventory_records`（source=pmc_receipt）
  2. 更新 `pmc_plan_items.completed_qty`
  3. 更新 `purchase_drafts.received_qty` 与状态
  4. 全部行完成时 PMC 计划 → `completed`

## 6. 本期不做

- 正式采购单 / PO 审批
- 采购合同、付款
- 物流轨迹 API、订舱
- 报关单证
- 供应商门户

## 7. 验收标准

- [ ] 销售预测发布后可预览补货影响
- [ ] 补货建议展示需求口径（预测/历史）
- [ ] 补货建议 → PMC 计划 → 采购跟单链路通畅
- [ ] 采购跟单支持履约状态流转
- [ ] 到货登记回写库存与 PMC 进度
- [ ] 看板展示闭环漏斗与异常待办
- [ ] 全站文案保持「采购跟单」，非「采购单」
