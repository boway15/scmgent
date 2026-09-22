# 安全库存建议值（只读推算）

**版本**：v1.0（2026-09-20）  
**定位**：按销量波动与分段交期，为每个 SKU × 仓推算建议安全库存天数 / 件数 / ROP，供 PMC 对照；**不自动覆盖**现网已生效的 `safety_stock_config`（含默认 14 天）。  
**不改健康灯、时间轴、缺货预警、补货预测任务的读数口径。**

**关联文档**：

- `docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md` — 分段交期、覆盖天数健康灯
- `docs/superpowers/specs/2026-09-17-inventory-timeline-daily-engine-design.md` — 时间轴用已配置 `safetyStockQty`
- `docs/superpowers/specs/2026-09-18-inventory-share-allocation-design.md` — 海外合计按占比拆仓（建议侧分仓口径对齐）
- 现网：`safety-stock-z.ts`、`inventory-health-service.ts`、`routes/safety-stock.ts`、`SafetyStockPage.tsx`

用户确认：方案 1 — 只出建议值，不改现网默认 14 天；人工「采纳」后才写入配置。

---

## 1. 背景与目标

现网安全库存以 **覆盖天数** 为主：`safety_stock_days` 默认 14，件数 = 日均 × 天数。PMC 常问：14 天是否合理？能否从销量波动和交期反推？

理论上 **件数与 ROP 应由数据推算**；**天数与服务水平是策略选择**，不能从数据唯一确定。但 Z 值法可在给定服务水平下算出建议件数，再反推 **等价覆盖天数**，与现配置对比。

本设计回答：

> 在不改动生效配置的前提下，如何为 SKU × 仓展示可信的建议安全库存，并支持人工采纳？

成功标准：

- 列表展示：配置天数/件数 vs 建议天数/件数/ROP、偏差、置信度。
- 未点「采纳」前，`safety_stock_config`、健康灯、时间轴、预警 **行为不变**。
- 建议侧日均、交期与健康计算 **同源**，避免两套口径打架。
- 无销量或数据不足时优雅降级（标记 flag，不报错、不写库）。

---

## 2. 决策摘要

| 项 | 选择 |
|----|------|
| 建议方法 | 默认 `z_demand`：`ceil(Z × σ_d × √L)` |
| 服务水平 | 默认 95%（UI 可切换，**仅影响建议列**） |
| 日均 μ | 有已发布预测 → 未来 90 天加权日均；否则 → `resolveHistoricalDemand`（含断货修正） |
| σ_d | 近 90 天日销标准差；有效销售日 < 2 → `0.3 × μ` |
| 提前期 L | `resolveLeadTimeForSkuWarehouse` 的 `totalLeadDays`（不用 SKU 单字段 `leadTimeDays`） |
| 建议天数 | `μ > 0` 时 `ceil(建议件数 / μ)`；否则 null |
| 建议 ROP | `ceil(μ × L + 建议件数)` |
| 写库 | **禁止**建议 API 写库；采纳走现有 `PUT` 或显式 `adopt` |
| 现网「计算」按钮 | 保留（仍可直接写库）；与建议列独立 |
| 默认 14 天 | 不动；仅当用户采纳建议或手动改配置才变 |
| σ_L / `z_demand_leadtime` | 本期不做（缺可靠交期标准差） |
| 批量静默回写 | 不做 |
| 飞书策略表 | 不自动同步 |

---

## 3. 架构

```text
销量 + 库存快照 + 预测 + lead_time_profiles
        → calcSafetyStockSuggestion（纯函数）
        → GET .../suggestion(s)  （只读）
        → 安全库存页展示建议列
                ↓（可选）
        PUT .../safety-stock/:skuId  （人工采纳后写入）
                ↓
     健康 / 时间轴 / 预警（仍读已写入配置）
```

| 单元 | 职责 | 依赖 |
|------|------|------|
| `calcSafetyStockSuggestion` | 输入 μ、σ、L、服务水平 → 建议件数/天数/ROP、置信度、flags | `calcSafetyStockQty`、`zFromServiceLevel` |
| `resolveSuggestionInputs` | 按 SKU×仓解析 μ、σ、L（与健康同源） | `resolveHistoricalDemand`、`resolveLeadTimeForSkuWarehouse`、预测 Map |
| `GET /api/safety-stock/suggestions` | 分页列表 + 建议 | 上两者 |
| `GET /api/safety-stock/:skuId/suggestion` | 单行详情 | 上两者 |
| `SafetyStockPage` | 展示配置 vs 建议、偏差、采纳 | 新 API |

