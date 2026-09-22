# 库存规划分仓投影与在途日期治理

**版本**：v1.0（2026-09-18）  
**定位**：在不改变「迅捷 → 飞书 → 库存总览」合计口径的前提下，把 `OVERSEAS` 合计投影到目的仓批次，并去掉无期在途的假 ETA，使时间轴确定线、7/15/30 预警与 SKU 规划页可用。  
**不接迅捷 API、不加密飞书 Cron、不改日余额公式、不改预测。**

**关联文档**：

- `docs/superpowers/specs/2026-09-17-inventory-timeline-daily-engine-design.md` — 日余额、三档供给、7/15/30 只看确定线
- `docs/superpowers/specs/2026-07-24-inventory-turnover-feishu-sync-design.md` — 飞书周转表；区域列为销售占比；合计写入 `OVERSEAS`
- 现网：`turnover-bucket-warehouse.ts`、`inventory-supply-lots.ts`、`inventory-supply-lot-sync.ts`、`inventory-timeline.ts`

用户确认：方案 1 + 问题 A（合计仓 vs 规划仓）+ 问题 B（无期在途/工厂假日期导致近窗误报）。

---

## 1. 背景与目标

飞书压缩周转表只有 `海外仓在库`、`调拨在途合计`。导入后 `parseTurnoverWarehouseBuckets` 在无分仓数量列时写入汇总仓 `OVERSEAS`。规划、健康、预警按 `US-WEST` 等目的仓取数，确定线期初为 0，7/15/30 会误报缺货。

在途残差用 `skuId::OVERSEAS` 去扣发运数量，发运在目的仓上，残差几乎扣不掉；又给残差写 `今天 + 默认海运` 且 `dateUnknown=true`。虽然分类为计划线、不进 7/15/30，但三池日期不可信，且海外在库对不上仓时确定线仍然空洞。

本设计回答：

> 在飞书只给合计的前提下，规划引擎如何按目的仓得到可信的确定供给，以及无期在途如何避免污染时间轴。

成功标准：

- 有占比时，目的仓规划页确定线期初 = 按占比拆后的海外在库（取整后各仓之和等于合计）。
- 库存总览仍展示飞书合计，`inventory_records` 不改为假分仓实物。
- 发运/跟单在途按 **SKU 全局** 从调拨在途合计中扣除后再拆残差，不重复计算。
- 无上架桶、无最早上架日的残差：三池可见、`available_at` 为空、不进时间轴。
- 占比全空：不拆仓；该目的仓不产生 `stockout_horizon`。

---

## 2. 决策摘要

| 项 | 选择 |
|----|------|
| 总览 / `inventory_records` | 维持飞书合计 → `OVERSEAS` |
| 规划供给载体 | 仍为 `inventory_supply_lots`，同步时投影到目的仓 |
| 拆分权重 | 飞书近半年销售占比列 × `TURNOVER_BUCKET_WAREHOUSE_MAP` |
| 取整 | 最大余数法，各仓件数之和 = 合计 |
| 无占比 | 不拆；批次留 `OVERSEAS`；目的仓 horizon 跳过 |
| 在途扣减 | `残差 = max(0, 在途合计 − Σ该SKU发运在途 − Σ该SKU跟单在途)` |
| 残差日期 | 三桶或最早上架日 → 计划线；否则无期排除 |
| 禁止 | `今天 + 默认海运` 作为残差 ETA |
| 跟单无目的仓 | 按同一占比拆并标记推定；无占比则留 `OVERSEAS` |
| 7/15/30 | 仍只看确定线；计划上架桶不计入 |
| 日余额 / 建议量 / 健康灯 | 沿用 2026-09-17 spec |

---

## 3. 架构

```text
飞书合计 → inventory_records(OVERSEAS)          // 总览、对账
         → 占比拆仓 + 全局扣在途单据
         → 残差日期（三桶 / 最早上架 / 无期）
         → inventory_supply_lots（按目的仓）
                ↓
     classifySupplyLot + projectDailyInventory
                ↓
     SKU规划 / 补货 / 预警 / 驾驶舱
```

| 单元 | 职责 | 依赖 |
|------|------|------|
| `allocateByShare` | 占比归一化 + 最大余数取整 | `FEISHU_REGION_SALES_SHARE_FIELDS`、`TURNOVER_BUCKET_WAREHOUSE_MAP` |
| `expandOverseasSnapshots` | `OVERSEAS` 在库/占用/在途合计 → 多仓快照输入 | 占比；turnoverSnapshot |
| `buildLotsFromInputs` | 全局扣在途单据、残差日期、禁止假 ETA | 现网 lots 纯函数扩展 |
| `syncInventorySupplyLots` | 读占比、调扩展后的 build | 飞书拉取后仍调用 |
| 规划 API / 预警 | 透出拆仓状态；未分仓跳过 horizon | lots + snapshot 业务日 |

