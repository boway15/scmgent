# 飞书多维表格同步（阶段一主数据）

scm-agent 支持在 **数据导入中心**（`/data/import`）从飞书多维表格一键拉取供应链主数据，与 CSV/XLSX 直接导入并存。

详细字段规范见 [phase1-feishu-master-data.md](./prd/phase1-feishu-master-data.md)。

## 前置条件

1. 使用与 OAuth 登录相同的飞书应用（`FEISHU_APP_ID` / `FEISHU_APP_SECRET`）
2. 在 [飞书开放平台](https://open.feishu.cn/) 为该应用开通权限：**查看、评论、编辑和管理多维表格**（`bitable:app`）或至少只读范围
3. 将应用添加为目标多维表格的 **协作者**（否则 API 无法读表）

## 环境变量

在 `.env` 或妙搭控制台配置：

```env
FEISHU_BITABLE_APP_TOKEN=      # 多维表格 app_token（URL 中 /base/ 后的 bascnxxx）
FEISHU_BITABLE_TABLE_SKUS=     # 商品表 table_id（tblxxx）
FEISHU_BITABLE_TABLE_INVENTORY=
FEISHU_BITABLE_TABLE_SALES=
FEISHU_BITABLE_TABLE_MERCHANTS=
FEISHU_BITABLE_TABLE_WAREHOUSE_LEADS=
FEISHU_BITABLE_TABLE_INVENTORY_POLICY=
FEISHU_BITABLE_TABLE_SALES_FORECAST=
FEISHU_BITABLE_TABLE_BULK_STOCK_REQUEST=   # 大件备货申请 tbl7H8F6rc2xeFGf
FEISHU_BITABLE_TABLE_PURCHASE_FOLLOW_UP=    # 采购跟单（采购管理）tbl3m7FqgPVr4kmY
# 若采购表与新闻/主数据不在同一份多维表格，可单独指定：
# FEISHU_BITABLE_PROCUREMENT_APP_TOKEN=HPJzbHdPea7elSs92T8c31BTnxe
```

采购管理模块（`/procurement/bulk-stock`、`/procurement/follow-up`）与主数据导入共用 `FEISHU_BITABLE_APP_TOKEN`。本模块每次飞书同步或文件上传会**全量覆盖**对应列表；**同步到飞书**时也会先清空飞书表再写入本地全部行。

示例（同一多维表格 `HPJzbHdPea7elSs92T8c31BTnxe`）：

```env
FEISHU_BITABLE_APP_TOKEN=HPJzbHdPea7elSs92T8c31BTnxe
FEISHU_BITABLE_TABLE_BULK_STOCK_REQUEST=tbl7H8F6rc2xeFGf
FEISHU_BITABLE_TABLE_PURCHASE_FOLLOW_UP=tbl3m7FqgPVr4kmY
```

获取方式：

- 打开多维表格，URL 形如 `https://xxx.feishu.cn/base/bascnXXXX?table=tblYYYY`
- `bascnXXXX` → `FEISHU_BITABLE_APP_TOKEN`
- `tblYYYY` → 对应 `FEISHU_BITABLE_TABLE_*`

## 列名映射

Bitable 列名支持中英文别名，系统会自动映射为导入字段。

### 商品（skus）

| 导入字段 | 推荐 Bitable 列名 |
|----------|-------------------|
| sku_code | SKU编码 |
| name | 商品名称 |
| unit | 单位 |
| spu_code | SPU编码 |
| category | 品类 |
| lead_time_days | 交期天数 |
| production_lead_days | 生产周期 |
| moq | MOQ |
| unit_cost | 成本 |
| merchant_code | 工厂编码 |
| merchant_name | 工厂名称 |
| replenish_light | 补货灯（red/yellow/green） |

### 库存（inventory）

| 导入字段 | 推荐 Bitable 列名 |
|----------|-------------------|
| sku_code | SKU编码 |
| warehouse | 仓库 |
| qty_available | 可用库存 |
| qty_in_transit | 在途 |
| recorded_date | 盘点日期 |

### 销量（sales）

| 导入字段 | 推荐 Bitable 列名 |
|----------|-------------------|
| sku_code | SKU编码 |
| sale_date | 销售日期 |
| qty_sold | 销量 |
| channel | 渠道 |
| warehouse_code | 发货仓 |

### 工厂（merchants）

| 导入字段 | 推荐 Bitable 列名 |
|----------|-------------------|
| merchant_code | 工厂编码 |
| merchant_name | 工厂名称 |
| production_lead_days | 生产周期 |

### 航线周期（warehouse_leads）

| 导入字段 | 推荐 Bitable 列名 |
|----------|-------------------|
| warehouse_code | 仓库编码 |
| shipping_lead_days | 海运周期 |
| inbound_buffer_days | 入仓缓冲 |

### 库存策略（inventory_policy）

| 导入字段 | 推荐 Bitable 列名 |
|----------|-------------------|
| sku_code | SKU编码 |
| warehouse_code | 仓库编码 |
| safety_stock_days | 安全库存天数 |
| target_coverage_days | 目标覆盖天数 |
| overstock_threshold_days | 超备阈值天数 |

### 销量预测（sales_forecast）

| 导入字段 | 推荐 Bitable 列名 |
|----------|-------------------|
| station | 站点 |
| sku_code | SKU |
| production_lead_days | 采购周期 |
| lifecycle | 生命周期 |
| owner_name | 负责人 |
| 1月预测日均 … | 1月预测日均、2月预测日均…（宽列原样保留） |

日期字段可为 `YYYY-MM-DD` 文本，或 Bitable 日期类型（毫秒时间戳会自动转换）。

## 使用步骤

1. 打开 **数据中心 → 数据导入**
2. 选择 **SKU 主数据 / 库存盘点 / 销量历史**
3. 在「飞书多维表格」区域点击 **从多维表格预览**
4. 确认校验无阻断问题后，点击 **确认从多维表格同步**

导入顺序建议：**工厂 → 航线周期 → SKU → 销量预测 → 库存策略 → 库存 / 历史销量**。

## API（供集成参考）

| 方法 | 路径 |
|------|------|
| GET | `/api/bitable/status` |
| POST | `/api/bitable/sync/:type/preview` |
| POST | `/api/bitable/sync/:type` |

`type` 为 `skus` | `inventory` | `sales` | `merchants` | `warehouse_leads` | `inventory_policy` | `sales_forecast`。

补货预测：`POST /api/tasks/replenishment-forecast`  
采购跟进：`POST /api/tasks/purchase-follow-up`

### 采购管理列表（全量快照）

| 方法 | 路径 |
|------|------|
| GET | `/api/procurement/lists/config` |
| GET | `/api/procurement/lists/:type` |
| GET | `/api/procurement/lists/:type/meta` |
| POST | `/api/procurement/lists/:type/sync/preview` |
| POST | `/api/procurement/lists/:type/sync` |
| POST | `/api/procurement/lists/:type/push/preview` |
| POST | `/api/procurement/lists/:type/push` |
| POST | `/api/procurement/lists/:type/import/preview` |
| POST | `/api/procurement/lists/:type/import` |

`type` 为 `bulk_stock_request` | `purchase_follow_up`。

## 限制

- 单次同步最多 **5000** 行（与 CSV 导入一致）
- 人员、关联、附件类字段本版本不映射；请使用文本或单选列
- FOB 体积暂不支持多维表格同步，仍使用批次详情页文件上传

## 妙搭发布

配置环境变量后重新发布应用。验证：`GET /api/bitable/status` 返回 JSON，且对应 `configured: true`。
