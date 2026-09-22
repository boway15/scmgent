# 产品成本核算：未匹配行人工绑定价目

**日期**：2026-08-20  
**状态**：已评审  
**基线**：`2026-08-19-costing-facts-confirm-calc-design.md`、`2026-08-20-costing-short-mid-term-design.md`  
**范围**：第二步物料确认 / 第三步计价宽表中，对 `unmatched` 与 `name_only` 行提供关键词搜索并选择成本库价目；选中后同步标准名称/规格/单位并绑库价。  
**不改**：手填价写回共用价目、价目维护页整体改版、自动匹配算法重写。

## 1. 背景与问题

自动匹配依赖 BOM 行上的 `materialName + spec + unit` 与价目切片完全一致（或板材走厚度/基材规则）。PPT / 模型提取的名称常为设计标注用语（如「抽面滑轨规格标签」），与价目标准名（如「抽屉滑轨」）不一致，导致 **未匹配**，采购只能填 **本单补价**，无法显式选用库里已有条目。

价目维护 API 已支持 `GET /procurement/costing/price-book?q=` 关键词检索，但 BOM 行 UI 未提供「搜索 → 选择 → 绑定」路径。

## 2. 用户故事

- 作为采购员，我希望对未匹配行用关键词搜索成本库并选择正确条目，以便使用库价而不是每次本单补价。
- 作为采购员，我希望选中后行上显示价目标准名称与规格，但仍能看到 AI/设计当初提取的原值，以便对账。
- 作为采购员，我希望绑定后若再改名称/规格，系统自动解除绑定，以免 silently 用错价。

## 3. 拍板结论

| 项 | 决策 |
|----|------|
| 选中后字段 | **B：绑价并改成价目标准名**（`category`、`materialName`、`spec`、`unit`） |
| 原提取值 | 保留 `extractSnapshot` 不变；行下仍显示 `extractDiff` 对照 |
| 交互形态 | **行内 Popover**（匹配状态列「选择价目」） |
| 适用行 | `matchStatus` 为 `unmatched` 或 `name_only` |
| 库价 vs 本单补价 | 绑定成功后 **清空** `unitPriceOverride`，使用库价 |
| 写回价目 | **禁止** |

## 4. 页面流程

仍在同一核算页第二步 / 第三步 BOM 宽表，不新增路由。

```
未匹配 / 名称匹配 行
  → 点击「选择价目」
  → Popover 内输入关键词（默认预填当前 materialName）
  → 列表展示候选（名称、规格、单位、单价、切片范围）
  → 点选一条
  → 行刷新：标准名 + 精确匹配 + 库价；原提取值仍可见
  → 若 qty_net ≤ 0，仍须补用量后才能计算
```

### 4.1 Popover 搜索

- **默认关键词**：当前行 `materialName`（去空白）。
- **搜索 API**：复用 `GET /procurement/costing/price-book`，参数：
  - `q`：用户输入
  - `category`：当前行 `category`（可选过滤，减少噪音）
  - `regionId` / `factoryId`：来自当前核算项目
  - `activeOnly=true`
- **计价日**：绑定 endpoint 服务端按项目 `price_as_of` 校验候选价目在该日有效；列表 API 第一期可仍返回全部 active 行，绑定瞬间做生效日校验（无效则 400）。
- **展示列**：材料名称、规格、单位、单价、区域/工厂标签（全局/区域/工厂）。
- **空结果**：提示「无匹配价目，可本单补价或到价目维护新增」。

### 4.2 绑定后行展示

- 匹配状态 → **精确匹配**（显式选中价目行，视为 exact）。
- 匹配范围 → 按价目所在切片写入 `matchScope`（factory / region / global）。
- 生效单价 → 库价（除非用户之后再填 override）。
- 来源标签 → **库价** + **人工修改**（`isManual=true`）。
- 名称列下方 → 若有 `extractSnapshot`，继续显示「提取：…」diff 文案。

### 4.3 解除绑定

沿用现网 PATCH 行逻辑：用户手改 `materialName` / `spec` / `unit` / `substrate` 时，`priceBookId` 置空、`matchStatus` → `unmatched`。Popover 不提供单独「解绑」按钮（第一期）。

## 5. API

### 5.1 新增

`POST /api/procurement/costing/projects/:projectId/bom-lines/:lineId/bind-price-book`

**Body**

```json
{ "priceBookId": "uuid" }
```

**服务端步骤**