不改路由前缀。不新建表。建议结果 **不落库**（可选：后续加 `last_suggested_at` 缓存列，本期不做）。

---

## 4. 计算口径

### 4.1 纯函数

新增 `apps/web/server/lib/safety-stock-suggestion.ts`：

```ts
export type SuggestionConfidence = 'high' | 'medium' | 'low';

export type SafetyStockSuggestion = {
  safetyStockQty: number | null;
  safetyStockDays: number | null;
  reorderPoint: number | null;
  method: 'z_demand';
  serviceLevel: number;
  avgDaily: number;
  demandStdDev: number;
  totalLeadDays: number;
  z: number;
  confidence: SuggestionConfidence;
  flags: string[];
};

export function calcSafetyStockSuggestion(params: {
  avgDaily: number;
  demandStdDev: number;
  totalLeadDays: number;
  serviceLevel?: number;
  inStockDays?: number;
  stockoutAdjusted?: boolean;
  demandSource?: 'forecast' | 'historical';
}): SafetyStockSuggestion;
```

规则：

1. `μ ≤ 0` → 件数/天数/ROP 均为 null，`confidence=low`，`flags` 含 `no_sales`。
2. `σ` 由调用方传入；调用方在有效日销样本 < 2 时用 `0.3 × μ`。
3. `L ≤ 0` 时按 1 天计并打 `lead_time_fallback`。
4. 件数 = `calcSafetyStockQty({ method: 'z_demand', ... }).safetyStockQty`。
5. 天数 = `Math.ceil(件数 / μ)`（上限可 cap 180，避免极低 μ 爆炸；cap 时打 `days_capped`）。
6. ROP = `ceil(μ × L + 件数)`。

### 4.2 置信度

| 条件 | confidence |
|------|------------|
| `no_sales` | low |
| `forecast_demand` 且预测版本已发布 | high |
| 历史 μ + `inStockDays ≥ 30` + 非 cap | high |
| 历史 μ + `inStockDays ≥ 14` | medium |
| `low_sample`（有效销售日 < 14）或 `stockout_adjusted` | medium |
| 其余 | low |

### 4.3 flags

| flag | 含义 |
|------|------|
| `no_sales` | 无法推算 |
| `forecast_demand` | 日均来自预测 |
| `stockout_adjusted` | 用了有货日修正 |
| `low_sample` | 有效销售日 < 14 |
| `lead_time_fallback` | 交期缺失用兜底 |
| `days_capped` | 建议天数触顶 180 |
| `unallocated_warehouse` | 海外合计未拆仓，仓级销量可能不准（与占比 spec 对齐） |

### 4.4 输入解析（与健康同源）

`resolveSuggestionInputs(skuId, warehouseCode)`：

1. **销量**：该仓 `sales_history`；仓级无数据且 `warehouseCode !== 'ALL'` 时，可回退全局销量 × 该仓销售占比（与 `allocateByShare` 同源字段）；仍无则 μ=0。
2. **日均**：有 `sales_forecast_monthly` 已发布版本 → `calcForwardAvgDaily(..., 90)`；否则 `resolveHistoricalDemand`。
3. **σ**：对用于 Z 值的日销序列算标准差（与 `calcDailyStats` 一致）；样本不足 → `0.3 × μ`。
4. **L**：`resolveLeadTimeForSkuWarehouse`。
5. **已配置值**：读 `safety_stock_config`（仓优先，回退 `ALL`）。

---

## 5. API

### 5.1 列表

```http
GET /api/safety-stock/suggestions?warehouse=US-WEST&limit=50&offset=0&serviceLevel=0.95&sort=deltaDays_desc
```

权限：与 `GET /api/safety-stock` 相同（读）。

响应行：

```ts
{
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  configured: {
    safetyStockDays: number | null;
    safetyStockQty: number;
    reorderPoint: number;
    safetyStockMethod: string;
  };
  suggested: SafetyStockSuggestion | null;
  deltaDays: number | null;      // suggested.days - configured.days
  deltaQty: number | null;
  deltaPctDays: number | null;   // |delta| / configured.days，configured 为 0 时 null
}
```

`sort` 可选：`deltaDays_desc` | `deltaDays_asc` | `skuCode`。

### 5.2 单行

```http
GET /api/safety-stock/:skuId/suggestion?warehouse=US-WEST&serviceLevel=0.95
```

结构同列表单行；可附带 `diagnostics`（窗口日数、inStockDays、demandSource）。

### 5.3 采纳（写库）

不新增专用 adopt 路由亦可：前端「采纳」→ 填入编辑态 → 用户点「保存」→ 现有 `PUT /api/safety-stock/:skuId`。

