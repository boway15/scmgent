# FOB 分账 · 拖车/货代分拆核算 PRD

**版本**：v2.0（2026-06-18）  
**父模块**：[mvp-overview.md](mvp-overview.md) §8 FOB 分账  
**关联 PRD**：[mvp-fob-fee-allocation-rules.md](mvp-fob-fee-allocation-rules.md)（分摊规则，本期不改核心引擎）  
**核心维度**：针对**拖车**或**货代**单一账单，按**法人主体（公司）**与**货柜明细**完成分拆核算与导出

---

## 1. 需求分析

### 背景

FOB 分账需将拖车行或货代港杂费账单，按柜号拆分到各法人主体。当前系统允许同一批次同时导入拖车与货代账单，且创建时无分账类型与服务商维度，导致：

- 核算范围混淆（拖车与货代应分账期、分对账）
- 分公司导出缺少柜级总额对照，频繁向总部索要明细
- 无法按服务商管理账单格式与列表筛选
- 商家汇总无付款跟踪

### 用户角色

| 角色 | 权限 | 典型操作 |
|------|------|----------|
| 物流专员 | FOB 分账菜单读写 | 建批次、导入、核算、维护付款状态 |
| 财务审核 | FOB 分账菜单读写 | 平账确认、导出、标记付款 |
| 管理员 | FOB + 规则/服务商配置 | 维护服务商枚举、分摊规则 |

> 付款状态修改：**不做额外权限控制**（与 FOB 菜单写权限一致）。服务商配置权限与分摊规则相同（管理员）。

### 用户故事

- 作为 **物流专员**，我希望创建批次时选择「拖车分账」或「货代分账」并绑定一家服务商，以便每月分开核算。
- 作为 **物流专员**，我希望同一批次只导入一种账单（拖车或货代），且只对应一家服务商，避免混账。
- 作为 **分公司财务**，我希望在分摊结果中**分开展示**「本公司承担」与「本柜/本费总额」，减少索要明细。
- 作为 **财务审核**，我希望在商家汇总中标记各主体付款状态（是/否/无需支付），选「无需支付」时必填备注。
- 作为 **管理员**，我希望在系统内维护拖车/货代服务商有限枚举，并配置其账单格式。

### 已确认业务决策（2026-06-18）

| # | 议题 | 决策 |
|---|------|------|
| 1 | 需求 3 展示方式 | **分开展示**：本公司承担金额与本柜/本费总额分列，不合并为一列 |
| 2 | 付款状态 | 默认「未付款」；**可随时修改**；不做独立权限 |
| 3 | 「无需支付」 | 含：金额为 0、总部代付、总部小配件不支付；**选此项时备注必填** |
| 4 | 服务商 | 支持**添加与管理**；本期上线配置页 |
| 5 | 账单格式 | **同一服务商仅对应一种** `bill_format` |
| 6 | 导入校验 | 不强制校验文件与服务商匹配；**仅软提醒**（如选森威但识别为其他格式） |
| 7 | 服务商混用 | **一个批次仅绑定一家服务商**；一次导入不得混入两家拖车或两家货代 |
| 8 | 同月多批次 | **允许**同账期分别存在拖车批次与货代批次 |
| 9 | 体积数据 | **各批次独立导入**，不跨批次共用 |
| 10 | 历史数据 | **全部删除**，不做 legacy 迁移 |
| 11 | 业务编号导出 | **本期不做**（`internal_no` / `order_no` 等暂不加入导出列） |
| 12 | 分公司导出结构 | **两级明细**：柜级汇总行 + 费用明细行 |
| 13 | 服务商配置权限 | 与分摊规则相同（管理员） |
| 14 | 服务商配置页 | **本期纳入** |

---

## 2. 数据模型

### 2.1 枚举

```sql
-- 分账类型
CREATE TYPE fob_settlement_type AS ENUM ('trucking', 'freight');

-- 服务商类型（与分账类型对齐）
CREATE TYPE fob_provider_type AS ENUM ('trucking', 'freight');

-- 账单解析格式（一服务商一种）
CREATE TYPE fob_bill_format AS ENUM (
  'senwei_original',    -- 森威原表
  'huamao_original',    -- 华贸原表
  'simplified_wide'     -- 简化宽表模板
);

-- 付款状态
CREATE TYPE fob_payment_status AS ENUM ('paid', 'unpaid', 'not_required');
```