1. 加载项目（`regionId`、`factoryId`、`priceAsOf`）与 BOM 行。
2. 加载价目行；校验 `isActive`、切片与项目一致（或 global 通用）、`effective_from/to` 覆盖 `priceAsOf`。
3. 更新 BOM 行：
   - `category` ← 价目.category
   - `materialName` ← 价目.materialName
   - `spec` ← 价目.spec
   - `unit` ← 价目.unit
   - `priceBookId` ← 价目.id
   - `matchStatus` ← `'exact'`
   - `matchScope` ← 由切片解析（与现 `match-price` 一致）
   - `unitPriceOverride` ← `null`
   - `isManual` ← `true`
   - `origin` 保持 `'explicit'`（或不变）
   - **不修改** `extractSnapshot`、`qtyNet`、`lossRate`、`substrate`（板材基材仍由行上字段决定）
4. 清空项目 `cost_computed_at`、`cost_summary`（与现 PATCH 行一致）。
5. 返回更新后的项目详情片段或单行（与现 PATCH 响应形状一致即可）。

**错误**

| 状态 | 场景 |
|------|------|
| 400 | 价目不存在、已停用、计价日无效、切片与项目不匹配 |
| 404 | 项目或行不存在 |
| 409 | 行只读 / 项目状态不允许编辑（与现 PATCH 一致） |

### 5.2 复用

- `GET /procurement/costing/price-book?q=&category=&regionId=&factoryId=&activeOnly=true` — Popover 搜索，无需改契约。

### 5.3 前端 API 封装

`api.bindCostingBomLinePriceBook(projectId, lineId, { priceBookId })`

## 6. 业务规则

### 6.1 与自动重匹配的关系

`calculateCostingLines` 每次 GET 仍会按行上名称重算匹配。绑定后名称/规格/单位已与价目一致，重算结果应稳定为 **exact**，无需新增「锁定 priceBookId」字段。

### 6.2 板材行

绑定价目后同步价目上的 `materialName`、`spec`（厚度）、`unit`。`substrate` **不**从价目写入（价目无基材列）；板材单价仍走现有 m² 换算。若绑后基材与价目定价名不一致，用户需自行调整基材下拉，调整后触发解除绑定（`substrate` 属于 material 字段变更）。

### 6.3 用量与计算闸门

绑定 **不** 自动填 `qtyNet`。`qty_net ≤ 0` 时「计算成本」仍 block；异常队列 `missing_qty` 不变。

### 6.4 权限

与 BOM 行 PATCH 相同：`menuGuard` + `requireWrite()`。

## 7. 前端组件

| 位置 | 改动 |
|------|------|
| `BomLinesPanel.tsx` | 匹配状态列：`unmatched` / `name_only` 且非 readOnly 时显示「选择价目」链接；挂载 `PriceBookBindPopover` |
| 新组件 `PriceBookBindPopover.tsx` | Input 防抖搜索 + 结果列表 + 选中调用 bind API；invalidate `costing-project` query |
| `api.ts` | 新增 bind 方法 |

样式：Popover 遵循 scm-design（白底卡片、主色 `#FF5000` 选中高亮、14px 正文）。

## 8. 非范围

- 绑价后一键「加入成本库」（仍不做）
- 弹窗版大表选择器
- 仅绑 `priceBookId` 不改名称（方案 A）
- 修改 `match-price.ts` 模糊匹配逻辑
- 批量绑价

## 9. 验收

1. 行「抽面滑轨规格标签 / 2节12寸滚珠滑轨 / 未匹配」→ 搜「滑轨」→ 选「抽屉滑轨 / 2节12寸…」→ 行变为精确匹配，单价为库价，`extractDiff` 仍显示原提取名。
2. `name_only` 行（多规格待确认）可通过 Popover 改选正确规格条目 → exact。
3. 绑定后清空已有 `unitPriceOverride`。
4. 绑定后改 `materialName` → 回到未匹配，`priceBookId` 空。
5. 绑定不改变 `qtyNet`；用量为 0 时计算仍禁用。
6. 绑定后改区域/工厂/计价日导致价目失效时，下次 GET 重匹配可能 unmatched（现网行为）；不单独拦截。
7. 无写权限用户看不到「选择价目」。

## 10. 测试建议

- **服务端**：bind endpoint  happy path；无效 priceBookId；计价日外价目；切片不匹配；清空 override；清快照。
- **前端**：Popover 搜索 debounce；选中后表格刷新；readOnly 隐藏入口。
- **集成**：与 `listReviewIssues` — 绑定后 `unmatched` warn 消失（若已有库价且无 missing_qty）。