可选增强 `POST /api/safety-stock/:skuId/adopt-suggestion`：body `{ warehouse, serviceLevel? }`，服务端重算建议并写入，`calcMethod=eoq`，`safetyStockMethod=z_demand`，`serviceLevel` 写入配置。**仍要求** `requireMenu('inventory.safety')`。

**禁止**：`GET .../suggestions` 及 `GET .../suggestion` 写库。

### 5.4 与现有 POST calculate 的区别

| | `POST .../calculate` | `GET .../suggestion` |
|--|---------------------|----------------------|
| 写库 | 是 | 否 |
| 交期 | `sku.leadTimeDays` | `totalLeadDays` |
| 日均 | 原始 90 天销量 | 预测优先 + 断货修正 |
| 方法 | 行内所选 | 固定 z_demand（建议） |

---

## 6. 界面（`/inventory/safety`）

在现有表增加列：

| 列 | 说明 |
|----|------|
| 配置天数 | `safety_stock_days`（现页未展示，本期补上） |
| 建议天数 | 只读 |
| 建议件数 | 只读 |
| 偏差 | 如 `−7 天`；`|deltaPctDays| > 0.5` 标黄 |
| 置信度 | 高/中/低 |
| 采纳 | 填入编辑框，**不自动保存** |

交互：

- 顶部说明：「建议值由 Z 值法推算，默认服务水平 95%；采纳前不影响预警与时间轴。」
- 可选筛选：仅显示 `|deltaDays| ≥ N` 或 `confidence=low`。
- flags 用 tooltip 展示（断货修正、样本不足等）。
- 服务水平下拉仅影响建议列请求参数，不改已保存配置。

**不改**：列表默认排序、导入流程、现有「计算」按钮语义。

---

## 7. 分仓与 OVERSEAS

- 建议按 **目的仓** 计算；`warehouseCode=ALL` 时用全局销量与默认交期。
- 飞书仅 `OVERSEAS` 合计、无占比时：仍可出建议，但打 `unallocated_warehouse`，置信度降为 low。
- **不**自动把合计安全库存拆写入各目的仓（与 `2026-09-18` spec 一致）。
- 本期不因未分仓阻塞建议 API。

---

## 8. 数据层业务必须保证（非代码可补）

| 效果 | 需要的数据 |
|------|------------|
| 建议 μ 可信 | 近 90 天销量导入；或已发布预测 |
| 断货修正 | 日级库存快照覆盖足够（与健康相同阈值） |
| 建议 L 可信 | `lead_time_profiles` 或 SKU 默认交期 |
| 仓级建议 | 分仓销量或飞书销售占比 |
| 配置对照 | 飞书 `inventory_policy` 或页内已存 `safety_stock_days` |

---

## 9. 验收

1. SKU 配置 14 天 / 280 件，Z 建议 7 天 / 63 件 → 列表显示偏差，**DB 仍为 280**。
2. 健康灯、SKU 规划时间轴仍用 280，直到用户保存采纳。
3. 点「采纳」+「保存」→ `safety_stock_qty=63`，`safety_stock_days=7`，`calcMethod=eoq`。
4. μ=0 → 建议为空，`no_sales`，HTTP 200。
5. 断货修正 SKU → `stockout_adjusted`，confidence ≤ medium。
6. `GET /suggestions` 不修改 `last_calc_at`（除非用户走 calculate/adopt）。
7. 纯函数单测：`μ=0`、cap 180、`low_sample` 置信度、ROP 公式。

---

## 10. 非范围

- 自动改默认 14 天或批量回写
- `z_demand_leadtime`、σ_L 从跟单统计
- 按 ABC/生命周期自动定服务水平
- 建议结果落库 / 定时任务全量刷新
- 改时间轴、健康灯、预警判定公式
- 飞书 inventory_policy 双向同步

---

## 11. 测试要点

**纯函数**（优先）：

- `calcSafetyStockSuggestion`：正常样例、μ=0、L=0、days cap
- 置信度与 flags 组合

**API**：

- GET 不写库（对比前后 `updated_at`）
- sort=deltaDays_desc
- 无配置行时 configured 用默认值展示

**集成**：

- 安全库存页展示建议列；采纳后 invalidate 列表与健康缓存

---

## 12. 实现顺序建议

1. `safety-stock-suggestion.ts` + 单测  
2. `resolveSuggestionInputs`（抽离健康侧输入，避免重复查库逻辑）  
3. `GET /suggestions`、`GET /:skuId/suggestion`  
4. `SafetyStockPage` 列与采纳交互  
5. （可选）`POST adopt-suggestion`