不改路由前缀。不新建事件表。尽量不新增批次表列：用 `sourceId` 前缀区分拆仓/推定仓（见 §6）。

流水线仍为：飞书周转拉取 → 三池同步 → 补货预测 → 缺货预警。

---

## 4. 占比拆仓（问题 A）

### 4.1 何时拆

快照 `warehouseCode === 'OVERSEAS'`（飞书压缩表路径）。已有真分仓数量列、已写入 `US-WEST` 等的行 **不拆、不覆盖**。

### 4.2 权重

从该 SKU `turnoverSnapshot`（或同步行）读取：

`美东` `美南` `美西` `美中` `美东南` `德国` `平台仓_美` `平台仓_欧`

映射与现网一致（`美西` → `US-WEST` 等）。解析规则与飞书 mapper 的 `parseShare` 相同（支持小数或百分数）。

- 正权重仓参与分配。  
- 权重和为 0 或所有列空：**不拆**。  
- 权重和与 1 的偏差 > 0.05：仍按相对权重拆（先归一化），并记 `shareSumWarning`（总览已有 mismatch 计数，规划页可提示占比未归一）。

### 4.3 最大余数法

对数量 `Q`、权重 `w_i`（已归一化 Σw=1）：

1. `floor_i = floor(Q * w_i)`  
2. `rem = Q - Σ floor_i`  
3. 按 `{Q*w_i} - floor_i` 从大到小把余数 1 件分给前 `rem` 个仓  

在库、占用、在途残差 **分别** 对各自的 `Q` 做一次，不共用余数排序结果（避免一仓占用被拆到无库存的仓时允许；若占用 > 该仓在库，时间轴仍按现网 `max(0, supply − reserved)`）。

### 4.4 占用

`getLatestInventorySnapshot(sku, US-WEST)` 在 records 上常为 0。该仓时间轴的 `reservedQty`：

1. 本仓 `inventory_records.qty_reserved`（若有）  
2. 否则 `OVERSEAS.qty_reserved` 按同一占比拆到该仓的件数  

### 4.5 规划页回退

现网 `buildSkuWarehouseTimeline` 在无海外确定批时用本仓 `snap.qtyAvailable` 补当天可售。本仓 records 为 0、lots 已拆入目的仓时走 lots，不把 `OVERSEAS` 全量补进单个目的仓。

`OVERSEAS` 本身不作为规划默认仓；目的仓无拆后批次且未分仓时确定海外供给为 0，并走 §7 黄条。

---

## 5. 在途与本地日期（问题 B）

### 5.1 全局残差

```text
docTransitQty(sku) = Σ 发运.open在途qty + Σ 跟单.status∈{in_transit, partial_received} 的 openQty
残差(sku) = max(0, OVERSEAS.qtyInTransit − docTransitQty(sku))
```

发运/跟单仍按 **各自目的仓** 生成在途批次（现网逻辑）。残差不再用 `sku::OVERSEAS` 键扣单仓发运。

残差再按 §4 占比拆到各目的仓。无占比则一条残差留在 `OVERSEAS`。

### 5.2 残差日期（只进计划线）

读取周转快照：

- `预计10天上架_合计` / `预计10-20天上架_合计` / `预计超20天上架_合计`（由飞书 `预计10天内|10-20天|超20天上架数量` 拆出）  
- `最早在途上架时间`

规则：

| 条件 | 批次 | `available_at` | `etaEstimated` | `dateUnknown` | 档位 |
|------|------|----------------|----------------|---------------|------|
| 三桶数量之和 > 0 | 最多三批，数量按桶与残差取小后按占比拆 | 今天+5 / +15 / +25 | true | false | 计划 |
| 三桶皆空，有最早上架日 | 一批 = 残差 | 该日期 | true | false | 计划 |
| 都没有 | 一批 = 残差 | **null** | true | true | 排除 |

三桶数量之和与残差不一致时：**以残差为上限**。桶合计 > 残差则按桶比例缩放到残差（取整用最大余数）；桶合计 < 残差则差额部分按「都没有」处理（无期排除）。

**禁止** `available_at = today + defaultTransitLeadDays`。

真 ETA 的发运/跟单在途：`etaEstimated=false` 且 `dateUnknown=false` → **确定**（沿用 2026-09-17）。

### 5.3 跟单无目的仓

现网 `if (!wh) continue` 会丢弃。改为：有占比则按占比拆 `openQty` 到各仓，`sourceId` 标明推定仓；无占比则 `warehouseCode=OVERSEAS`，不进入各目的仓确定线。

本地池无 `available_at`（算出货日失败）：排除，不编造 `ship_ready_at=today`。

---

## 6. 批次标识（不强制迁移）

