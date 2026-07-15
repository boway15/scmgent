# 阶段一 MVP 闭环：预测 → 补货 → PMC → 采购跟单 → 到货入库

## 目标

在 0-3 个月内跑通「预测驱动 + AI 建议 + 人工确认 + 到货回写」的最小供应链闭环，不自动下单、不对接销售平台 API。

完整 PRD 见 [mvp-business-loop.md](mvp-business-loop.md)。

## 流程

```mermaid
flowchart LR
  feishuBitable[FeishuBitable] --> sync[DataSync]
  sync --> forecast[ReplenishmentForecast]
  forecast --> suggestions[ReorderSuggestions]
  suggestions --> pmcReview[PMCReview]
  pmcReview --> pmcPlan[PmcPlanDraft]
  pmcPlan --> confirm[PlanConfirmed]
  confirm --> purchaseDraft[PurchaseDraft]
  purchaseDraft --> supplierConfirm[SupplierConfirm]
  supplierConfirm --> inboundReceipt[InboundReceipt]
  inboundReceipt --> inventoryUpdate[InventoryUpdate]
  inventoryUpdate --> dashboard[ClosedLoopDashboard]
```

## 步骤说明

### 1. 数据同步（每日 / 手动）

- 飞书多维表格 → `/api/bitable/sync/:type`
- 支持：skus、inventory、sales、merchants、warehouse_leads、inventory_policy
- 本地入口：数据中心 → 数据导入

### 2. 补货预测（Cron 09:00 / 手动）

- 任务：`POST /api/tasks/replenishment-forecast`
- 算法：`apps/web/server/lib/replenishment-coverage.ts`
- 输入：销量、库存（可售+在途+在产）、生产周期、海运周期、库存策略
- 输出：`reorder_suggestions`（含健康灯、覆盖天数、结构化 metrics）

健康灯定义：

| 灯号 | 条件 |
|------|------|
| 红灯 | 覆盖天数 < 总提前期（生产+海运+入仓缓冲） |
| 黄灯 | 覆盖天数 < 总提前期 + 安全库存天数 |
| 健康 | 介于黄灯与超备之间 |
| 超备 | 覆盖天数 > 超备阈值（默认 180 天） |

### 3. PMC 确认建议

- 页面：`/pmc/suggestions`
- 操作：采纳 → 合并到同商家+目标仓草稿计划；忽略
- API：`PATCH /api/reorder/suggestions/:id`

### 4. 计划确认 → 采购草稿

- 页面：`/pmc/list` → 计划详情
- 状态：`draft` → `confirmed`
- 确认后自动生成 `purchase_drafts`（source=pmc）
- API：`PATCH /api/pmc/plans/:id/status`

### 5. 销售预测发布（人工）

- 页面：`/data/forecast`
- 发布前校验 + 影响预览（影响 SKU 数、红黄灯变化）
- 补货预测任务使用已发布版本作为需求口径

### 6. 采购跟单履约

- 页面：`/pmc/tracking`
- 状态：待确认 → 已确认 → 生产中 → 待发货 → 在途 → 部分到货 → 已收货
- 支持供应商确认交期、标记异常、登记到货

### 7. 到货入库回写

- 入口：PMC 详情或采购跟单「登记到货」
- API：`POST /api/pmc/plans/:id/items/:itemId/receive` 或 `POST /api/purchase-drafts/:id/receive`
- 回写 `inventory_records`（source=pmc_receipt），更新 PMC 行完成量

### 8. 采购跟进提醒（可选）

- 计划确认时为每条采购跟单创建 T-30 / T-14 / T-7 提醒节点
- 任务：`POST /api/tasks/purchase-follow-up`（建议每日 08:00）

## 阶段一明确不做

- 采购合同自动生成与发送工厂
- 质检 checklist / 图片 AI 分析
- 船期推荐、订舱委托书、货代 API
- 运营智能体（竞品、广告、Listing）
- 销售平台 API 直连

## 验收 KPI

| 指标 | 目标 |
|------|------|
| 补货建议采纳率 | ≥ 50%（上线 1 个月） |
| 建议修改幅度 | 平均调整量 < 30% |
| 红灯 SKU 数 | 环比下降 |
| 飞书同步成功率 | ≥ 95% |
| PMC 计划生成耗时 | < 30 秒/次预测 |
