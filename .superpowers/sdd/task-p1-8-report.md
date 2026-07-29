# P1 Task 8 实施报告
- 新增 `GET /api/inventory/planning/:skuId?warehouse=`，权限码 `inventory.planning`。
- 服务复用 `computeSkuWarehouseHealth`，其内部同源调用库存位置与提前期解析。
- 响应包含 position、六段 leadTime、需求、覆盖、安全库存、ROP、建议与 ETA/断货日。
- 新增 `/inventory/planning/:skuId` 页面，支持仓库切换、指标卡、位置/提前期拆分和节点说明。
- `/inventory/planning` 菜单入口重定向库存总览；建议页既有 SKU 链接保持不变。
- 新增 `0056_inventory_planning_menu.sql`、journal 与 seed，仅授权 `super_admin`。
- 未修改库存总览、库存查询、采购飞书列表及 Feishu mapper 的字段结构。
- 验证：规划/健康相关 4 项测试通过；Vite 生产构建通过；任务文件 lint 无错误。
- 全量 TypeScript 检查仍被既有 `forecast-published-resolve.ts` 类型错误阻断。
