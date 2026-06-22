# FOB 分账 · 费用分摊规则配置 PRD

**版本**：v1.0（2026-06-09）  
**父模块**：[mvp-overview.md](mvp-overview.md) §8 FOB 分账  
**前置依赖**：FOB 分账 MVP（批次 CRUD、拖车/货代导入、体积导入、分摊核算、异常审核、明细调账）已上线  
**目标**：将费用分摊方式从「种子数据 + 硬编码」升级为可配置、可覆盖、可审核的完整规则体系

---

## 1. 需求分析

### 背景

FOB 分账每月需将拖车行（森威）与货代（华贸）账单按柜号拆分到各法人主体。不同费用项分摊口径不同：

- **按体积**：拖车费、海运费、堆存费等
- **按票**：报关费、VGM、文件费等（票 = 柜内主体下不同 Sku 数）
- **固定**：压夜费、指定柜号等整柜一次性费用
- **人工/异常**：减免、多收、备注异常、负金额等

当前实现已有 `fob_fee_allocation_rules` 表与导入时自动匹配，但存在缺口：

| 缺口 | 影响 |
|------|------|
| 无规则管理 UI | 改分摊方式需改 DB/seed，业务无法自助 |
| 异常审核仅指定主体 | 无法改分摊方式、调整金额 |
| `fixed` 未实现 | 压夜费等错误按体积分摊 |
| 「落地寄柜费」无种子规则 | 默认按体积，可能与财务口径不符 |
| 账单行无法单独改规则 | 特例需走异常流或重导 |

### 用户角色

| 角色 | 权限 | 典型操作 |
|------|------|----------|
| 物流专员 | FOB 分账菜单读写 | 导入账单、执行核算、处理异常 |
| 财务审核 | FOB 分账菜单读写 | 确认异常金额、平账校验、批次确认 |
| 管理员 | 系统设置 + FOB | 维护全局费用分摊规则 |
| 只读查看者 | FOB 列表/详情只读 | 查看分摊结果，不可改规则 |

> 菜单权限沿用现有 `fob-settlement` 菜单；**费用规则管理**建议挂在「物流 → FOB 分账 → 分摊规则」子路由，仅 `admin` 与具备 `fob-settlement:manage-rules` 扩展权限的角色可写。

### 用户故事

**P1 — 费用规则管理**

- 作为 **管理员**，我希望在页面上维护「费用类型 → 分摊方式」映射，以便新费用项或口径变更时无需发版。
- 作为 **物流专员**，我希望导入账单后系统自动按规则匹配分摊方式，以便减少手工判断。

**P2 — 异常审核增强**

- 作为 **财务审核**，我希望在异常审核时修改分摊方式（按体积/按票/人工）和调整金额，以便处理减免、多收、备注异常等场景。
- 作为 **物流专员**，我希望确认异常后该费用行参与核算且平账差额为 0，以便批次可推进至「已核算」。

**P3 — 固定费用与规则补齐**

- 作为 **财务审核**，我希望压夜费、指定柜号等按「整柜固定」逻辑分摊（默认归属触发主体或整柜唯一主体），以便与供应商对账一致。
- 作为 **管理员**，我希望「落地寄柜费」有明确默认规则，以便与森威账单 12 列完整对齐。

**P4 — 单条费用覆盖**

- 作为 **物流专员**，我希望在账单明细中对单条费用改分摊方式（不进入异常流），以便处理个别柜的特例。
- 作为 **财务审核**，我希望覆盖记录可追溯（谁、何时、原规则、新规则），以便审计。

### 迭代范围（按优先级）

| 迭代 | 范围 | 交付物 |
|------|------|--------|
| **P1** | 费用规则 CRUD 页 + API | 规则列表/新建/编辑/停用 |
| **P2** | 异常审核 UI 增强 | 分摊方式、调整金额、驳回 |
| **P3** | `fixed` 分摊逻辑 + 种子补齐 | 核算引擎 + 迁移 seed |
| **P4** | 账单行规则覆盖 | 拖车/货代明细 Tab + 审计字段 |

---

## 2. 数据模型

### 2.1 既有表（沿用，本节仅列变更）

#### 表：`fob_fee_allocation_rules`（费用分摊规则 — 全局配置）

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | uuid | ✅ | ✅ | 主键 |
| fee_type | varchar(100) | | | 精确匹配费用名（如 `拖车费`）；与 `match_pattern` 二选一 |
| source_bill_type | varchar(20) | ✅ | | `trucking` / `freight` |
| match_pattern | varchar(100) | | | 费用名**包含**即命中（如 `海运费`）；优先级低于精确 `fee_type` |
| allocation_method | enum | ✅ | | `by_volume` / `by_ticket` / `fixed` / `manual` |
| default_stage | enum | ✅ | | `trucking` / `freight` / `customs` / `other` |
| priority | int | ✅ | | 同来源内越大越优先；建议 5–20 |
| is_active | boolean | ✅ | | 停用后不参与匹配 |
| remark | text | | | 业务说明 |
| created_at | timestamptz | ✅ | | |
| updated_at | timestamptz | ✅ | **新增** | 最后修改时间 |

