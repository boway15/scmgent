# 数据导入示例文件

**数据中心 → 数据导入**（`/data/import`）请使用业务真实导出文件，勿再使用已移除的家具演示 CSV。

## 推荐样例（与生产格式一致）

| 导入类型 | 样例文件 | 说明 |
|----------|----------|------|
| 库存盘点 | `docs/samples/import-fob/库存表-SKU库存周转情况查询-明细*.xlsx` | SKU 库存周转宽表，约 5500 行，**上传文件**导入 |
| 销量历史（日） | `docs/samples/xiaoshou/产品销售报表-每日*.csv` | xiaoshou 日销量宽表 |
| 销量历史（月） | `docs/samples/xiaoshou/产品销售报表-每月*.csv` 或 `docs/samples/import-fob/产品销售报表-每月*.xlsx` | SKU 月销量宽表（可选，与日表同时上传） |

## 导入类型说明

| 类型 | 格式 | 备注 |
|------|------|------|
| SKU 主数据 | CSV 列式 | 支持标准 9 位 / legacy 编码（如 `DJ502313_34`） |
| 库存盘点 | CSV 或 xlsx | 大表自动后台导入，在页面查看批次进度 |
| 销量历史 | **仅** xiaoshou 宽表 | 不支持 `sku_code,sale_date,qty_sold` 窄表 |
| 销量预测 | 月度日均宽表 | 与飞书表结构一致 |
| 库存策略 | CSV | 需 SKU 已存在 |
| 供应商/工厂 | CSV | `merchant_code` 等 |
| 航线周期 | CSV | 更新已有 `warehouse_code` 交期 |
| 下单计划 | CSV + 页面填商家 | PMC 计划行 |

## 已移除

- **合规属性导入**（`compliance`）：模块已下线，无对应导入入口
- **窄表销量 CSV**（`sku_code,sale_date,qty_sold`）：后端已拒绝，请改用 xiaoshou 宽表

## 建议导入顺序

1. 库存周转 xlsx（自动补全 SKU 主数据字段）
2. 销量日/月宽表 CSV
3. 库存策略、销量预测、PMC 计划等按需导入
