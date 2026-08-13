# 产品成本核算工具设计

**日期**：2026-08-13  
**状态**：已评审（对话拍板）  
**取代**：`docs/superpowers/specs/2026-08-07-product-costing-bom-design.md`（M1 拆清单；本 spec 含工具交互 + 价目 + 核算 + 防超时）  
**基线代码**：`feature/product-costing-bom-m1` 合入当前 `main` 后扩展，不从零重写预处理/Dify 调用。  
**样本输入**：`d:\我的文档\bom测试\` 下 6 份打样 PPT（非 BOM）；仓库内参考 `docs/samples/采购/`。

## 1. 背景与目标

采购侧「产品成本核算」菜单在库中已有，当前 `main` 无对应路由，打开为 404。

要做一个**单页工具**（对照飞书秒搭交互，视觉走 scm-agent），而不是核算单列表 → 详情的重流程：

1. 配置共用原材料价目  
2. 上传设计方案 PPT（非标准 BOM）  
3. 解析为分组材料清单（明示项 + 品类模板推断项）  
4. 清单 × 价目算出材料成本，看板展示构成  

### 用户故事

- 作为采购员，我希望在一张工作台上配好价目、上传打样 PPT、看到分组清单和总成本，以便快速估新产品材料成本。  
- 作为采购员，我希望本单能改单价且不影响共用价目，以便处理临时报价。  
- 作为采购员，我希望大 PPT 不会整单超时丢失，以便失败批次可重试。

## 2. 已拍板决策

| 项 | 选择 |
|----|------|
| 落地 | scm-agent 采购模块单页工具，路径 `/procurement/costing` |
| 视觉 | scm-design（活力橙、Card），不复刻秒搭皮肤 |
| 拆清单 | 明示项（图/字）+ 品类模板补结构件；人审改行即生效 |
| 价目 | 共用 `material_price_book`；本单可改单价 |
| 成本范围 | **只算材料**；不含人工、运费、制造费用 |
| 与现有 `bom` 表 | **不读写** |
| 成品 SKU | `sku_id` 可选，本期工具页可不展示绑定 |
| 确认闸门 | **不做**「确认清单」；有行即可看成本 |
| Dify | 不传整份 PPT；筛页 + 压缩页图 + 每批 1 页 + 异步分批 |
| 附件 | 本地 Docker 卷 `COSTING_DATA_DIR` |

## 3. 非范围

- 正式 PO / MRP / 飞书同步 / 审批流  
- 回写 `skus.unit_cost`  
- 人工、运费、包装以外的费用科目（包装材料本身算材料）  
- 价目同义词库、二次 LLM 汇总校对（可留后续）  
- 免人工补全模糊尺寸  

## 4. 页面与信息架构

单路由 `/procurement/costing`，菜单码 `procurement.costing`，名称「产品成本核算」，挂在采购管理下（sort_order=3）。角色：`super_admin`、`purchaser` 可写；`viewer` 若授菜单则只读。

```
顶栏：当前产品下拉（最近 N 条）+ 新建 + 上传 PPT + 解析进度
① 原材料价目（共用，默认可折叠）
② 材料清单（本产品，按大类分组，可增删改）
③ 成本看板（总成本、构成饼图、分类汇总、缺价/缺用量提示）
```

后台仍持久化「产品」（原 `costing_projects`），刷新、切换不丢数据。无独立列表页。

顶栏「当前产品」：API 返回按 `updated_at` 倒序最近 20 条；浏览器记住上次选中的 id（localStorage）。无记录时展示空态，引导新建 + 上传。

## 5. 输入文档与拆解

### 5.1 文档形态（已用测试夹验证）

打样/设计方案 PPT，典型页：封面、产品方案（效果图、几乎无字）、设计说明、爆炸图、产品尺寸、CMF、偶发「物料清单」页（仅配件名）。

文字可直接得到：品名、外形 W×D×H（数字常被拆开，如 `D 4 00` = 400）、基材（密度板/颗粒板/中纤板/实木）、部分厚度、点名五金。  
柜体开料块数与尺寸主要在图上，必须多模态；不能当表格解析 BOM。

允许上传：`.pptx`、`.pdf`。单文件上限 **80MB**、**20 页**（页数按预处理结果计）。超限返回 400，文案说明可拆文件或指定页范围。

### 5.2 流水线

```
上传 → 本地存储 + costing_attachments(source)
     → 预处理：每页 text + 压缩页图
     → 规则标页类型（不调用 Dify）
     → 筛选待送页
     → 异步 extract run：每批 1 页调 Dify
     → 校验 JSON → 合并行 → 套品类模板补缺件
     → 匹配价目 → 写入 costing_bom_lines
     → 工具页分组展示；看板现算