**约束（应用层）**

- `fee_type` 与 `match_pattern` 至少填一项
- 同一 `source_bill_type` 下 `fee_type` 精确值不可重复（active 规则）
- `priority` 默认 10；异常类模式（异常/减免/多收）建议 20

**索引（已有 + 建议）**

- `(source_bill_type, is_active)`
- **新增** `(source_bill_type, fee_type)` WHERE `fee_type IS NOT NULL`

#### 表：`fob_trucking_bill_items` / `fob_freight_bill_items`（账单明细）

已有审核字段，**P4 新增**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| rule_override | boolean | ✅ | 默认 `false`；`true` 表示分摊方式被人为覆盖，重导同批次不覆盖 |
| rule_source | enum | | `auto` / `global_rule` / `manual_override` / `exception_review` |
| updated_at | timestamptz | ✅ | **新增** |

> `allocation_method`、`adjusted_amount_cny`、`assigned_merchant_code`、`is_exception`、`exception_status` 等沿用现有定义。

#### 表：`fob_settlement_adjustments`（分摊调账日志）

沿用；P4 账单行覆盖时可选写入 `bill_item_id` + `adjust_type = 'allocation_method'`。

### 2.2 种子规则变更（P3）

在 `FOB_FEE_RULE_SEEDS` 中**新增**：

```text
{ feeType: '落地寄柜费', sourceBillType: 'trucking', allocationMethod: 'by_volume', defaultStage: 'trucking', priority: 10 }
```

`fixed` 语义定义见 §4.3。

### 2.3 费用项清单（业务参考）

**拖车（森威）固定 12 列**

| fee_type | 建议 allocation_method | default_stage |
|----------|------------------------|---------------|
| 拖车费 | by_volume | trucking |
| 报关费 | by_ticket | customs |
| 堆存费 | by_volume | trucking |
| 多点提货费 | by_ticket | trucking |
| 码头费 | by_volume | trucking |
| 港杂费 | by_volume | trucking |
| 超期费 | by_volume | other |
| 超时等待费 | by_volume | trucking |
| 落地寄柜费 | by_volume | trucking |
| 压夜费 | **fixed** | other |
| 指定柜号 | **fixed** | other |
| 其他费用 | manual | other |

**货代（华贸）动态列 — 模式匹配**

| match_pattern | allocation_method | default_stage |
|---------------|-------------------|---------------|
| 海运费 | by_volume | freight |
| THC / 码头 | by_volume | freight |
| 报关 / 查验 | by_ticket | customs |
| 文件费 / VGM / 订舱 | by_ticket | freight |
| 拖车费 | by_volume | trucking |
| 异常 / 减免 / 多收 | manual | other |

未命中任何 active 规则 → 默认 `by_volume`，`default_stage` 由 `inferStage(feeType)` 推断。

### 2.4 关系（不变）

```
fob_fee_allocation_rules（全局，无 batch 外键）
fob_settlement_batches 1:N fob_trucking_bill_items
fob_settlement_batches 1:N fob_freight_bill_items
fob_settlement_batches 1:N fob_settlement_allocations
```

---

## 3. 页面流程

### 3.1 页面清单

| 页面 | 路由 | 功能 | 迭代 |
|------|------|------|------|
| FOB 分账列表 | `/logistics/fob-settlement` | 已有 | — |
| FOB 分账详情 | `/logistics/fob-settlement/:id` | 增强异常审核、账单明细 | P2/P4 |
| **费用分摊规则** | `/logistics/fob-settlement/rules` | 规则 CRUD、启用/停用 | P1 |
| 费用规则编辑抽屉 | （详情内抽屉） | 新建/编辑单条规则 | P1 |

### 3.2 P1：费用规则管理

**列表页**

- 筛选：`source_bill_type`（全部/拖车/货代）、`is_active`、`allocation_method`、关键词（fee_type / match_pattern）
- 列：费用匹配、来源账单、分摊方式、默认阶段、优先级、状态、备注、操作
- 操作：新建、编辑、停用/启用；**不可物理删除**（仅 `is_active = false`）
- 入口：FOB 分账列表页右上角「分摊规则」；详情页导入区旁链接

**新建/编辑表单**