| 展示 | 枚举值 |
|------|--------|
| 是 | `paid` |
| 否 | `unpaid` |
| 无需支付 | `not_required` |

### 2.2 表：`fob_service_providers`（服务商配置）

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | uuid | ✅ | ✅ | 主键 |
| code | varchar(50) | ✅ | ✅ | 如 `senwei`、`huamao` |
| name | varchar(200) | ✅ | | 展示名 |
| provider_type | fob_provider_type | ✅ | | `trucking` / `freight` |
| bill_format | fob_bill_format | ✅ | | 该服务商唯一账单格式 |
| sort_order | int | ✅ | | 下拉排序，默认 0 |
| is_active | boolean | ✅ | | 停用后不可用于新建批次 |
| remark | text | | | |
| created_at | timestamptz | ✅ | | |
| updated_at | timestamptz | ✅ | | |

**种子数据**

| code | name | provider_type | bill_format |
|------|------|---------------|-------------|
| senwei | 森威 | trucking | senwei_original |
| huamao | 华贸 | freight | huamao_original |

可选追加简化模板服务商（`simplified_wide`），由管理员在配置页维护。

**约束**

- 同一 `code` 不可重复
- 停用仅 `is_active = false`，不物理删除

### 2.3 表：`fob_settlement_batches`（扩展）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| settlement_type | fob_settlement_type | ✅ | **新增**；创建后不可改 |
| service_provider_id | uuid | ✅ | **新增** FK → `fob_service_providers`；创建后不可改 |

**约束**

- `service_provider.provider_type` 必须等于 `settlement_type`
- `service_provider.is_active` 创建时必须为 true

**历史数据**：上线前清空 FOB 相关表数据（批次、账单、分摊、体积、付款状态），不做迁移。

### 2.4 表：`fob_merchant_payment_status`（商家付款状态）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | 主键 |
| batch_id | uuid | ✅ | FK → 批次，级联删除 |
| merchant_code | varchar(100) | ✅ | 主体编码 |
| payment_status | fob_payment_status | ✅ | 默认 `unpaid` |
| remark | text | | `not_required` 时**必填** |
| updated_by | uuid | | 最后修改人 |
| updated_at | timestamptz | ✅ | |
| created_at | timestamptz | ✅ | |

**唯一索引**：`(batch_id, merchant_code)`

**规则**

- 分摊核算完成后，为 `merchantSummary` 中每个主体 upsert 一行，默认 `unpaid`
- `payment_status = not_required` → `remark` 非空，否则 400
- 批次 `confirmed` 后仍可修改（无额外权限）

### 2.5 既有表（本期不变更结构）

- `fob_trucking_bill_items` — 仅 `trucking` 批次使用
- `fob_freight_bill_items` — 仅 `freight` 批次使用
- `fob_merchant_shipments` — 每批次独立导入
- `fob_settlement_allocations` — 分摊结果
- `fob_fee_allocation_rules` — **全局共用**，不按服务商拆分（已确认）

### 2.6 关系

```
fob_service_providers
        ↑
fob_settlement_batches ──1:N── fob_merchant_shipments
        │                    fob_trucking_bill_items (trucking only)
        │                    fob_freight_bill_items (freight only)
        │                    fob_settlement_allocations
        └──1:N── fob_merchant_payment_status
```

---

## 3. 页面流程

### 3.1 页面清单

| 页面 | 路由 | 功能 | 权限 |
|------|------|------|------|
| FOB 分账列表 | `/logistics/fob-settlement` | 批次列表；筛选类型/服务商/账期 | FOB 读写 |
| FOB 分账详情 | `/logistics/fob-settlement/:id` | 导入、核算、汇总、导出 | FOB 读写 |
| 分摊规则 | `?tab=rules` | 已有 | 管理员 |
| **服务商配置** | `?tab=service-providers` | 服务商 CRUD、启用/停用 | 管理员 |

### 3.2 新建批次表单

| 步骤 | 字段 | 控件 | 校验 |
|------|------|------|------|
| 1 | 批次名称 | 文本 | 必填 |
| 2 | 账期 | month | 必填，`YYYY-MM` |
| 3 | 分账类型 | 单选：拖车分账 / 货代分账 | 必填 |
| 4 | 服务商 | 下拉 | 必填；仅显示 `provider_type` 匹配且 `is_active` 的项 |
| 5 | | 创建按钮 | 切换类型时清空服务商选项 |