```

### 5.3 页类型（规则，按页文本）

| 类型 | 判定（任一命中，先匹配先得） |
|------|------------------------------|
| `bom_list` | 含「物料清单」或 `BILL OF MATERIALS` |
| `cmf` | 含 `CMF` 或「材质选择」 |
| `size` | 含「产品尺寸」或 `PRODUCT SIZE` 或 `/W\s*\d/` 外形 |
| `explosion` | 含「爆炸图」或 `EXPLOSION` 或 `DISASSEMBLY` |
| `notes` | 含「设计说明」或「产品细节」或 `DESIGN NOTES` |
| `cover` | 第 1 页，或仅品名/部门 |
| `render` | 含「产品方案」且无材料关键词，或文字少于 40 字 |

材料关键词：板、密度板、颗粒板、实木、五金、滑轨、拉手、封边、mm、插排、防倾倒 等（实现时集中常量）。

### 5.4 送 Dify 的页

- **必送（有图+文）**：`notes`、`explosion`、`size`、`cmf`、`bom_list`  
- **不送图**：`cover`、`render`（纯效果图）  
- **例外**：`render`/`cover` 文本命中材料关键词 → 当 `notes` 送  

默认 `COSTING_EXTRACT_BATCH_SIZE=1`（每批 1 页）。可用环境变量改为 2。批间顺序执行。

**分批落库（避免超时丢进度）**

- 无页范围的整单重拆：第一批**成功之后**才删除旧的非手工行；第一批失败则原清单不动。  
- 每一批成功：立即把该批 lines 写入（按 `source_ref` 页码替换这些页上的非手工行）。  
- 某一批失败：run=`failed`，`error_message` 含页码；已成功批的行留在库里；状态 `extract_failed`。  
- 重试：`POST extract` 带 `pageFrom`/`pageTo` 只跑失败页，不删其他页的行。

### 5.5 页图压缩（防超时）

- 最长边 ≤ **1280px**  
- JPEG（或 PNG 转 JPEG），目标单页 **&lt; 400KB**；仍超则降质量到 0.6  
- 1×1 占位图不送 `image_base64`（空字符串）  
- **禁止**把 PPT/PDF 二进制传给 Dify  

超时：

- scm-agent：`DIFY_WORKFLOW_TIMEOUT_MS` 默认 **300000**  
- 文档要求 Dify 应用/工作流超时 **≥ 300s**（仅加长 HTTP 不够）  
- 前端轮询 extract run：展示「第 i / n 批」（n = 筛选后页数）  

### 5.6 Dify 输入输出

Env：`DIFY_API_KEY_COSTING_BOM`。复用 `runWorkflow`。

**inputs**

- `category`：品类提示（斗柜 / 床头柜 / 书桌 / 梳妆台 / 其他）  
- `pages_json`：`[{ page, page_type, text, image_base64 }]`  

**outputs**：`lines` 数组，单行：

```json
{
  "category": "板材",
  "material_name": "密度板",
  "spec": "15mm 桌面板",
  "unit": "块",
  "qty_net": 1,
  "loss_rate": 0.08,
  "source_ref": "p5",
  "confidence": "medium",
  "origin": "explicit",
  "notes": ""
}
```

`category` 只允许：`板材` / `五金` / `表面工艺` / `包装` / `其他`。  
`confidence` 只允许：`high` / `medium` / `low`。  
`origin` 只允许：`explicit` / `template`。模型漏标时：有 `source_ref` 视为 `explicit`，否则 `template`。  
`qty_gross` 由服务端计算，忽略模型返回。非法 JSON 或无有效行 → 该批失败。

更新已有 Workflow DSL（分支上 `docs/dify/workflows/product-costing-bom-extract.yml`）：提示词增加页类型、禁止编造未出现的五金、结构件可按模板填并标 `origin=template`。

### 5.7 品类模板（服务端，代码常量，不建表）

解析完成后，按产品 `category` 检查必有结构件是否已在 AI 行中（按材料名模糊包含，如「侧板」）。缺失则插入 `origin=template`、`confidence=low`、`qty_net=0`、`notes=用量待补` 的行，供人补。

| 品类 | 必有结构件（板材） |
|------|-------------------|
| 斗柜 / 床头柜 | 侧板、顶底板、背板、抽面、抽侧、抽底 |
| 书桌 | 桌面、侧板、抽盒 |
| 梳妆台 | 台面、侧板、抽盒 |
| 其他 / 空 | 不补模板行 |

**不**用模板生成五金。外形尺寸若从 `size` 页规则解析出 W/D/H，写入项目备注或第一条 notes，供人参考，本期不做自动开料公式（避免错算）。

### 5.8 人审

改行、增行、删行立即保存；看板按最新行现算。  
`low`、未匹配、`qty_net=0` 高亮，**不拦截**查看成本。

整单重拆：删除 `is_manual=false` 的 AI/模板行，保留手工行，再写入新 AI+模板行。

## 6. 价目匹配与计算

### 6.1 匹配（服务端函数，解析落库与每次读清单时对无 override 的行重算匹配）

1. `is_active` 价目中，`material_name + spec + unit` 全等（去空白、大小写不敏感）→ `exact`，记下 `price_book_id`  
2. 否则同 `material_name + unit` 且仅一条候选 → `name_only`  
3. 同名同单位多条 → `unmatched`，notes 提示「规格待确认」  
4. 否则 `unmatched`，`price_book_id` 空  

本单 `unit_price_override` 非空时仍保留匹配结果，金额用 override。

### 6.2 计算（人民币，只算材料）

```
qty_gross = round(qty_net * (1 + loss_rate), 4)
effective_unit_price = override ?? price_book.unit_price    // 无则 null
line_amount = qty_gross * effective_unit_price             // 无单价或 qty 视为 0
category_subtotal = Σ line_amount
total = Σ line_amount
share = amount / total                                     // total=0 则 0
```

缺价：`effective_unit_price == null`  
缺用量：`qty_net == 0`  
看板同时返回 `missing_price_count`、`missing_qty_count`。

价目变更后，无 override 的行下次 GET 按新价重算（现算，不另做成本快照表）。

### 6.3 价目维护

工具页①：表格 CRUD。唯一键 `(material_name, spec, unit)`，`spec` 空串与空视为同一键。  
xlsx 导入价目：列 **大类、材料名称、规格、单位、单价、备注**；全量覆盖或按键 upsert（实现选 **upsert**，不删未出现的行）。停用走「停用」而不是导入删除。

## 7. 数据模型

沿用 M1 四表，扩展字段；新增价目表。实现时若 M1 的 `0069_product_costing` 从未在目标库执行，则合并为一份新迁移（当前 main 下一号，预期 `0075_product_costing_tool.sql`）；若某环境已跑过 `0069`，则另写增量迁移加列/加表，**禁止改已执行的 0069 文件**。菜单 INSERT 必须 `WHERE NOT EXISTS`。

### 7.1 `costing_projects`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| project_no | varchar(32) unique | `CST-YYYYMMDD-XXXX` |
| name | varchar(200) | 产品名 |
| category | varchar(100) | 斗柜 / 床头柜 / 书桌 / 梳妆台 / 其他 |
| sku_id | uuid? FK skus | 可选，工具页可不展示 |
| status | enum | `draft` / `extracting` / `ready` / `extract_failed` |
| extract_error | text? | |
| created_by | uuid? | |
| created_at / updated_at | timestamptz | |

**不再使用** `bom_ready`、`costed`、`confirmed_bom_at`。若从旧 M1 库升级：`bom_draft`/`bom_ready`/`costed` → `ready`。

### 7.2 `costing_attachments` / `costing_extract_runs`

与 M1 相同。`extract_runs` 增加可选 `batch_index`、`batch_total`（int），便于进度；若不想改表，进度可由页数与 BATCH_SIZE 在 API 中推算（**采用推算，不改 run 表**）。失败时 `error_message` 含页码。

### 7.3 `costing_bom_lines`

M1 字段保留，新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| origin | varchar(20) | `explicit` / `template`，默认 `explicit` |
| price_book_id | uuid? FK | ON DELETE SET NULL |
| unit_price_override | numeric(14,4)? | |
| match_status | varchar(20) | `exact` / `name_only` / `unmatched`，默认 `unmatched` |

`qty_gross` 仅后端写。`is_manual=true`：人增或人改过的行；重拆时保留。

### 7.4 `material_price_book`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| category | varchar(50) | 同清单大类 |
| material_name | varchar(200) | |
| spec | varchar(500) | 默认 `''` |
| unit | varchar(20) | |
| unit_price | numeric(14,4) | ≥ 0 |
| notes | text? | |
| is_active | boolean | 默认 true |
| created_at / updated_at | timestamptz | |

唯一索引：`(lower(material_name), lower(spec), lower(unit))`。  
索引：`(is_active, category)`。

## 8. API

前缀 `/api/procurement/costing`，登录态；写操作需可写角色。

### 8.1 价目

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/price-book` | 列表，query：`q`、`category`、`activeOnly` |
| POST | `/price-book` | 新增 |
| PATCH | `/price-book/:id` | 改 |
| POST | `/price-book/:id/disable` | 停用 |
| POST | `/price-book/import` | multipart xlsx upsert |

