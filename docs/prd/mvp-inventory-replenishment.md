# MVP PRD：库存管理 + 补货预测 + 缺货预警

## 1. 需求分析

### 背景
跨境供应链采购周期长（30-90 天），库存断货代价高。MVP 需帮助 PMC/采购员：
- 设定安全库存水位
- 自动预测补货时间点和数量
- 在库存低于安全水位时及时预警

### 数据来源（MVP）
- **手工录入**：SKU 基础信息、初始库存
- **表格导入**（CSV/Excel）：历史销量数据、入库记录

### 用户角色

| 角色 | 操作 |
|------|------|
| 仓库员 | 录入/导入库存数据，查看预警 |
| 采购员 | 查看补货建议，确认采购 |
| PMC 计划员 | 配置安全库存参数，查看预测 |
| 管理员 | 全部 |

---

## 2. 数据模型

### 表：skus（SKU 主数据）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | 主键 |
| code | varchar(100) | ✅ ✦唯一 | SKU 编号 |
| name | varchar(200) | ✅ | 商品名称 |
| unit | varchar(20) | ✅ | 单位（pcs/kg/箱） |
| category | varchar(100) | | 品类 |
| lead_time_days | int | | 采购交期（天） |
| moq | int | | 最小起订量 |
| unit_cost | numeric(12,4) | | 单价 |
| is_active | boolean | ✅ | 是否启用 |
| created_at | timestamptz | ✅ | |
| updated_at | timestamptz | ✅ | |

---

### 表：safety_stock_config（安全库存配置）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | |
| sku_id | uuid | ✅ ✦唯一 FK | FK → skus.id |
| safety_stock_qty | int | ✅ | 安全库存数量（人工设定或计算） |
| reorder_point | int | ✅ | 补货触发点（ROP） |
| reorder_qty | int | ✅ | 建议补货数量（EOQ） |
| review_cycle_days | int | | 盘点周期（天） |
| service_level | numeric(4,2) | | 服务水平（0.95） |
| calc_method | enum | ✅ | `manual` / `eoq` / `dify_ai` |
| last_calc_at | timestamptz | | 最近计算时间 |
| updated_at | timestamptz | ✅ | |

---

### 表：inventory_records（库存台账）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | |
| sku_id | uuid | ✅ FK | |
| warehouse | varchar(100) | ✅ | 仓库（国内仓/海外仓/在途） |
| qty_available | int | ✅ | 可用数量 |
| qty_in_transit | int | | 在途数量 |
| qty_reserved | int | | 冻结数量 |
| recorded_date | date | ✅ | 盘点日期 |
| source | enum | ✅ | `manual` / `import` |
| created_by | uuid FK | | 操作人 |
| created_at | timestamptz | ✅ | |

---

### 表：sales_history（销量历史）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | |
| sku_id | uuid | ✅ FK | |
| sale_date | date | ✅ | 销售日期 |
| qty_sold | int | ✅ | 销量 |
| channel | varchar(100) | | 销售渠道 |
| source | enum | ✅ | `manual` / `import` |
| created_at | timestamptz | ✅ | |

**索引**：`(sku_id, sale_date)`

---

### 表：reorder_suggestions（补货建议）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | |
| sku_id | uuid | ✅ FK | |
| suggested_qty | int | ✅ | 建议补货量 |
| suggested_date | date | ✅ | 建议下单日期 |
| reason | text | | AI 生成的建议原因 |
| status | enum | ✅ | `pending` / `accepted` / `ignored` |
| generated_at | timestamptz | ✅ | |
| reviewed_by | uuid FK | | 确认人 |

---

### 表：stock_alerts（缺货预警）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | |
| sku_id | uuid | ✅ FK | |
| alert_type | enum | ✅ | `below_safety` / `below_rop` / `stockout` |
| current_qty | int | ✅ | 预警时库存 |
| safety_qty | int | ✅ | 安全库存阈值 |
| notified_at | timestamptz | ✅ | 推送时间 |
| is_resolved | boolean | ✅ | 是否已处理 |
| resolved_at | timestamptz | | |

---

## 3. 页面流程

### 库存总览（`/inventory/overview`）
- 列表：SKU + 当前可用库存 + 在途 + 安全库存线 + 状态标签（正常/预警/缺货）
- 支持按品类/仓库筛选、CSV 导出

### 安全库存设置（`/inventory/safety`）
- 列表+行内编辑：每个 SKU 的安全库存、ROP、EOQ
- 支持 `手动设置` 和 `AI 计算`（调用 Dify 工作流）
- 批量导入（CSV）

### 缺货预警（`/inventory/alerts`）
- 预警列表（按严重程度排序）
- 点击「生成补货建议」→ 触发 Dify 工作流 → 写入 reorder_suggestions
- 标记已处理

### 补货建议（`/reorder/suggestions`）
- 展示 AI 生成的补货建议
- 操作：采纳 → 跳转创建采购单 / 忽略

---

## 4. 业务逻辑

### 安全库存计算（Dify 工作流）
```
输入：sku_id，历史销量（90天），交期，服务水平
计算：
  平均日销量 = sum(qty_sold) / 90
  销量标准差 σ
  安全库存 = Z * σ * √lead_time_days
  ROP = 平均日销量 * lead_time_days + 安全库存
  EOQ = √(2 * D * S / H)  // D=年需求, S=订货成本, H=持有成本
输出：safety_stock_qty, reorder_point, reorder_qty
```

### 缺货预警自动化任务（妙搭 Cron：每日 07:00）
```typescript
// server/tasks/stockAlert.ts
1. 查询所有启用 SKU 的最新库存 qty_available
2. 对比 safety_stock_config.reorder_point
3. 如 qty_available < reorder_point：
   - 写入 stock_alerts
   - 调用 Dify 预警工作流（生成摘要）
   - 飞书消息推送至预警群
```

### 状态标签规则
| 状态 | 条件 |
|------|------|
| 缺货 | qty_available ≤ 0 |
| 危险 | qty_available < safety_stock_qty |
| 预警 | qty_available < reorder_point |
| 正常 | qty_available ≥ reorder_point |

---

## 5. 数据导入规范

### 销量导入 CSV 格式
| sku_code | sale_date | qty_sold | channel |
|----------|-----------|----------|---------|
| SKU-HM-001 | 2026-05-01 | 120 | wayfair |

### 库存导入 CSV 格式
| sku_code | warehouse | qty_available | qty_in_transit | recorded_date |
|----------|-----------|---------------|----------------|---------------|
| SKU-HM-001 | US-WEST | 500 | 200 | 2026-05-31 |

---

## 6. 集成

| 集成点 | 平台 | 接口 |
|--------|------|------|
| 安全库存 AI 计算 | Dify | POST /v1/workflows/run (replenishment) |
| 补货建议生成 | Dify | POST /v1/workflows/run (replenishment) |
| 缺货预警摘要 | Dify | POST /v1/workflows/run (alert) |
| 飞书群消息推送 | 妙搭自动化任务插件 | 内置飞书消息插件 |
