# 飞书多维表格同步（商品 / 库存 / 销量）

scm-agent 支持在 **数据导入中心**（`/data/import`）从飞书多维表格一键拉取 SKU、库存、销量数据，与 CSV/XLSX 直接导入并存。

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

日期字段可为 `YYYY-MM-DD` 文本，或 Bitable 日期类型（毫秒时间戳会自动转换）。

## 使用步骤

1. 打开 **数据中心 → 数据导入**
2. 选择 **SKU 主数据 / 库存盘点 / 销量历史**
3. 在「飞书多维表格」区域点击 **从多维表格预览**
4. 确认校验无阻断问题后，点击 **确认从多维表格同步**

导入顺序建议：**SKU → 库存 / 销量**（库存与销量 preview 会校验 SKU 是否已存在）。

## API（供集成参考）

| 方法 | 路径 |
|------|------|
| GET | `/api/bitable/status` |
| POST | `/api/bitable/sync/:type/preview` |
| POST | `/api/bitable/sync/:type` |

`type` 为 `skus` | `inventory` | `sales`。

## 限制

- 单次同步最多 **5000** 行（与 CSV 导入一致）
- 人员、关联、附件类字段本版本不映射；请使用文本或单选列
- FOB 体积暂不支持多维表格同步，仍使用批次详情页文件上传

## 妙搭发布

配置环境变量后重新发布应用。验证：`GET /api/bitable/status` 返回 JSON，且对应 `configured: true`。