### 8.2 产品与解析

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects` | 最近 20 条：id、name、status、updatedAt |
| POST | `/projects` | `{ name, category? }` |
| GET | `/projects/:id` | 详情 + 清单行（含现算金额）+ 看板汇总 |
| PATCH | `/projects/:id` | name/category |
| DELETE | `/projects/:id` | 删库 + 本地目录 |
| POST | `/projects/:id/attachments` | `file`；pptx/pdf |
| GET | `/projects/:id/pages/:pageNo` | 页图（鉴权） |
| POST | `/projects/:id/extract` | `{ pageFrom?, pageTo? }` → `{ runId }` 异步 |
| GET | `/projects/:id/extract/runs/:runId` | 状态；含 `batchCurrent`/`batchTotal` 推算 |

### 8.3 清单与导出

| 方法 | 路径 | 说明 |
|------|------|------|
| PUT | `/projects/:id/bom-lines` | 批量保存校对 |
| POST | `/projects/:id/bom-lines` | 增一行 |
| PATCH | `/projects/:id/bom-lines/:lineId` | 改一行（改价、用量等） |
| DELETE | `/projects/:id/bom-lines/:lineId` | 删一行 |
| GET | `/projects/:id/export` | xlsx：Sheet「材料清单」+「成本汇总」 |

GET 详情中的看板字段：`totalAmount`、`byCategory[{ category, amount, share }]`、`missingPriceCount`、`missingQtyCount`。不单独再做一个 dashboard 端点。

未配置 Dify key：`POST extract` 返回 **503**，文案说明可手工维护清单。预处理失败：run failed，不调 Dify。

## 9. 前端

- 新页 `ProductCostingToolPage.tsx`（可拆子组件：价目表、清单分组、看板），路由仅此页。  
- 解析中：`AiProgressBar` + 批次数。失败：`AiBanner`，提供重试。  
- 清单按 `category` 分组；列：名称、规格、单位、净用量、损耗、毛用量（只读）、匹配状态、生效单价、金额、来源、置信度。  
- 数字列 `font-mono`。每区仅一个实心主按钮（顶栏「解析」或价目「保存」分区处理：顶栏解析为页面主按钮，价目用 outline「新增/导入」）。  
- 饼图：大类金额占比（现有图表库若无则用简单 CSS/SVG 环图，不新加重依赖；若项目已有 chart 库则用现成的）。  

## 10. 验收

1. 无路由 404：超级管理员打开「产品成本核算」进入工具页。  
2. 价目可增改停用；xlsx 导入 upsert；同名规格单位不可重复。  
3. 上传测试夹任一份 PPT（如六抽菱形斗柜），预处理出页；筛选后送 Dify 的页不含纯效果图。  
4. 配置 Dify 后解析进入 `extracting`，完成后 `ready` 且有分组行；未匹配/low/qty=0 有标记。  
5. 改本单单价只影响该产品；改价目后无 override 行金额变化。  
6. 看板总成本 = 各行金额之和；导出两 sheet。  
7. 未配 Dify 时 extract 503，手工行 + 价目 + 看板仍可用。  
8. 模拟单批超时：run 失败文案含页码，原清单不被空覆盖。  

## 11. 风险

| 风险 | 缓解 |
|------|------|
| Dify / 模型超时 | 筛页、压图、每批 1 页、300s、失败不覆盖、可重试 |
| 模型编造五金或开料 | 模板只补结构件空行；五金必须明示；人审 |
| 生产库已有 M1 菜单/表 | 迁移幂等；status 枚举升级脚本 |
| LibreOffice 缺失 | 沿用 M1：PPTX 抽文本 + 占位图，至少送文字页 |

## 12. 实现顺序（计划阶段再拆任务）

1. 将 `feature/product-costing-bom-m1` 变基到当前 main，修正迁移号与 status 枚举。  
2. 价目表 + API + 工具页价目区。  
3. 工具页产品切换/上传/清单/看板现算（可先手工清单闭环）。  
4. 筛页、压图、batch=1、进度与失败不覆盖。  
5. 模板补行、匹配、导出、Dify DSL 与文档。  
6. 用 `bom测试` 六份 PPT 做手工验收。
