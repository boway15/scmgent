# 产品成本核算：中短期优化方案

**日期**：2026-08-20  
**状态**：待评审  
**基线**：`2026-08-19-costing-facts-confirm-calc-design.md`、`2026-08-19-board-panel-cost-sheet-design.md`  
**对照**：ChatGPT《AI家具成本拆解 Agent 产品需求方案 V1.0》（吸收异常优先审核、来源追溯、成本版本；不吸收 Dify 总编排 / 四套成本表 / 模型改开料公式）

## 1. 需求分析

### 背景

现网已能：上传 PPT/PDF → 确认结构 → 确认物料 → 齐套后计算并快照。采购仍要在第二步扫全表才能发现缺价/模板行；来源只有「明示/模板」两字；价目无历史版本；包装公式全国一套。

### 用户角色

| 角色 | 权限 | 典型操作 |
|------|------|----------|
| 采购员 | 读写核算 | 处理异常队列、确认来源、本单补价、计算 |
| 超级管理员 | 全部 | 维护价目生效区间、工厂包装档案 |

### 用户故事

- 作为采购员，我希望第三步先看到必须处理的异常，以便不必把整张 BOM 当审核对象。
- 作为采购员，我希望每一行能看出是设计明示、规则开料、模板补全、库价还是人工改过，以便对账和追责。
- 作为采购员，我希望也能上传效果图/尺寸图 JPG/PNG，以便没有 PPT 时仍能进同一流水线。
- 作为采购员，我希望改过名称/用量后仍能看到 AI/规则当初写入的值，以便判断是识别错还是业务改。
- 作为采购员，我希望按「计价日」匹配当时有效的价目，以便复盘历史核算不被新价覆盖。
- 作为采购员，我希望某工厂包装余量/单价与默认公式不同时，选该工厂即可套用，而不改全国默认。

### 阶段划分

| 阶段 | 窗口 | 范围 | 成功标准 |
|------|------|------|----------|
| **S 近期** | 1 个迭代（约 1–2 周） | 异常队列、来源标签、图片入口 | 第三步能按类处理异常；行上来源可读；jpg/png 可预处理为单页 |
| **M 中期** | 随后 1–2 个迭代 | AI/规则原值、价目生效日、工厂包装档案 | 人改不丢原值；计算按计价日匹配；工厂可覆盖包装公式 |

不把准确率 SLA、供应商维、CNC 工艺库、Dify 查价编进任一阶段。

### 规则族与品类映射（已实现）

开料公式按 **规则族**（`chest` / `desk` / `vanity` / `none`）维护；品类只是映射。目录：`COSTING_CATEGORY_CATALOG`（`category-rules.ts`）。

| 规则族 | 当前品类 | 行为 |
|--------|----------|------|
| chest | 斗柜、床头柜 | 柜体开料（落地拉条等） |
| desk | 书桌、桌子 | 桌面/侧板/横撑槽位，不开柜体公式 |
| vanity | 梳妆台 | 台面/抽盒槽位 |
| none | 床、椅子、其他 | 不补结构件、不套柜体开料 |

加新品类：在目录增加一行 `label + familyId + detect`。新几何（床排骨架）要新增规则族和 cut 模块，不要硬编码品类名。

## 2. 数据模型

### 不改的表/原则

- `costing_projects` 状态枚举仍为 `draft` / `extracting` / `ready` / `extract_failed`
- 开料公式仍在 `category-rules` / `carcass-cut-rules`
- 手填单价只写 `unit_price_override`，禁止写回 `material_price_book`
- 不拆材料/五金/加工/包装四套价目表

### S：无强制新表

异常队列与来源标签由现有字段 **派生**：

| 已有字段 | 用于 |
|----------|------|
| `match_status`、`unit_price_override`、`qty_net` | 缺价/缺用量 |
| `origin`、`is_manual`、`notes` | 模板未审、人工改 |
| `confidence` | 低置信 |
| `computeBlockers`（GET 已返回） | 计算闸门；S 扩展为更宽的 `reviewIssues` |

