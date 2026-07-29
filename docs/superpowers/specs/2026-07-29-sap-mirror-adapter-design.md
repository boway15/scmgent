# SAP 镜像适配层设计（P4）

**版本**：v1.0（2026-07-29）  
**定位**：在不接入真实 SAP 网络接口的前提下，落地「外部系统镜像 + 同步适配层」，使后续接 SAP 时只需实现 Transport，不必改规划引擎。  
**前置**：P0–P3 已完成（库存位置、提前期、断货修正、发运、驾驶舱、external_id 预留）。

**关联**：`docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md` §12–§14

---

## 1. 目标与边界

### 1.1 要解决的问题

- 主数据 / PO 未来可能从 SAP 单向灌入；本系统仍是规划与 PMC 真相源之一。
- 需要统一的：外部 ID、版本、同步状态、幂等导入、可观测的 sync run。

### 1.2 本阶段做

| 做 | 说明 |
|----|------|
| Adapter Port | `SapMirrorTransport` 接口 + **Fixture/JSON 实现**（非 RFC/OData 真连接） |
| 镜像写入 | 供应商→`merchants`；物料→`skus`；PO 头行→`sap_po_mirrors`（不替代 `purchase_drafts` 履约） |
| 同步元数据 | `sync_status` / `last_sync_at` / `external_version`（缺则补列） |
| Sync Run | `sap_sync_runs` 记录每次导入 |
| 管理页 | `/data/sap-mirror`：上传/粘贴 fixture、查看最近 run、映射结果 |

### 1.3 明确不做

- 真实 SAP RFC / OData / IDoc 连接与认证  
- 回写 SAP  
- 用 SAP PO 替换内部 PMC 跟单状态机  
- 改飞书同步列表结构（大件备货 / 采购跟进 / 库存总览 / 库存查询）  
- 完整库存/入库镜像（留 P4.1 / P5）  
- 正式 PO 审批流  

### 1.4 原则

```text
SAP（未来）──transport──► Mirror Adapter ──upsert──► 本地主数据 / sap_po_mirrors
                                                      │
                                                      ▼
                                         规划引擎仍读 skus / position / forecast
                                         PMC 履约仍用 purchase_drafts（可关联 external_id）
```

---

## 2. 接入分期（本 P4 只做 1–2）

| 阶段 | 内容 | P4 |
|------|------|----|
| 1 | 供应商 + 物料主数据 | ✅ |
| 2 | 采购订单镜像（只读镜像表） | ✅ |
| 3 | 库存与入库镜像 | ❌ 下期 |
| 4 | PO 变更事件 | ❌ 预留 event 类型 |
| 5 | 发货通知与物流 | ❌ 可挂 shipments.external_id |

---

## 3. 数据模型

### 3.1 `sap_sync_runs`

| 字段 | 说明 |
|------|------|
| id | uuid |
| source_system | 默认 `sap` |
| entity_type | `merchant` / `sku` / `purchase_order` |
| status | `running` / `succeeded` / `failed` / `partial` |
| requested_by | user id 可空 |
| started_at / finished_at | |
| summary | jsonb：inserted/updated/skipped/errors |
| error_message | text |

### 3.2 `sap_po_mirrors` / `sap_po_mirror_lines`

镜像只读台账，**不**驱动库存位置（避免与跟单双计）。可选后续「一键生成跟单草稿」。

头：`id, source_system, external_id, external_version, sync_status, last_sync_at, po_number, vendor_external_id, merchant_code?, order_date, status_raw, payload jsonb`  
行：`id, mirror_id, external_line_id, sku_external_id, sku_id?, qty, uom, delivery_date, payload jsonb`

### 3.3 既有表补齐

对 `merchants` / `skus` / `purchase_drafts` / `shipments` / `lead_time_profiles` / `pmc_plans`：

- 已有 `source_system` / `external_id` 则补：`external_version`, `sync_status`, `last_sync_at`（缺啥补啥）

`sync_status` 枚举建议：`pending` / `synced` / `error` / `ignored`

---

## 4. Adapter 契约

```ts
type SapMirrorEntityType = 'merchant' | 'sku' | 'purchase_order';

interface SapMirrorTransport {
  /** 拉取一批；Fixture 实现从 JSON 读 */
  fetchBatch(entityType: SapMirrorEntityType, cursor?: string): Promise<{
    items: unknown[];
    nextCursor?: string;
  }>;
}

interface SapMirrorIngestResult {
  runId: string;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ externalId?: string; message: string }>;
}
```

映射规则（写死可测）：

- merchant：`externalId` ← SAP Vendor；`code` ← Vendor 或映射字段；`name` ← Name1  
- sku：`externalId` ← Material；`code` ← Material；名称/单位按 payload  
- PO：写入 mirror 表；vendor/material 按 external_id 反查本地 id，找不到则行级 error 记入 summary  

幂等：`(source_system, external_id)` upsert。

---

## 5. API / 页面

| API | 说明 |
|-----|------|
| `POST /api/sap-mirror/ingest` | body: `{ entityType, items[] }` 或 multipart fixture |
| `GET /api/sap-mirror/runs` | 最近同步 |
| `GET /api/sap-mirror/purchase-orders` | 镜像 PO 列表 |
| `POST /api/sap-mirror/purchase-orders/:id/link-draft` | 可选：生成/关联 purchase_draft（P4 可做最小版） |

页面：`/data/sap-mirror`，菜单 `data.sap_mirror`。  
权限：admin / pmc_planner。

---

## 6. 飞书冻结

不改：大件备货、采购跟进、库存总览、库存查询列表结构与 mapper。

---

## 7. 验收

- Fixture 导入商家/SKU 可幂等 upsert，`source_system=sap`  
- PO 镜像可查询，不进入 inventory position  
- sync_runs 可追溯  
- 无真实 SAP SDK/网络调用  
- 飞书四列表未改  

---

**实现计划**：`docs/superpowers/plans/2026-07-29-inventory-planning-p4-sap-mirror.md`