| 含义 | `source` | `sourceId` 约定 |
|------|----------|-----------------|
| 占比拆后海外在库 | `snapshot` | `avail-share:{skuId}:{warehouse}` |
| 占比拆后残差在途（有期） | `snapshot` | `transit-share:{skuId}:{warehouse}:{bucket}` bucket=`d5`/`d15`/`d25`/`earliest` |
| 无期残差 | `snapshot` | `transit-share:{skuId}:{warehouse}:undated` |
| 跟单仓由占比推定 | `purchase_draft` | 现网 draftId，另在扩展字段或 `sourceId` 后缀 `#share` |

三池列表用 `sourceId` 含 `-share` 或 `#share` 显示「占比拆仓」/「仓由占比推定」。若实现时发现必须结构化查询，再加可空列 `allocation_method`（`none` / `sales_share` / `warehouse_inferred`），本期默认不迁库。

---

## 7. 界面与预警

### 7.1 SKU 规划页

规划 API 增加（可放在 `timeline` 旁）：

```ts
allocation?: {
  method: 'sales_share' | 'native_warehouse' | 'unallocated';
  snapshotDate: string | null;
  overseasTotal: number;
  allocatedQty: number;      // 本仓拆得的海外在库
  undatedTransitQty: number; // 本仓无期残差
  shareSumWarning: boolean;
}
```

- `unallocated`：黄条「飞书无销售占比，库存记在 OVERSEAS，本仓确定线与 7/15/30 不可用」。  
- `sales_share`：灰字数据条「按近半年销售占比拆自海外合计；快照日 {date}」。  
- `undatedTransitQty > 0`：提示「N 件在途无可用日，未计入时间轴」。

时间轴表结构、确定/预计列含义不变。

### 7.2 库存三池

- 无 `available_at` 继续黄条「不进时间轴」；**不要**显示假 ETA。  
- 占比拆仓 / 推定仓用次要标签，避免当成跟单原文字段。

### 7.3 预警任务

对健康/预警行的目的仓：

- `allocation.method === 'unallocated'`：**不写** `stockout_horizon`，不把该仓计入驾驶舱 7/15/30。可记 task 日志或数据质量类提示，不冒充缺货动作。  
- 已拆仓：`deriveHorizonAlerts` 仍只读确定线锚点。  
- `uncoverable_by_new_po` 等同样只基于分仓后确定线。

---

## 8. 数据层业务必须保证（非代码可补）

| 决策效果 | 必须有的数据 |
|----------|----------------|
| 分仓可售 | 飞书 SKU=系统 SKU；`海外仓在库`=迅捷当日海外可售合计；占比列有数且宜 Σ≈1 |
| 三池分得开 | `调拨在途合计` 不含已入海外仓；发运有数量+目的仓+`eta_available`+状态 |
| 本地管道 | 跟单有目的仓（或接受占比推定）、状态、出货交期 |
| 残差进计划线 | 三桶上架或 `最早在途上架时间` |
| 缺货日/建议量 | 日需求非 0（预测或有效日均）；本期不改预测 |

T+1 可接受；快照业务日必须可展示。日内已出库而飞书未更新，属于链路时延，本期只标龄期、不假装实时。

---

## 9. 验收

1. 合计 100，美西 0.6、美东 0.4 → lots 海外 `US-WEST=60`、`US-EAST=40`；`inventory_records` 仍 `OVERSEAS=100`。  
2. 美西规划确定线 k=0 的 `confirmedEnding` 在占用为 0、需求为 0 时为 60。  
3. 发运 30 去美西且有 ETA，在途合计 80 → `docTransit=30`，残差 50 再按占比拆；美西确定在途含发运 30，不与 OVERSEAS 残差重复。  
4. 残差无三桶、无最早上架日 → 三池可见、`available_at` 空、时间轴供给事件无该批；不得出现 `today+默认海运`。  
5. 占比全空 → 不拆；美西规划黄条；该仓不产生 `stockout_horizon`。  
6. 三桶只进计划线：`confirmedEnding(7)` 不因三桶增加。  
7. 日余额、建议量、健康灯与 `2026-09-17` spec 一致。

---

## 10. 非范围

- 迅捷直连、加密飞书拉取  
- 改日余额公式、覆盖天数健康灯、建议量公式  
- 计划线写入 7/15/30 或扣减建议量  
- PMC 未转跟单进供给  
- 调拨执行单、本地出货建议  
- 预测/日均治理（问题 D）  
- 把 `OVERSEAS` 合计改写成多条假 `inventory_records` 分仓行  

---

## 11. 测试要点

纯函数（优先）：

- `allocateByShare`：整除、余数、Q=0、权重和为 0、权重和=0.9/1.1 归一化  
- `buildLotsFromInputs`：全局扣在途；无期残差无假 ETA；三桶上限=残差；真分仓快照不二次拆 `OVERSEAS`  
- 预警：`unallocated` 不生成 horizon  

集成：同步后 lots 仓码不再几乎全是 `OVERSEAS`（有占比的 SKU）。
