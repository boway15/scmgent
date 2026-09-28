# 分析只读：停用业务事实写入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本系统不再修改仓库、数量、状态、交期、到货，也不把这些事实推回飞书；业务事实只从迅捷经飞书拉取。

**Architecture:** 写接口统一返回 403，页面去掉对应按钮。三池同步不再套用 `inventory_dest_allocations`。历史行先留在库里，不删除。时间轴改以飞书镜像为供给来源，单独作为第二阶段，避免和关入口混在一次发布里。

**Tech Stack:** TypeScript、Hono、React、Node `tsx --test`

**Spec:** 对话结论（2026-09-28）。系统不操作业务数据；未定仓不可在本系统改仓库；FOB 分账不在范围内。

## Global Constraints

- 统一拒绝文案：`本系统只同步和分析数据，不在此修改业务事实。请在迅捷 ERP 操作。`
- 不删除已有 `inventory_dest_allocations`、`purchase_drafts`、`pmc_plans`、`shipments`、手工 `inventory_records`。
- 销售占比分摊仍是计算视图，不把 `OVERSEAS` 写成物理仓。
- 保留：FOB 分账、销售预测、需求计划、安全库存策略与建议、预警、数据问题工单状态、交期档案、用户与角色、飞书拉取。
- 文件导入里的 `safety_stock` 保留。
- 中文 UI；标识符英文。
- 测试：在 `apps/web` 下执行 `npx tsx --test <files>`。
- 用户未要求则不 git commit。

---

## 不在本计划里做的事

- 不接迅捷 API。
- 不在本系统补原因码、双签字、审批流。
- 不改 FOB。
- 不把销售预测、需求计划、安全库存改成只读。

## 阶段划分

| 阶段 | 内容 | 发布后的可见结果 |
|------|------|------------------|
| A | 关掉新的写入，同步不再套用确认落仓 | 页面不能再改仓、改数量、改交期、登记到货、推回飞书 |
| B | 供给批次不再读取本系统台账 | 时间轴只使用飞书镜像里的目的仓、交期、未入库数量，以及周转快照 |