创建后详情页展示：`分账类型 · 服务商名称`（只读）。

### 3.3 数据导入 Tab（按类型显隐）

| 分账类型 | 显示导入块 |
|----------|------------|
| trucking | ① 体积信息 ② 拖车账单 |
| freight | ① 体积信息 ② 货代账单 |

**互斥规则**

| 规则 | 行为 |
|------|------|
| 类型与账单 | `trucking` 批次禁止 `import/freight`；`freight` 禁止 `import/trucking` → 400 |
| 单服务商 | 批次已绑定一家服务商；导入文件解析后若检测到与批次服务商 `bill_format` 不一致 → **不阻断**，返回 `warnings` 软提醒 |
| 重导 | 重导同类型账单覆盖该类型明细，不影响体积 |

**工作流就绪条件**

```
allReady = volumeImported && billImported
// billImported = trucking 批次有拖车行 OR freight 批次有货代行
```

移除「必须同时导入拖车+货代」的前端逻辑。

### 3.4 分摊核算 Tab — 分开展示（需求 3）

在「按主体汇总」视图及柜级矩阵中，**分列**展示：

| 列组 | 字段 | 说明 |
|------|------|------|
| 本公司 | `merchant_allocated_cny` | 当前主体在该柜/该费项承担金额 |
| 本柜总共 | `container_bill_total_cny` | 该柜本批次类型账单总额（或该费项账单原额） |

- 不合并为单列「占比」；可选额外展示 `volume_ratio` / 占比列为辅助
- 单主体柜：两列数值相同

### 3.5 商家汇总 Tab（需求 5）

| 列 | 可编辑 |
|----|--------|
| 商家编码 / 名称 | 否 |
| 拖车 / 货运 / 清关 / 其他 / 合计 | 否（按类型批次，非本类型阶段为 0 或隐藏） |
| **是否付款** | ✅ 下拉：是 / 否 / 无需支付 |
| **备注** | ✅；选「无需支付」时必填 |

「无需支付」适用：金额为 0、总部代付、总部小配件不支付（业务说明写入备注）。

### 3.6 服务商配置 Tab

- 列表：编码、名称、类型、账单格式、排序、状态、操作
- 新建/编辑：code、name、provider_type、bill_format、sort_order、remark
- 停用：已有批次引用仍展示名称，新建不可选
- 不可物理删除

---

## 4. 业务逻辑

### 4.1 批次状态机（沿用）

```
draft → imported → reviewed → calculated → confirmed
```

- `confirmed` 后：导入、核算、调账只读；**付款状态仍可改**

### 4.2 分摊核算

- 仅读取本批次 `settlement_type` 对应账单表构建 `feeLines`
- 体积、异常审核、分摊引擎逻辑沿用 [mvp-fob-fee-allocation-rules.md](mvp-fob-fee-allocation-rules.md)
- 核算成功后：为所有参与分摊的 `merchant_code` 初始化 `fob_merchant_payment_status`（默认 `unpaid`）

### 4.3 导入软提醒（不校验阻断）

```text
若批次.service_provider.bill_format = senwei_original
   但文件识别为 huamao_original | simplified_wide
→ 响应 warnings: ["账单格式与所选服务商「森威」可能不一致，请核对"]
→ 仍写入解析结果（imported > 0 时）
```

识别逻辑沿用现有 `isSenweiTruckingSheet` / `isHuamaoFreightSheet` / `isSimplified*` 函数。

### 4.4 分公司导出（两级明细）

**本期不含业务编号列**（`internal_no` / `order_no` 暂不导出）。

**Sheet 结构（每个主体一个 xlsx，ZIP 打包）**

固定元信息行（可选首行）：

| 账期 | 分账类型 | 服务商 | 批次编号 |
|------|----------|--------|----------|

**按柜分组 — 两级行**

```
【汇总行】柜号 | 主体名称 | 体积m³ | 本公司合计 | 本柜账单总额 | (空费用列)
【明细行】  ↳ 费用项1 | ... | 本公司金额 | 本费项账单总额 | ...
【明细行】  ↳ 费用项2 | ...
【汇总行】下一柜...
```

- 汇总行：`本公司合计` = 该主体在该柜分摊之和；`本柜账单总额` = 该柜本批次账单合计
- 明细行：逐费用项分列展示本公司承担与本费项原额（**分开展示**）
- 动态费用列：仅包含本批次类型产生的费用项
- 末列可增加「是否付款」「备注」（来自 `fob_merchant_payment_status`）