可选：`costing_bom_lines.source_kind` varchar(32)——若派生规则在前后端重复超过一处，S 允许加列由服务端写入，避免 UI 各写一套。优先纯函数 `classifyLineProvenance(line)` 前后端共享（放 `apps/web/server` + 前端 import 同源或复制常量映射表一份）。

### M：增量字段

#### `costing_bom_lines`

| 字段 | 类型 | 说明 |
|------|------|------|
| extract_snapshot | jsonb | 首次由 AI/规则写入时的 `{ materialName, spec, qtyNet, origin, sourceRef }`；之后人改行不更新此列；重拆非手工行时按新提取覆盖 |

#### `costing_projects`

| 字段 | 类型 | 说明 |
|------|------|------|
| price_as_of | date | 计价日，默认今天；改之使成本快照失效 |

#### `material_price_book`

| 字段 | 类型 | 说明 |
|------|------|------|
| effective_from | date | 默认 `2000-01-01`（存量视为一直有效） |
| effective_to | date null | 空=仍有效；匹配条件 `effective_from <= price_as_of AND (effective_to IS NULL OR effective_to > price_as_of)` |

同一切片（区域+工厂+名称+规格+单位）允许时间上不重叠的多行。匹配多条时取 `effective_from` 最大者。禁止插入与已有行日期相交的重复键（服务端校验，不必上 Postgres EXCLUDE 第一期）。

#### `costing_factories`（或独立表 `costing_factory_pack_profiles`）

| 字段 | 类型 | 说明 |
|------|------|------|
| pack_profile | jsonb null | 空=用全国默认公式。有值则覆盖对应键 |

`pack_profile` 形状：

```json
{
  "cornerAllowanceMm": 80,
  "foamThicknessMm": 20,
  "foamYuanPerM3": 280,
  "cartonYuanPerM2": 4.9,
  "cornerYuanEach": 0.5
}
```

未出现的键用默认。M 第一期 **不加** 珍珠棉/隔板等新材料行；只覆盖现有护角/保利龙/纸箱公式参数。

## 3. 页面流程

仍为同一核算页三步，不新增路由。

```
① 结构确认（可上传 PPT/PDF/图片）
  → ② 物料确认（行上来源标签）
  → ③ 计价：异常队列（上）+ 区域/工厂/计价日 + 计算 + 板材宽表/看板（下）
```

### S：第三步异常队列

GET 详情增加 `reviewIssues[]`，每条：`lineId?`、`materialName`、`code`、`severity`（`block` | `warn`）、`message`。

| code | severity | 含义 | 处理 |
|------|----------|------|------|
| missing_price | block | 计入成本的行无库价且无本单补价 | 回第二步补价或改名匹配 |
| missing_qty | block | 计入成本且 qty_net≤0 | 补用量或删行 |
| missing_thickness | block | 现网 compute 已有的板厚闸门 | 补厚度 |
| unmatched | warn | 未匹配但仍可能有 override | 确认本单价或改规格 |
| template_pending | warn | origin=template 且未 is_manual | 点「已核对」或改行（改行使 is_manual） |
| low_confidence | warn | confidence=low | 核对尺寸/名称 |
| inferred_cut | warn | 规则开料（origin=template 且 notes/名称属结构件） | 核对开料 |

`block` 条数 > 0 时「计算成本」仍禁用（与现网闸门一致，集合为 `listComputeBlockers` 的超集中的 block 子集）。  
点击异常行：切到第二步并滚动/高亮对应 `lineId`（无 lineId 则只切步）。

「已核对」：S 用 PATCH 行 `is_manual=true`（或 notes 追加「已核对」）。不新增审批流。

### S：来源标签（展示用，可多枚）

一行可同时有：`设计明示` / `规则开料` / `模板补全` / `库价` / `本单补价` / `人工修改`。  
映射：

- `origin=explicit` 且非 template 结构件 → 设计明示  
- `origin=template` 且板材结构件 → 规则开料  
- `origin=template` 且五金/包装 → 模板补全  
- `match_status` 为 exact/name_only → 库价（旁注 matchScope）  
- `unit_price_override` 非空 → 本单补价  
- `is_manual` → 人工修改  

第二步来源列由单字「明示/模板」改为上述标签（Pill）。第三步宽表不强制重复，异常队列文案带标签即可。

