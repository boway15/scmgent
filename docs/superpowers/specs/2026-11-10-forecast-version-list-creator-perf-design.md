# 销量/周销量预测版本列表：创建人 + 首屏性能

## 背景

- 月销量预测（`/data/forecast`）与周度销量预测（`/data/demand-plan`）版本表已有 `created_by` 且生成时写入，但列表 API 未 join 用户、前端未展示。
- 两列表首屏偏慢：月侧一次拉最多 50 版并带 `includeStats`，再前端筛/分页；周侧前端刻意 `pageSize: 500` 后再本地筛/分页。
- 明细宽表（horizon/wide）性能不在本期。

## 目标

1. 两个**版本列表**增加「创建人」列（对齐 FOB：`createdByName`，空值 `—`）。
2. 优先真**服务端分页**，降低首屏数据量；月/周都优化。
3. 不改详情页、不做按创建人筛选、不新增 DB 迁移。

## 方案（已选）

服务端分页 + 创建人 join；月侧 stats 仅对当前页 versionId 聚合。不新增独立 pipeline 轮询 API。

## 数据

| 表 | 字段 | 本期 |
|----|------|------|
| `sales_forecast_versions` | `created_by` | 已有，只读暴露姓名 |
| `demand_plan_versions` | `created_by` | 同上 |

无 schema 变更。写入路径保持 `getCurrentUser` → `createdBy: user.id`。

## API

### `GET /api/sales-forecast-versions`

查询参数：

| 参数 | 说明 |
|------|------|
| `page` / `pageSize` | 默认 page=1、pageSize=20，上限 100 |
| `status` | 可选：`draft` / `published` / `archived` |
| `q` | 可选：版本号 / 名称 / 站点模糊 |
| `includeStats` / `statsScope` | 现有语义；`list` 时仅对**当前页** items 聚合 |

响应统一为分页形状：

```json
{ "items": [/* ForecastVersionListItem + createdByName */], "total": 0, "page": 1, "pageSize": 20 }
```

实现要点：

- `leftJoin users` → `createdByName: users.name`
- 打破「无 status 时 limit 50、返回裸数组」；所有调用方改读 `items`
- stats 输入 = 当前页 version ids，禁止对全表再扫一轮

### `GET /api/demand-plans`

- 已有 `page` / `pageSize` / `q` 与项目组 scope：保持
- 新增 `status` 筛选
- select 增加 `createdByName`（`leftJoin users`）

## 前端

### 月：`SalesForecastListPage`

- 查询带 `page/pageSize/status/q/includeStats/statsScope=list`；`queryKey` 含上述参数
- 去掉本地 filter+slice；分页用 `total`
- 列：「创建人」固定插在「创建 / 发布」**之前**，单元格 `createdByName ?? '—'`
- 轮询：仅当**当前页**存在 `generating|landing` 时每 5s 刷新
- 「最新已发布 / 找草稿」：用同接口 `status=published|draft&pageSize=1`，不依赖一次拉全量

### 周：`DemandPlanPilotPage`

- 停止 `pageSize: 500`；按当前页请求，并传 `status` / `q`
- 「创建人」列同样插在「创建 / 发布」之前

### API 客户端与其它调用方

| 调用方 | 适配 |
|--------|------|
| `api.getSalesForecastVersions` | 增加 `page`/`pageSize`/`q`；返回 `PaginatedResult`（含 `createdByName`） |
| `SalesForecastListPage` | 真分页 + 创建人列 |
| `ForecastStrategySection` | 读 `items`；取最新草稿用 `status=draft&pageSize=1` |
| `SalesForecastVersionDetailPage` | 读 `items`；合并发布用的 published 列表传 `status=published&pageSize=100`（上限），避免默认 20 截断 |
| `api.listDemandPlanVersions` | 增加 `status`；类型增加 `createdByName` |
| `DemandPlanPilotPage` | 真分页 + 创建人列 |

## 边界

- 历史 `created_by` 为空 → 显示 `—`
- 周列表项目组权限逻辑不变
- 生成中版本若不在当前页：本页不轮询；翻页或手动刷新可见（可接受）
- 明细宽表首屏慢：本期不做
- 独立 pipeline 状态轻接口：后续可选，本期不做

## 验收

1. 月/周版本列表可见「创建人」；新生成版本显示对应用户名
2. 首屏默认约 20 条；周不再请求 500
3. 状态、关键词、翻页语义与改前一致（结果由服务端保证）
4. 月列表 SKU/行数等 list-stats 仍正确，且只算当前页
5. 草稿/最新已发布相关跳转仍可用
6. Strategy / 详情页等共用 `getSalesForecastVersions` 的调用不因响应形状变更而报错

## 非目标

详情页创建人、按创建人筛选、DB 迁移、明细 horizon/wide 优化、独立 pipeline 轮询 API。