**总账导出**（`reconcile-total`）：全主体宽表，同样两级结构或扁平化所有柜（推荐扁平：每柜汇总行+明细行连续排列）。

### 4.5 API 清单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/logistics/fob-service-providers` | 服务商列表（筛选 type、active） |
| POST | `/api/logistics/fob-service-providers` | 新建（管理员） |
| PATCH | `/api/logistics/fob-service-providers/:id` | 更新（管理员） |
| PATCH | `/api/logistics/fob-service-providers/:id/toggle` | 启用/停用 |
| POST | `/api/logistics/fob-settlements` | **扩展** body：`settlementType`、`serviceProviderId` |
| GET | `/api/logistics/fob-settlements/:id` | 返回类型、服务商、付款状态 |
| POST | `.../import/trucking` | trucking 批次专用；freight 批次 400 |
| POST | `.../import/freight` | freight 批次专用；trucking 批次 400 |
| PATCH | `/api/logistics/fob-settlements/:id/merchant-payments` | 批量更新付款状态+备注 |
| GET | `.../export/reconcile-by-merchant` | 两级明细 ZIP |
| GET | `.../export/reconcile-total` | 总账两级/扁平 |

### 4.6 数据清理（上线脚本）

执行顺序（仅非生产或业务确认后）：

1. `TRUNCATE` / `DELETE`：`fob_settlement_allocations`、`fob_settlement_adjustments`、`fob_merchant_shipments`、`fob_trucking_bill_items`、`fob_freight_bill_items`、`fob_container_merchant_stats`、`fob_merchant_payment_status`、`fob_settlement_batches`（按 FK 顺序）
2. 迁移 SQL：新增枚举、表、批次字段
3. Seed：`fob_service_providers`（森威、华贸）

---

## 5. 集成与非功能

### 妙搭兼容

- Schema + `drizzle/*.sql` 同步至 ZIP 包
- 服务商配置存 PostgreSQL，无本地磁盘依赖
- 导出 xlsx/zip 内存生成

### 测试要点

| 场景 | 预期 |
|------|------|
| 创建拖车批次 + 选森威 | 仅显示体积+拖车导入 |
| freight 批次调 import/trucking | 400 |
| 同月拖车+货代两个批次 | 允许 |
| 体积不跨批次 | 批次 A 体积在批次 B 不可见 |
| 导入格式与服务商不符 | 200 + warnings，数据仍入库 |
| 商家汇总默认未付款 | 核算后均为「否」 |
| 无需支付无备注 | PATCH 400 |
| 无需支付有备注 | 成功 |
| confirmed 后改付款 | 成功 |
| 分公司导出 | 每柜汇总行+明细行，含本公司/本柜总额分列 |
| 服务商停用 | 新建不可选，历史批次只读展示 |

---

## 6. 验收标准

### P0 — 批次与互斥

- [ ] 创建时必选分账类型 + 服务商
- [ ] 拖车/货代账单不可在同一批次导入
- [ ] 一个批次仅一家服务商
- [ ] 体积各批次独立导入
- [ ] 历史 FOB 数据已按约定清空

### P1 — 服务商配置

- [ ] 服务商 Tab CRUD、启用/停用
- [ ] 一服务商一种 bill_format
- [ ] 管理员权限与分摊规则一致

### P2 — 展示与付款

- [ ] 分摊/汇总：本公司承担与本柜总额**分开展示**
- [ ] 商家汇总付款三态，默认未付款
- [ ] 无需支付备注必填；confirmed 后可改

### P3 — 导出

- [ ] 按公司导出：两级明细（柜汇总+费用明细）
- [ ] 含分账类型、服务商；**不含业务编号**（本期）
- [ ] 含付款状态与备注

---

## 7. Backlog（本期不做）

- 业务编号导出（`internal_no` / `order_no`）
- 分摊规则按服务商区分（`service_provider_id` on rules）
- 导入文件与服务商**强制校验**阻断
- 付款状态独立权限 / 审批流
- 体积跨批次共用
- 历史批次 legacy 保留

---

## 8. 质量检查

- [x] 每张新表有主键与 `created_at`
- [x] 外键与唯一约束明确
- [x] 页面 CRUD 与状态流转完整
- [x] 字段 snake_case，枚举小写
- [x] 与已确认业务决策一致
