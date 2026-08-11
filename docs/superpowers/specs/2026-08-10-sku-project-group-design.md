# 商品主数据「项目组」字段设计

> **状态**：已实现  
> **日期**：2026-08-10  
> **目标**：在 SKU 商品主数据增加只读派生字段「项目组」，值形如 `项目1组`，来源为品类路径第二段中的 `项目x组`；列表可展示与筛选。

---

## 1. 背景与决策

品类在 `skus.category` 中以层级路径字符串存储（无独立品类表），例如：

```
DJ02-家具事业1部\Amazon项目1组-第一曲线-US\卧室-床头柜Nightstands
```

预测模块已从路径第二段解析 seasonality 的 `project_group` 维度，但存的是**第二段整段**（如 `Amazon项目1组-第一曲线-US`），且未落库到 SKU。业务需要在商品主数据上看到并筛选「项目 x 组」核心名。

| 决策项 | 结论 |
|--------|------|
| 存值格式 | **C**：仅核心名 `项目1组` / `项目6组` |
| 维护方式 | **A**：只读派生；改品类时自动写入；不可手工改 |
| 能力范围 | **B**：SKU 列表展示 + 按项目组筛选 |
| 解析范围 | **A**：只从品类路径**第二段**匹配 |
| 实现方案 | **方案 1**：`skus.project_group` 落库列 + 写入时同步 + 迁移回填 |

---

## 2. 数据模型

在 `skus` 增加：

| 列 | 类型 | 说明 |
|----|------|------|
| `project_group` | `varchar(20)`，可空 | 派生项目组，如 `项目1组`；匹配不到为 `NULL` |

- 索引：`skus_project_group_idx`（支撑列表筛选）
- **SPU 不加**该字段；以 SKU 品类为准
- 销售预测 `sales_forecast_seasonality` 的 `project_group` 维度语义**本次不改**（仍为第二段整段）

迁移：`packages/db` 新增 Drizzle SQL + schema 字段；迁移内对已有 `skus.category` 做 SQL 回填。

---

## 3. 解析规则

共用函数（建议放在 `apps/web/server/lib/sku-category.ts`）：

```ts
extractProjectGroupFromCategory(category: string | null | undefined): string | null
```

步骤：

1. 规范化分隔符：`\` → `/`，trim
2. 按 `/` 分段；不足 2 段 → `null`
3. 在第二段上用正则 `/项目\d+组/` 取**第一个**匹配
4. 无匹配 → `null`

| 输入第二段 | 结果 |
|------------|------|
| `Amazon项目1组-第一曲线-US` | `项目1组` |
| `非Amazon项目6组-第二曲线-US` | `项目6组` |
| `卧室-床头柜Nightstands`（无项目组） | `null` |
| 空 / 仅一段路径 | `null` |

---

## 4. 写入同步

**原则**：`project_group` 从不接受前端或导入手工赋值；凡更新 `skus.category` 的路径，同时按解析函数写入 `project_group`。`category` 清空时 `project_group = null`。

| 入口 | 处理 |
|------|------|
| `ensure-sku-from-import`、库存周转 / CSV / 飞书 bitable 等写 category | 一并写 `project_group` |
| `PUT /api/skus/:id`、商品主数据行内编辑 | 可改 `category`；服务端派生；忽略客户端 `projectGroup` |
| 新建 SKU（若带品类） | 同上 |

实现上在写 SKU 的 helper 中统一调用 `extractProjectGroupFromCategory`，避免漏同步。本期不做定时全量对账。

---

## 5. API

`GET /api/products/sku-overview`：

- 响应每行增加 `projectGroup: string | null`
- 支持 query `projectGroup`：对 `skus.project_group` 做 `ilike` 包含匹配（与现有品类筛选一致）

`GET/PUT /api/skus/:id`：

- 响应带 `projectGroup`
- PUT 忽略客户端传入的 `projectGroup`；仅随 `category` 变更重算

---

## 6. 前端

页面：`ProductMasterPage`（`/data/products`）SKU Tab。

| 项 | 行为 |
|----|------|
| 筛选区 | 增加「项目组」输入，参数 `projectGroup` |
| 列表列 | 在「品类」后增加只读列「项目组」（`product-master-sku-columns`） |
| 新建 / 编辑表单 | **不出现**项目组输入；改品类保存后列自动刷新 |

本期不做：项目组下拉枚举、导出、SPU Tab。

---

## 7. 测试

- 单元：`extractProjectGroupFromCategory` 覆盖正例、无第二段、无匹配、`\` 与 `/` 分隔
- 路由或集成：更新 `category` 后 `project_group` 同步；`sku-overview` 按 `projectGroup` 筛选生效

---

## 8. 范围外

- SPU 级项目组字段
- 预测 seasonality 维度值改为核心名
- 导出 Excel / 批量改项目组
- 定时对账任务
