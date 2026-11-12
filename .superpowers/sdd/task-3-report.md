# Task 3 报告：映射配置 API + 页面 + 未映射扫描

**状态：** 完成（已提交）  
**分支：** `feat/sales-fulfillment-region`  
**工作区：** `.worktrees/sales-fulfillment-region`

## 做了什么

- `GET/PUT/POST import/DELETE` `/api/region-mapping/stations` 与对称的 `/warehouses`，挂在 `apps/web/server/index.ts` 的 `/api`。
- 写成功（含导入、删除命中行）后调用 `invalidateRegionMappingCache()`。
- `PUT` / CSV 导入经 `parseMappableRegion` 校验；`UNMAPPED` 或非法区域返回 400。
- 页面 `/data/region-mapping`：站点 / 仓库两个 Tab，区域下拉只有 `US/CA/EU/UK/OTHER`，展示未映射列表，支持 CSV 上传与下载。
- `runUnmappedRegionScan()` 在库存数据问题扫描末尾执行。失败只打日志并返回 `{ stationIssues: 0, warehouseIssues: 0 }`，不让主扫描失败。
- 主扫描结案时保留指纹前缀 `unmapped_station:` 与 `fulfillment_region_unmapped:`，避免区域问题被其它数据问题扫描反复结案再重开。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/region-mapping/stations` | `{ items, unmappedStations, regions }` |
| PUT | `/api/region-mapping/stations` | `{ station, salesRegion }` |
| POST | `/api/region-mapping/stations/import` | CSV `station,sales_region`（原文或 multipart `file`） |
| GET | `/api/region-mapping/stations/export` | 下载 CSV |
| DELETE | `/api/region-mapping/stations?station=` | 删除映射 |
| GET/PUT/POST/DELETE | `/api/region-mapping/warehouses` | 字段为 `warehouseCode` / `fulfillmentRegion`，CSV 头 `warehouse_code,fulfillment_region` |

菜单权限：`data.region_mapping`。

## 未映射扫描

- 站点：近 90 天 `sales_history.station`（30 天包含在 90 天内）。`resolveSalesRegion` 为 `UNMAPPED` 时 upsert `unmapped_station`。
- 仓库：活跃 `warehouses`，加上未结供给批次、近 90 天影子库存、近 90 天销量发货仓。`resolveFulfillmentRegion` 为 `UNMAPPED` 时 upsert `unmapped_warehouse`。
- 指纹使用 `fulfillment_region_unmapped:{code}`，与影子长表已有的 `unmapped_warehouse:{skuId}:{raw}` 分开，两边都会进数据问题队列。
- `inventory_data_issues.sku_id` 非空。站点用该站销量最高的 SKU；仓库优先用本仓库存 SKU，否则用任意 SKU 作锚点。库里一个 SKU 都没有时，跳过无法落库的仓。

## 测试

```bash
pnpm --filter @scm/web exec tsx --test server/lib/region-mapping-admin.test.ts server/lib/region-unmapped-scan.test.ts server/lib/region-mapping.test.ts server/lib/inventory-data-issues.test.ts
```

28 项通过。覆盖：`parseMappableRegion('UNMAPPED') === null`、`eu → EU`、写入与 CSV 拒绝 `UNMAPPED`、配置 EU 后解析为 EU、删除后回到 `UNMAPPED`、未映射候选、主扫描不结案区域指纹。

`tsc -p apps/web/tsconfig.node.json` 对本任务新增的 server 文件没有报错。全库 tsc 仍有既有错误，与本次无关。

## 未做的验收

没有连真实数据库走 HTTP，也没有在浏览器点页面。步骤 5 的解析 / 删除回退 / 拒绝 `UNMAPPED` 由纯函数测试覆盖。页面需要登录和已迁移库才能手工点选。

## 风险

- 未映射仓库在没有本仓库存时会挂到任意 SKU 上，数据问题页上的 SKU 只是外键占位，仓码在 `warehouseCode` 和说明里。
- `runUnmappedRegionScan` 吞掉异常后计数为 0，扫描任务仍显示成功。需要看服务日志里的 `[region-unmapped-scan]`。
- GET 列表会顺带跑一遍未映射查询（读库，不写）。