| 表单项 | 控件 | 校验 |
|--------|------|------|
| 来源账单 | 单选 trucking / freight | 必填 |
| 匹配方式 | 精确费用名 / 模糊包含 | 二选一 |
| 费用名称 | 文本 | 精确时必填 |
| 包含关键词 | 文本 | 模糊时必填 |
| 分摊方式 | 下拉：按体积/按票/固定/人工 | 必填 |
| 默认阶段 | 下拉：拖车/货运/清关/其他 | 必填 |
| 优先级 | 数字 1–99 | 默认 10 |
| 备注 | 多行文本 | 选填 |

保存后**不影响已导入批次**的账单行；仅影响后续导入与新匹配（除非提供「对当前草稿批次重新匹配」按钮 — **本期不做**，放 backlog）。

### 3.3 P2：异常审核增强（详情页 · 异常审核 Tab）

在现有表格基础上扩展列与操作：

| 列 | 说明 |
|----|------|
| 原金额 | `amount_cny` |
| 调整后金额 | 可编辑 `adjusted_amount_cny` |
| 分摊方式 | 下拉：按体积 / 按票 / 固定 / 人工 |
| 归属主体 | 当方式为「人工」或「固定」且需指定时必填 |
| 审核备注 | `review_note` |
| 操作 | 确认 / 驳回 |

**交互**

- **确认**：`exception_status → confirmed`；写入 `allocation_method`、`adjusted_amount_cny`、`assigned_merchant_code`；`rule_source = exception_review`
- **驳回**：`exception_status → rejected`；该行不参与核算；备注必填
- 人工方式未填归属主体 → 阻止确认
- 固定方式：若柜内仅 1 个主体则自动归属；多主体时需选手动指定主体（见 §4.3）

### 3.4 P4：账单明细 · 单条覆盖（详情页 · 数据导入 Tab 下方或独立子 Tab）

**拖车账单明细 / 货代账单明细**（分页，每页 50）

| 列 | 可编辑 |
|----|--------|
| 柜号、费用项、金额、备注、当前分摊方式、是否异常 | 分摊方式 ✅（下拉） |
| | 归属主体 ✅（方式=人工/固定时） |

- 修改分摊方式 → `rule_override = true`，`rule_source = manual_override`
- 批次状态为 `confirmed` 时只读
- 已核算批次修改规则后提示「需重新执行分摊核算」

### 3.5 用户流程（端到端）

```
[规则管理 P1] 管理员维护全局规则
       ↓
[导入账单] 系统按规则写入 allocation_method / is_exception
       ↓
[P4 可选] 物流专员在明细中覆盖单条规则
       ↓
[P2] 财务处理异常行（改方式/金额/主体）→ 确认或驳回
       ↓
[分摊核算] 按体积/票/固定/人工计算
       ↓
[平账校验] 差额为 0 → 批次 confirmed
```

---

## 4. 业务逻辑

### 4.1 规则匹配（导入时 & 重新匹配单条）

与现有 `matchAllocationRule` 一致，补充优先级说明：

1. 过滤 `source_bill_type` + `is_active = true`
2. 按 `priority` 降序
3. 先精确 `fee_type === 费用名`
4. 再 `费用名.includes(match_pattern)`
5. 未命中 → `by_volume` + `inferStage`

**异常自动标记**（不变）

- `allocation_method === manual`
- 备注匹配 `/异常|减免|多收|调整|应付款/i`
- `amount_cny <= 0`
- 费用名含「异常」
- 华贸列名含「异常」→ `forceException`

异常行：`is_exception = true`，`exception_status = pending`，核算前必须处理完毕。

### 4.2 分摊计算

| allocation_method | 逻辑 | 数据依赖 |
|-------------------|------|----------|
| `by_volume` | `商家体积 / 柜内总体积 × 费用金额`；尾差归最后一户 | `fob_container_merchant_stats.volume_cbm` |
| `by_ticket` | `商家票数 / 柜内总票数 × 费用金额`；票数为 0 时**回退 by_volume** | `ticket_count`（Sku 去重，可手调） |
| `fixed` | 见 §4.3 | 柜内主体数、可选 `assigned_merchant_code` |
| `manual` | 全额计入 `assigned_merchant_code` | 异常确认或明细覆盖 |

通用：金额取 `effectiveBillAmount(amount_cny, adjusted_amount_cny)`；尾差调整 `is_tail_adjustment = true` 记在最后一行。

### 4.3 `fixed` 固定费用逻辑（P3 新增）

**定义**：整柜一次性费用，不按体积/票数比例拆分的默认口径。

**分摊顺序**

1. 若账单行已有 `assigned_merchant_code` → 100% 计入该主体
2. 若柜内仅 **1 个** 主体 → 100% 计入该主体
3. 若柜内 **多个** 主体：
   - 异常审核/明细覆盖时必须**人工指定**主体；未指定则跳过并 warning
   - 不建议自动按体积拆（与 fixed 语义冲突）

**与种子规则对齐**

