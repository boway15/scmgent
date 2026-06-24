# 阶段一飞书多维表格主数据规范

阶段一不对接销售平台 API，飞书多维表格作为唯一业务数据入口。本规范定义各表字段、同步顺序与系统映射。

## 同步顺序

1. `merchants`（工厂/供应商）
2. `warehouse_leads`（航线周期）
3. `skus`（SKU 主数据）
4. `sales_forecast`（销量预测宽表，**补货主口径**）
5. `inventory_policy`（库存策略）
6. `inventory`（库存快照）
7. `sales`（历史销量，可选回退）

PMC 确认结果由系统写回应用内 `pmc_plans` / `reorder_suggestions`，阶段一可选在飞书维护「PMC 确认台账」供人工对账，不强制双向同步。

## 表：工厂资料（merchants）

| Bitable 列名 | 导入字段 | 必填 | 说明 |
|--------------|----------|------|------|
| 工厂编码 | merchant_code | ✅ | 与 SKU 关联 |
| 工厂名称 | merchant_name | ✅ | |
| 生产周期 | production_lead_days | | 默认 50 天 |
| 联系人 | contact_name | | |
| 联系电话 | contact_phone | | |
| 付款条件 | payment_terms | | |

环境变量：`FEISHU_BITABLE_TABLE_MERCHANTS`

## 表：航线周期（warehouse_leads）

| Bitable 列名 | 导入字段 | 必填 | 说明 |
|--------------|----------|------|------|
| 仓库编码 | warehouse_code | ✅ | US-WEST / US-EAST 等 |
| 海运周期 | shipping_lead_days | ✅ | 美西 45，美东/南/东南 60，德国 80 |
| 入仓缓冲 | inbound_buffer_days | | 默认 7 天 |

环境变量：`FEISHU_BITABLE_TABLE_WAREHOUSE_LEADS`

## 表：SKU 主数据（skus）

在原有字段基础上新增：

| Bitable 列名 | 导入字段 | 说明 |
|--------------|----------|------|
| 生产周期 | production_lead_days | 写入默认供应商生产周期 |
| 补货灯 | replenish_light | red/yellow/green，SKU 补货策略灯 |

环境变量：`FEISHU_BITABLE_TABLE_SKUS`

## 表：库存策略（inventory_policy）

| Bitable 列名 | 导入字段 | 说明 |
|--------------|----------|------|
| SKU编码 | sku_code | ✅ |
| 仓库编码 | warehouse_code | 默认 ALL 或分仓 |
| 安全库存天数 | safety_stock_days | 默认 14 |
| 目标覆盖天数 | target_coverage_days | 未设时由总提前期推导 |
| 超备阈值天数 | overstock_threshold_days | 默认 180 |
| 安全库存数量 | safety_stock_qty | 兼容 EOQ 视图 |
| 补货触发点 | reorder_point | |
| 建议补货量 | reorder_qty | |

环境变量：`FEISHU_BITABLE_TABLE_INVENTORY_POLICY`

## 表：库存快照（inventory）

| 字段 | 说明 |
|------|------|
| sku_code | ✅ |
| warehouse | 物理仓编码 |
| qty_available | 可售 |
| qty_in_transit | 在途 |
| qty_in_production | 在产（可写入 IN-PRODUCTION 仓） |
| recorded_date | 盘点日期 |

## 表：销量历史（sales）

| 字段 | 说明 |
|------|------|
| sku_code | ✅ |
| sale_date | ✅ |
| qty_sold | ✅ |
| channel | 平台/渠道（文本，阶段一不接 API） |
| warehouse_code | 发货仓 |

## 表：销量预测（sales_forecast）— 业务主口径

业务提供的宽表（如图）按 **站点 + SKU + 1~12 月预测日均** 维护，比历史销量更适合 95~130 天总提前期的补货。

| Bitable / CSV 列 | 导入字段 | 说明 |
|------------------|----------|------|
| 站点 | station | US / DE，默认 US |
| SKU | sku_code | ✅ |
| 采购周期 | production_lead_days | 同步到 SKU 生产周期（如 50） |
| 生命周期 | lifecycle | 如 成熟期 |
| 负责人 | owner_name | |
| 1月预测日均 … 12月预测日均 | （宽列） | 每月预测日均销量 |
| 预测年份 | forecast_year | 可选，默认当年 |

环境变量：`FEISHU_BITABLE_TABLE_SALES_FORECAST`

补货预测优先使用月度预测模拟覆盖天数；无预测时回退到近 90 天历史销量。

## PMC 确认结果（应用内）

| 系统实体 | 来源 | 说明 |
|----------|------|------|
| reorder_suggestions | 补货预测任务 | pending → accepted/ignored |
| pmc_plans | 采纳建议或手工创建 | draft → confirmed |
| purchase_drafts | 计划确认后自动生成 | T-30/T-14/T-7 跟进提醒 |

## 数据质量要求

- SKU 编码、仓库编码、工厂编码全局唯一且口径一致
- 销量按发货仓维度维护，便于美西/美东分仓覆盖天数计算
- 生产周期与海运周期分开维护，禁止混在一个「交期天数」字段
