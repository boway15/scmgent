# P1 Task 9 验收回归报告

## Status

**PASS WITH CONCERN**：代码与自动化回归通过；本次未启动带真实数据库的 Web 环境执行浏览器交互验收。

## 测试结果

- brief 指定测试：`27 passed, 0 failed`
  - `replenishment-coverage.test.ts`：11/11
  - `lead-time-resolver.test.ts`：6/6
  - `inventory-position.test.ts`：9/9
  - `inventory-health-service.test.ts`：1/1
- 补充验收测试：`11 passed, 0 failed`
  - 建议依据：4/4
  - SKU 规划页服务：3/3
  - 跟单里程碑与预计可售日：4/4

## 手工清单

- [x] 新建 profile 后的解析链路会改变六段提前期及 `totalLeadDays`，健康/建议复用该结果；resolver、coverage、metrics 测试通过。**限制：未连接真实 DB 在 UI 新建 profile 后重跑任务。**
- [x] 建议“查看依据”包含库存位置构成、六段提前期、总提前期、建议量和建议日期；格式化测试 4/4 通过。
- [x] `/inventory/planning/:skuId` 直接复用 health 的 `position`，页面展示同源 `effectiveQty`；规划服务测试 3/3 通过。
- [x] 内部 PMC 跟单支持编辑/清空 `etd`、`eta_port`、`eta_warehouse`；预计可售日仍为列表主字段；里程碑/ETA 测试 4/4 通过。
- [x] `c92b1e4...HEAD` 的新增代码未引入 P2 `shipments`、断货需求修正或 P3 Z 值策略；仅保留规划页的断货日期估算展示。

## Feishu freeze

**OK**。当前分支 `feat/inventory-planning-p1`，`merge-base(main, HEAD) = c92b1e463855558d665164cdbf0f0a2a7474fc31`。对库存总览、库存查询、采购飞书列表页面及 `purchaseFollowUp` mapper 路径执行 `git log` 无提交、`git diff --exit-code` 返回 0，未修改列结构/表头/行布局。

## Concerns

- 唯一未覆盖项是真实数据库 + 浏览器的端到端手工操作；自动化与静态链路均通过。
- 未修改设计文档 §13，也未创建提交。
