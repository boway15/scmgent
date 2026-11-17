# 销售预测列表展示发布人

日期：2026-11-11  
状态：已确认待实现

## 背景

「销售预测」与「销售预测-周」版本列表已展示创建人（`createdByName`），版本表已有 `published_by`，但列表接口未 join 发布人姓名，前端也未展示。

## 目标

在两个版本列表的「创建人」列内，于创建人姓名下方增加发布人展示。

## 非目标

- 不改详情页
- 不新增独立「发布人」表头列
- 不做 Schema / 迁移（字段已存在）
- 不改发布写入逻辑（已写 `published_by`）

## 方案

列表查询对 `published_by` 再 left join `users`（Drizzle `alias`），透出 `publishedByName`；列表单元格同一列两行展示。

## 数据与 API

| 模块 | 改动点 | 新增字段 |
|------|--------|----------|
| 月预测 | `listForecastVersionsPage`（及 list item 映射） | `publishedByName: string \| null` |
| 周预测 | `GET /api/demand-plans` 列表 select | `publishedByName: string \| null` |
| 前端类型 | `ForecastVersionListItem`、`DemandPlanVersionListItem` | 同上 |

未发布或 `published_by` 为空时，`publishedByName` 为 `null`。

## UI

页面：

- `SalesForecastListPage`（销售预测）
- `DemandPlanPilotPage`（销售预测-周）

「创建人」列单元格：

```
{createdByName ?? '—'}
发布 {publishedByName ?? '—'}
```

列标题仍为「创建人」。第一行 `text-sm text-text-sub`；第二行 `text-xs text-text-sub`，前缀固定为「发布 」。

## 验收

1. 已发布版本：创建人下方可见「发布 {姓名}」
2. 草稿 / 未发布：创建人下方为「发布 —」
3. 月、周两个列表行为一致
4. 列表加载与筛选不受影响；无额外 N+1 请求