- `压夜费`、`指定柜号` → `fixed`
- 核算时**不再** fallback 到 `by_volume`，不再输出「固定费用暂按体积分摊」警告（除非走规则覆盖为 by_volume）

### 4.4 异常状态机

```
pending ──确认──► confirmed（参与核算，is_exception 保持 true）
   │
   └──驳回──► rejected（不参与核算，列表可筛选已驳回）
```

- `pending` 数量 > 0 → `POST .../calculate` 返回 400
- `rejected` 行：账单总额计入「已驳回不计入」统计，平账时从 bill total 排除

### 4.5 批次状态与规则变更

| 批次 status | 可改全局规则 | 可改账单行规则 | 可改异常 |
|-------------|--------------|----------------|----------|
| draft / imported | ✅（仅影响新导入） | ✅ | ✅ |
| reviewed | ✅ | ✅ | ✅ |
| calculated | ✅ | ✅（需重算） | ✅ |
| confirmed | ✅ | ❌ 只读 | ❌ 只读 |

### 4.6 API 清单（新增/扩展）

| 方法 | 路径 | 说明 | 迭代 |
|------|------|------|------|
| GET | `/api/logistics/fob-fee-rules` | 规则列表（分页+筛选） | P1 |
| POST | `/api/logistics/fob-fee-rules` | 新建规则 | P1 |
| PATCH | `/api/logistics/fob-fee-rules/:id` | 更新规则 | P1 |
| PATCH | `/api/logistics/fob-fee-rules/:id/toggle` | 启用/停用 | P1 |
| PATCH | `/api/logistics/fob-settlements/:id/exceptions/:itemId` | **扩展** body：`allocationMethod`、`adjustedAmountCny` | P2 |
| PATCH | `/api/logistics/fob-settlements/:id/trucking-items/:itemId` | 单条覆盖分摊方式 | P4 |
| PATCH | `/api/logistics/fob-settlements/:id/freight-items/:itemId` | 单条覆盖分摊方式 | P4 |

权限：规则 API 需 `admin` 或菜单写权限 + 规则管理 flag。

---

## 5. 集成与非功能

### 5.1 妙搭兼容

- 无本地磁盘；规则存 PostgreSQL
- 单次规则列表查询 < 300ms；账单明细分页
- ZIP 迁移含 `packages/db/schema` + `drizzle/*.sql`（`updated_at`、账单行新字段迁移）

### 5.2 审计

- 规则变更：`updated_at` + 操作人（可选二期 `fob_rule_change_log` 表）
- 异常确认：已有 `reviewed_by`、`reviewed_at`
- 账单行覆盖：写入 `fob_settlement_adjustments`（`adjust_type` 扩展枚举值 `allocation_method`）

### 5.3 测试要点

| 场景 | 预期 |
|------|------|
| 新建规则「落地寄柜费 → by_volume」 | 导入森威后该行匹配正确 |
| 压夜费 fixed、单主体柜 | 100% 计入该主体 |
| 压夜费 fixed、多主体未指定 | 核算 warning，跳过 |
| 异常确认改为 by_ticket | 按票分摊，平账 diff=0 |
| 驳回异常行 | 不参与核算，pending 清零后可算 |
| 明细覆盖为 manual + 主体 | `rule_override=true`，重导不覆盖该行 |
| 全局规则停用 | 新导入走默认 by_volume |

---

## 6. 验收标准（按迭代）

### P1 费用规则管理

- [ ] 规则列表 CRUD、筛选、停用
- [ ] 精确/模糊匹配校验与重复校验
- [ ] 新导入账单按新规则匹配

### P2 异常审核增强

- [ ] 异常行可改分摊方式、调整金额、备注
- [ ] 支持驳回；pending 清零后可核算
- [ ] 人工方式未指定主体时阻止确认

### P3 fixed + 种子补齐

- [ ] `落地寄柜费` 种子规则入库
- [ ] `fixed` 按 §4.3 实现，压夜费/指定柜号不再按体积
- [ ] 单元测试覆盖 fixed 单主体/多主体/已指定主体

### P4 单条费用覆盖

- [ ] 拖车/货代明细可改分摊方式
- [ ] `rule_override` 防止重导覆盖
- [ ] confirmed 批次只读

---

## 7. Backlog（本期不做）

- 对已有批次「一键重新匹配全局规则」
- 规则变更历史表 `fob_rule_change_log`
- 按重量分摊 `by_weight`
- 费用规则 Excel 批量导入
- 飞书审批流对接异常确认

---

## 8. 质量检查

- [x] 每张表有主键和 `created_at`
- [x] 外键关系明确
- [x] 每个页面标注 CRUD 操作
- [x] 异常状态流转完整（pending / confirmed / rejected）
- [x] 分摊四种方式均有计算规则与验收用例
- [x] 字段名 snake_case，枚举小写