阶段 A 可以单独上线。阶段 B 会改变规划数字，必须在 A 之后、并用同一天的飞书数据对过账再开。

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/analysis-only.ts` | 403 文案与 `analysisOnlyResponse()` |
| `apps/web/server/lib/analysis-only.test.ts` | 文案稳定 |
| `apps/web/server/lib/inventory-supply-lot-sync.ts` | 去掉 `loadConfirmedDestAllocations` / `applyConfirmedDestinationsToLots` |
| `apps/web/server/routes/inventory-unallocated.ts` | `POST .../assign` 改为 403 |
| `apps/web/server/routes/inventory-pools.ts` | `PATCH /inventory/pools/:id` 改为 403 |
| `apps/web/server/routes/inventory.ts` | `POST /inventory/records` 改为 403 |
| `apps/web/server/routes/shipments.ts` | 新建、修改、里程碑改为 403 |
| `apps/web/server/routes/reorder.ts` | `PATCH /reorder/suggestions/:id` 改为 403，不再合并 PMC |
| `apps/web/server/routes/pmc.ts` | 新建、确认、改数量、登记到货改为 403 |
| `apps/web/server/routes/procurement.ts` | `PATCH` 与 `receive` 改为 403；现有 `POST` 403 保留 |
| `apps/web/server/routes/procurement-lists.ts` | `push`、`import`、`clear` 改为 403；`sync` 拉取保留 |
| `apps/web/server/routes/import.ts` | `inventory`、`pmc_plans` 执行改为 403；预览可保留 |
| 对应 React 页面与 `apps/web/src/lib/api.ts` | 去掉操作按钮，列表保留 |
| `docs/business/scm-demand-supply-inventory-logic.md` | 删掉「确认落仓」「确认计划生成跟单」作为现行路径的描述 |
| `docs/business/scm-sop-operating-standard.md` | SOP-04/05/06 的系统落点改为飞书镜像 |

---

### Task 1: 统一 403

**Files:**
- Create: `apps/web/server/lib/analysis-only.ts`
- Create: `apps/web/server/lib/analysis-only.test.ts`

**Interfaces:**
- Produces: `ANALYSIS_ONLY_MESSAGE`、`analysisOnlyResponse(c)`，返回 HTTP 403，body 为 `{ message: ANALYSIS_ONLY_MESSAGE }`

- [ ] **Step 1:** 写测试，断言文案等于 Global Constraints 中的那一句。
- [ ] **Step 2:** 实现 helper。
- [ ] **Step 3:** `npx tsx --test server/lib/analysis-only.test.ts` 通过。

### Task 2: 未定仓不再改仓库

**Files:**
- Modify: `apps/web/server/routes/inventory-unallocated.ts`（`POST /inventory/unallocated/:id/assign`）
- Modify: `apps/web/server/lib/inventory-supply-lot-sync.ts`（约 251–263 行，同步套用落仓）
- Modify: `apps/web/src/pages/InventoryUnallocatedPage.tsx`
- Modify: `apps/web/src/pages/PlanningDashboardPage.tsx`（入口文案「确认目的仓」）
- Modify: `apps/web/src/pages/InventoryPoolsPage.tsx`（「未确认目的仓前不计入」这句改为只读说明）
- Test: `apps/web/server/lib/inventory-supply-lot-sync` 现有测试，或在 sync 路径补一条「即使库里有落仓记录，产出批次的 warehouseCode 仍是构建时的仓库」

**行为:**

- `GET /inventory/unallocated` 保留。
- `POST .../assign` 调用 `analysisOnlyResponse`，不再写 `inventory_dest_allocations`。
- `syncInventorySupplyLots` 在 `buildLotsFromInputs` 之后直接使用 `lots`，不调用 `loadConfirmedDestAllocations` 和 `applyConfirmedDestinationsToLots`。
- `applyConfirmedDestinationsToLots` 函数可以留在 `inventory-dest-allocation.ts`，但生产同步路径不得再调用。
- 页面去掉「确认落仓」列和提交。说明改为：仓库以周转快照和飞书备货单的目的仓为准；没有目的仓的批次保持 `OVERSEAS`。
- 预期：下次同步后，以前靠确认落仓改到物理仓的批次会回到 `OVERSEAS` 或源数据上的仓库。这是修复，不是回退故障。

- [ ] **Step 1:** 为同步路径写失败测试：有确认落仓记录时，批次仓库仍等于 `buildLotsFromInputs` 的仓库。
- [ ] **Step 2:** 去掉同步套用，assign 改 403。
- [ ] **Step 3:** 改未定仓页和驾驶舱文案。
- [ ] **Step 4:** 跑 dest-allocation 与 supply-lot-sync 相关测试。

### Task 3: 供给池、手工库存、发运改为只读

**Files:**
- Modify: `apps/web/server/routes/inventory-pools.ts` 的 `PATCH /inventory/pools/:id`
- Modify: `apps/web/server/routes/inventory.ts` 的 `POST /inventory/records`
- Modify: `apps/web/server/routes/shipments.ts` 的 `POST /shipments`、`PATCH /shipments/:id`、`POST /shipments/:id/milestones`
- Modify: `apps/web/src/pages/InventoryPoolsPage.tsx`（两处「保存」、生产状态和可出货日表单）
- Modify: `apps/web/src/pages/ShipmentsPage.tsx`（新建、保存里程碑、改目的仓）
- 库存总览上若有手工录入表单，一并去掉。先搜 `api` 里对 `POST /inventory/records` 的调用。

**行为:** 上述写接口全部 `analysisOnlyResponse`。列表、筛选、导出保留。`POST /inventory/pools/sync` 保留，它只是重跑三池同步。

- [ ] **Step 1:** 三个路由的写方法改为 403，GET 不动。
- [ ] **Step 2:** 页面去掉保存和新建。
- [ ] **Step 3:** 跑对应单测；没有路由测试的，用现有 route test 风格补一条「写方法返回 403 且 message 为统一文案」。

### Task 4: 停用第二套采购台账的写入

**Files:**
- Modify: `apps/web/server/routes/reorder.ts` 的 `PATCH /reorder/suggestions/:id`
- Modify: `apps/web/server/routes/pmc.ts` 的 `POST /pmc/plans`、`PATCH /pmc/plans/:id/status`、`PUT .../items/:itemId`、`POST .../receive`
- Modify: `apps/web/server/routes/procurement.ts` 的 `PATCH /purchase-drafts/:id`、`POST /purchase-drafts/:id/receive`（`POST /purchase-drafts` 已是 403，改为同一文案）
- Modify: `apps/web/src/pages/ReorderSuggestionsPage.tsx`（「采纳并加入计划」）
- Modify: `apps/web/src/pages/PmcListPage.tsx`、`PmcDetailPage.tsx`（「确认计划」「确认到货」）
- Modify: `apps/web/src/pages/PurchaseTrackingPage.tsx`（改状态、改交期、「登记到货」）
- Modify: `apps/web/src/pages/HelpCenterPage.tsx`、`apps/web/server/lib/local-assistant.ts`、`apps/web/server/routes/dashboard.ts` 里「请登记到货以回写库存」

**行为:**

- 补货建议的生成任务保留。建议列表只读，不再调用 `mergeSuggestionToPlan`。
- 确认计划不再调用 `generatePurchaseDraftsFromPlan`。
- 跟单列表仍可查看已有行，不能改状态、ETA、里程碑，不能登记到货。
- 页面说明改为：下单、改交期、到货在迅捷完成，进度看采购跟单飞书镜像。

- [ ] **Step 1:** 写接口改 403，确认 `generatePurchaseDraftsFromPlan` 不再被路由调用。
- [ ] **Step 2:** 去掉采纳、确认、登记到货按钮，改帮助文案。
- [ ] **Step 3:** 跑 `pmc-plan`、`purchase-draft` 相关测试。原测试若断言「确认后生成跟单」，改为断言路由拒绝，生成函数本身可暂留但不从路由进入。

### Task 5: 停止把本地写回飞书，并关掉会覆盖库存的文件导入

**Files:**
- Modify: `apps/web/server/routes/procurement-lists.ts` 的 `push`、`push/preview`、`import`、`import/preview`、`clear`
- Modify: `apps/web/src/pages/ProcurementBitableListPage.tsx`（「同步到飞书」「清空当前数据」、上传导入）
- Modify: `apps/web/server/routes/import.ts`：`type` 为 `inventory` 或 `pmc_plans` 时，`POST /import/:type` 返回 403
- 数据导入页去掉这两类的执行按钮；预览可以留下，但执行必须 403

**保留:**

- `POST /procurement/lists/:type/sync`（从飞书拉取）
- `POST /bitable/sync/:type`（从飞书拉取）
- `POST /import/safety_stock` 与安全库存页的采纳

**先不关:** `POST /import/sales`、`/import/skus`、`/import/merchants`。每日 cron 不拉这三类，只拉库存周转、库存查询、大件备货、采购跟单。在确认对应飞书表已覆盖全量之前关掉，销量、商品、工厂会停更。这三项作为 Task 7 的前置条件，不在 Task 5 实施。

- [ ] **Step 1:** push / import / clear 返回 403，pull 仍可用。
- [ ] **Step 2:** 库存与 PMC 计划的文件导入执行返回 403。
- [ ] **Step 3:** 采购列表页只留「从飞书同步」。
- [ ] **Step 4:** 跑 `procurement-bitable-list` 测试；断言 push 路径不再被路由调用。

### Task 6: 文档与现行路径对齐

**Files:**
- Modify: `docs/business/scm-demand-supply-inventory-logic.md` §2（确认落仓、确认计划生成跟单、两条供给线）
- Modify: `docs/business/scm-sop-operating-standard.md` SOP-03/04/05/06 的系统落点
- Modify: `apps/web/server/lib/local-assistant.ts` 中跟单、补货建议、有效供给里「确认目的仓」的句子

**写明:**

- 未定仓仓库只来自周转快照的物理仓列，或大件备货申请的「目的仓」。空则保持 `OVERSEAS`。
- 采购跟单进度以飞书镜像字段为准：状态、确认交期、交货日期、预计货好时间、未入库数量、延期分类、延期原因。
- 本系统的 PMC 计划、`purchase_drafts`、发运、确认落仓不再是现行操作路径。
- 销售占比分摊只用于有效供给和分析，不表示已经落仓。

- [ ] **Step 1:** 改上述三处，避免帮助中心和逻辑文档继续指导用户在本系统确认落仓或登记到货。

---

### Task 7: 阶段 B — 供给只认飞书镜像（A 上线并核对后再做）

**前置:** Task 2–5 已上线。用一天的生产数据核对：大件备货「目的仓」覆盖率、采购跟单「确认交期 / 未入库数量」是否够时间轴使用。覆盖不足时只出数据问题工单，不要用本系统台账补洞。

**Files:**
- Modify: `apps/web/server/lib/inventory-supply-lot-sync.ts` 的 `buildLotsFromInputs` 入参
- 读取：`procurement_list_rows` 中 `bulk_stock_request.目的仓`、`purchase_follow_up` 的状态、确认交期、交货日期、预计货好时间、未入库数量
- 停止作为供给输入：`purchase_drafts`、`shipments`、`source = manual` 的 `inventory_records`、`inventory_dest_allocations`
- 周转快照仍是在库、在途合计的来源

**行为:**

- 备货行有目的仓：批次仓库用该值。
- 备货行目的仓为空，或跟单没有目的仓：仓库保持 `OVERSEAS`，不开确认落仓。
- 交期用跟单镜像的确认交期或交货日期，不再用本系统 ETA 字段。
- 没有可用日期的批次继续进现有 `missing_available_at` 工单。

- [ ] **Step 1:** 用固定的飞书行样本写纯函数测试：有目的仓落物理仓，无目的仓留 `OVERSEAS`，不读取 dest allocation。
- [ ] **Step 2:** 同步任务改用该纯函数，去掉 drafts/shipments 入参。
- [ ] **Step 3:** 对同一 SKU 比较改前改后的确定供给，差异只来自「不再采用本系统台账」。
- [ ] **Step 4:** 更新逻辑文档 §2.3 的流程图。

### Task 8: 销量、SKU、工厂文件导入（单独确认后）

**前置:** 飞书多维表格中的商品、销量、工厂已由每日或手动「从飞书同步」覆盖，且业务确认不再用 Excel 导入。

**Files:**
- Modify: `apps/web/server/routes/import.ts` 对 `sales`、`skus`、`merchants` 的执行接口
- 数据导入页去掉这三类的「确认导入」，保留「从飞书同步」

- [ ] **Step 1:** 确认 cron 或操作手册里这三类的拉取负责人之后，再把执行接口改为 403。未确认前不实施本任务。

---

## 验收

阶段 A 完成时：

- 未定仓页没有确认落仓；`POST .../assign` 为 403。
- 重新同步后，落仓确认记录不再改变批次仓库。
- 供给池不能保存日期或生产状态；不能手工录入库存；不能新建或修改发运。
- 不能采纳建议生成计划、不能确认计划、不能改跟单、不能登记到货。
- 采购列表不能同步到飞书、不能清空、不能文件导入；从飞书拉取仍成功。
- 库存、PMC 计划的文件导入执行返回 403。
- 预测发布、需求计划、安全库存采纳、FOB 分账仍可使用。

阶段 B 完成时：

- 时间轴供给批次的仓库和交期能追溯到周转快照或飞书采购镜像字段。
- `purchase_drafts` 与 `shipments` 不再进入 `buildLotsFromInputs`。

## 建议提交粒度

用户要求提交时再拆，不要在实施中途自动提交：

1. Task 1–2 未定仓与同步不再改仓
2. Task 3–4 其余业务写入改为 403 与页面只读
3. Task 5–6 飞书推送、库存导入、文档
4. Task 7、Task 8 各自单独提交