### S：图片入口

`assertCostingSourceAttachment` 增加 `.jpg` `.jpeg` `.png` `.webp`。预处理：当作 1 页 `page_image` + 空/文件名文本，再走现有页类型与 Dify 分批（单页）。单文件仍 80MB。多图本期不做；用户可打成 PDF。

### M：计价日

第三步区域/工厂旁增加「计价日」，默认当天。改日期：清快照、重匹配价目。价目维护 UI 增加生效起止；导入 xlsx 可后补列，缺省则视为长期有效。

### M：原值对照

第二步行展开或 tooltip：显示 `extract_snapshot` 与当前值 diff（名称/规格/用量）。无快照的旧数据不显示对照。

## 4. 业务逻辑

### 异常分类（S，纯函数）

在 `listComputeBlockers` 旁新增 `listReviewIssues(lines, blockers)`：先把现有 blocker 映射为 block 级 issue，再追加 warn。bundled 五金、独立加工行、部门页脚、装饰件：**不进** block（与现网 compute-gate 一致），但 template_pending / low_confidence 仍可 warn。

### 图片预处理（S）

`preprocess/index.ts`：扩展名是图片则复制为 `pages/page-1.png`（webp/jpeg 转 png 或原样存、contentType 保留），`pageNo=1`，text=文件名。不调用 LibreOffice。随后 `classify-page-kind` 可能判为 `render`；若无材料关键词，facts/BOM 可能偏空——允许，采购在短表补全。不因此放宽「禁止臆造五金」。

### 价目匹配（M）

`costing-scope` 选出的候选行再滤 `price_as_of`。无命中 → unmatched，行为与现网缺价相同。

### 包装（M）

`enrich` / 包装 upsert 读取项目工厂的 `pack_profile`，与默认常量 merge 后再算护角外径、保利龙体积、纸箱面积及默认单价。无工厂或 profile 空：与现网完全一致。

### 重拆 BOM（M）

删除并重写非手工行时：新行写入新的 `extract_snapshot`。手工行保留且 **保留** 其已有 snapshot（若无则不补）。

## 5. 集成

- Dify：不改 DSL、不把查价/计算放进工作流。  
- 导出 Excel：S 可增加「来源」列；M 增加「提取原值」列（有 snapshot 时）。未计算仍不导出金额。  
- 飞书审批：不做。

## 6. 非范围（两阶段共同）

- Dify 11 步总编排、成本由模型生成  
- 拆四套成本表、供应商维  
- 用 LLM 覆盖斗柜/床头柜开料公式  
- BOM≥85% / 3 分钟 / 误差≤5% 作为验收门  
- 多图一次上传、珍珠棉新包装行、CNC、连接件/脚垫新五金模板（可在 M 之后单独立项）  
- 「加入成本库」、手填价写回价目

## 7. 验收

### S

1. 缺价行出现在第三步异常队列且计算按钮禁用；点该条回到第二步对应行。  
2. 仅 template 包装/螺丝包且未改过：队列有 warn「模板补全」，计算仍允许（若已有价）。  
3. 板材规则开料行标签含「规则开料」；人改过的行含「人工修改」。  
4. 上传一张 PNG 尺寸图：项目有 1 页 page_image，可跑 facts（允许识别弱）。  
5. 非 pptx/pdf/图片仍 400。

### M

1. 人改用量后 tooltip 仍显示提取时用量。  
2. 价目 A 2026-01–2026-06、价目 B 2026-07 起；计价日 2026-03 用 A，2026-08 用 B。  
3. 工厂 pack_profile `cornerAllowanceMm=100` 时护角外径按 +100，未配工厂的项目仍 +80。  
4. 相交生效区间保存价目返回 400。

## 8. 实施顺序

1. S1 异常队列（纯函数 + API + 第三步 UI）  
2. S2 来源标签（与 S1 同一映射模块）  
3. S3 图片入口  
4. M1 extract_snapshot  
5. M2 计价日 + 价目生效区间  
6. M3 工厂包装档案  

S1+S2 可同一 PR；S3 独立。M 三项可分三个 PR，M2 依赖价目匹配测试，M3 依赖现有包装公式测试。
