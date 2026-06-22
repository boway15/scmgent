---
name: scm-domain
description: >-
  跨境电商供应链领域知识，含采购、仓储、物流、报关、合规。
  Use when designing SCM features, cross-border e-commerce workflows,
  supplier/inventory/logistics/customs modules, or supply chain agent logic.
---

# 跨境电商供应链领域

## 核心域

| 域 | 实体 | 关键流程 |
|----|------|----------|
| 采购 | 供应商、询价、PO | 询比价 → 下单 → 跟单 |
| 仓储 | SKU、批次、库位 | 入库 → 拣货 → 出库 |
| 物流 | 运单、渠道、轨迹 | 头程 → 清关 → 尾程 |
| 报关 | HS编码、单证、申报 | 制单 → 申报 → 放行 |
| 合规 | 禁限品、认证、标签 | 品类审查 → 上架 |

## 跨境特有概念

### 贸易模式
- **B2C 直邮**：小包、低货值、简清关
- **B2B2C 保税**：保税仓、清单核放
- **一般贸易**：正式报关、可退税

### 关键单证
- 商业发票（Commercial Invoice）
- 装箱单（Packing List）
- 报关单（Customs Declaration）
- 原产地证（CO）

### 物流节点
```
供应商 → 国内仓 → 出口报关 → 国际运输 → 进口清关 → 海外仓/FBA → 消费者
```

## 智能体场景映射

| Agent | 输入 | 输出 | 数据依赖 |
|-------|------|------|----------|
| procurement | 需求计划、历史 PO | 供应商推荐、PO 草稿 | suppliers, price_history |
| inventory | 销量、在途、安全库存 | 补货建议、预警 | skus, stock, forecasts |
| logistics | 运单号、渠道 | ETA、异常报告 | shipments, tracking_events |
| compliance | SKU 属性、目的国 | 风险等级、所需单证 | hs_codes, regulations |

## MVP 建议范围

**Phase 1**（妙搭完整应用）
- 供应商管理
- SKU 主数据
- 采购单 CRUD + 审批
- 基础库存视图

**Phase 2**（+ aily Agent）
- 物流追踪自动化任务
- 补货预警 Agent
- 合规审查 Agent

**Phase 3**
- ERP/WMS API 集成
- 多币种、多仓库
- 报关单证生成

## 数据模型要点

### SKU 跨境字段
- `hs_code`：海关编码
- `origin_country`：原产国
- `declared_value`：申报价值
- `weight_kg` / `dimensions_cm`
- `battery_type` / `liquid`：禁限品标识

### 采购单状态
`draft` → `pending_approval` → `confirmed` → `in_production` → `shipped` → `received` → `closed`

### 库存维度
- 物理仓 + 逻辑仓（在途、待检、可用、冻结）
- 跨境需区分：国内仓 / 海外仓 / FBA / 在途
