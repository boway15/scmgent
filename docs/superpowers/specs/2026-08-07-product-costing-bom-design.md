# 产品成本核算（AI 拆清单）设计

**日期**：2026-08-07  
**状态**：已评审（对话拍板）  
**样本**：`docs/samples/采购/实木弯腿行政桌新方案-zwn-2026.6.2.pptx`（输入）、`docs/samples/采购/板式L桌王硕-7.14(1).xlsx`（清单/成本表结构参考）

## 1. 背景与目标

采购侧需要根据产品**设计方案（PPT/PDF）**拆出原材料清单，再核算成本并导出 Excel。  
本期将能力做进 scm-agent **采购管理**模块，主路径为 **多模态 AI 拆 BOM + 人工校对**；成本核算为下一里程碑。

### 用户故事

- 作为采购员，我希望上传设计方案后由 AI 生成物料清单草稿，以便减少对着图纸手工拆件的时间。
- 作为采购员，我希望在确认清单前能对照原页修改用量与规格，以便避免错误进入报价。
- 作为采购员，我希望确认后的清单可导出 Excel，以便与工厂/财务对齐（对齐样本列结构）。

## 2. 已拍板决策

| 项 | 选择 |
|----|------|
| 落地形态 | **C**：scm-agent 采购模块页面（非离线脚本优先） |
| AI 拆清单 | **要**：M1 主路径 |
| 图文能力 | **C**：M1 起多模态（文本页 + 图页） |
| 预处理位置 | scm-agent 后端拆页/渲染；Dify Workflow 只做推理 |
| 附件存储 | P0 **本地 Docker 卷**（`data/costing/{projectId}/`），库内存相对路径 |
| 与现有 `bom` 表 | **不读写**；成本清单用独立表（物料可为自由文本） |
| SKU 关联 | 成品 `sku_id` **可选** |
| M1 范围 | 上传 → AI 拆 → 校对 → 确认清单 → 导出清单 Excel |
| M2 范围 | 价目匹配、核算金额、导出成本表（本 spec 只预留，不实现） |

## 3. 范围

### 3.1 M1 做

- 菜单：`procurement.costing` → `/procurement/costing`
- 核算单 CRUD、方案上传（pptx/pdf）
- 按页抽文本 + 渲染页图，供预览与 AI
- 异步调用 Dify 多模态 Workflow 生成 BOM 草稿
- 清单行编辑/增删、置信度告警、确认清单
- 导出清单 Excel（列对齐样本习惯：大类/名称/规格/单位/净用量/损耗/毛用量/备注）
- 环境变量：`DIFY_API_KEY_COSTING_BOM`

### 3.2 M1 不做

- 自动核算金额、价目表、回写 `skus.unit_cost`
- 飞书多维表格同步
- 正式 PO / MRP / 读写现有 `bom`、`material_requirements`
- 免人工确认（模糊尺寸必须人补）

### 3.3 M2（预留，不在本实现）

- `material_price_book`、成本快照表
- 匹配单价 → 行金额 → 汇总 → 导出成本 Excel
- 状态推进至 `costed`

## 4. 架构与数据流

```
上传 .pptx/.pdf
  → 本地存储 + costing_attachments(source)
  → 预处理：每页 text + page_image
  → POST extract（异步 run）
  → 分批调用 Dify Workflow（多模态）
  → 校验 JSON → 写 costing_bom_lines（算 qty_gross）
  → 人审校对 → confirm-bom → bom_ready
  → export-bom Excel
```

### 状态机（`costing_projects.status`）

```
draft → extracting → bom_draft → bom_ready
                ↘ extract_failed（可重试）
bom_ready 之后 M2 可进入 costed
```

- `extracting`：存在 `running` 的 extract run
- 整单重拆：删除或归档非 `is_manual` 的 AI 行，保留手工行后写入新 AI 行
- `confirm-bom`：默认要求无 `confidence=low` 且 `material_name`/`unit`/`qty_net` 齐全；允许请求体 `force: true` 强制确认并记审计备注

## 5. 数据模型

### 5.1 `costing_projects`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| project_no | varchar(32) unique | 如 `CST-20260807-XXXX` |
| name | varchar(200) | 产品/方案名 |
| category | varchar(100) | 品类提示（给 AI） |
| sku_id | uuid? FK → skus | 可选 |
| status | enum | draft / extracting / bom_draft / bom_ready / costed / extract_failed |
| extract_error | text? | 最近失败摘要 |
| confirmed_bom_at | timestamptz? | |
| created_by | uuid? | |
| created_at / updated_at | timestamptz | |

### 5.2 `costing_attachments`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| project_id | uuid FK cascade | |
| kind | enum | source / page_image / page_text |
| page_no | int? | |
| file_name | varchar | |
| content_type | varchar | |
| storage_path | varchar | 相对 `data/costing/` |
| byte_size | int | |
| created_at | timestamptz | |

### 5.3 `costing_extract_runs`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| project_id | uuid FK cascade | |
| status | enum | pending / running / succeeded / failed |
| page_from / page_to | int? | 批次范围；整份为空 |
| dify_workflow_run_id | varchar? | |
| raw_response | jsonb? | |
| error_message | text? | |
| started_at / finished_at | timestamptz? | |
| created_by | uuid? | |

### 5.4 `costing_bom_lines`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| project_id | uuid FK cascade | |
| line_no | int | |
| category | varchar(50) | |
| material_name | varchar(200) | |
| spec | varchar(500)? | |
| unit | varchar(20) | |
| qty_net | numeric(14,4) | |
| loss_rate | numeric(8,4) | 默认 0 |
| qty_gross | numeric(14,4) | **仅后端计算** = qty_net × (1+loss_rate) |
| source_ref | varchar(100)? | 如 `p5` |
| confidence | enum | high / medium / low |
| notes | text? | |
| is_manual | boolean | 默认 false；人改/人增为 true |
| extract_run_id | uuid? | |
| created_at / updated_at | timestamptz | |

索引：`costing_bom_lines(project_id, line_no)`；`costing_attachments(project_id, kind, page_no)`；`costing_extract_runs(project_id, created_at)`。

## 6. API

前缀：`/api/procurement/costing`（挂到独立 router，在 `apps/web/server/index.ts` 注册）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 列表：分页、status、keyword |
| POST | `/` | 创建：`{ name, category?, skuId? }` |
| GET | `/:id` | 详情 + lines 摘要 + 附件/页数 |
| PATCH | `/:id` | 更新 name/category/skuId |
| DELETE | `/:id` | 删库 + 删本地目录 |
| POST | `/:id/attachments` | multipart 字段 `file`；仅 pptx/pdf |
| GET | `/:id/pages/:pageNo` | 返回页图（或 text）；鉴权后读本地文件 |
| POST | `/:id/extract` | `{ pageFrom?, pageTo? }` → `{ runId }`；异步 |
| GET | `/:id/extract/runs` | 运行历史 |
| GET | `/:id/extract/runs/:runId` | 单次状态（轮询） |
| GET | `/:id/bom-lines` | 全部行 |
| PUT | `/:id/bom-lines` | 批量覆盖保存（校对） |
| POST | `/:id/bom-lines` | 新增一行 |
| PATCH | `/:id/bom-lines/:lineId` | 改一行 |
| DELETE | `/:id/bom-lines/:lineId` | 删一行 |
| POST | `/:id/confirm-bom` | `{ force?: boolean }` |
| GET | `/:id/export-bom` | 下载 xlsx |

权限：沿用登录态；菜单码 `procurement.costing`。角色默认授予 `purchaser`、`super_admin`（与采购其它页一致，`pmc_planner`/`viewer` 可只读或暂不授写）。

## 7. Dify Workflow 约定

- Env：`DIFY_API_KEY_COSTING_BOM`；`isDifyKeyConfigured` / `runWorkflow` 复用 `apps/web/server/integrations/dify.ts`
- 超时：沿用或单独提高 `DIFY_WORKFLOW_TIMEOUT_MS`（多模态建议 ≥ 180000）
- **inputs**：`category`（string）、`pages_json`（stringified array of `{ page, text, image_base64 }`）
- **outputs**：`lines` JSON 数组，字段见下；非法则 run=`failed`，项目 `extract_failed`

### 单行 schema（严格）

```json
{
  "category": "板材",
  "material_name": "多层实木板",
  "spec": "18mm 1200x600",
  "unit": "张",
  "qty_net": 2,
  "loss_rate": 0.08,
  "source_ref": "p3",
  "confidence": "medium",
  "notes": ""
}
```

`confidence` 仅允许 `high|medium|low`。`qty_gross` 由服务端计算，忽略模型返回的毛用量。

### 分批

- 默认每批最多 4 页图文；批间顺序执行，合并 lines
- 合并规则：`material_name+spec+unit` 相同则 `qty_net` 相加，`confidence` 取较低档，`source_ref` 用逗号拼接
- 冲突备注写入 `notes`

## 8. 预处理（PPT/PDF）

- 存储根目录：环境变量 `COSTING_DATA_DIR`，默认容器内可写路径（与现有 data 卷对齐，实现时写进 compose/文档）
- PPTX：解压抽取每页文本；页图渲染优先 **LibreOffice headless 转 PDF → pdftoppm/png**，或等价方案写入 Docker 镜像/sidecar
- PDF：直接按页渲染 + 文本抽取（pdf.js / poppler）
- 页图限制：最长边 ≤ 1600px，JPEG/PNG，单页建议 &lt; 1.5MB，超限压缩后再送 Dify
- 失败：预处理失败则 extract run failed，不调用 Dify

## 9. 前端

| 路由 | 页面 |
|------|------|
| `/procurement/costing` | 列表、新建 |
| `/procurement/costing/:id` | Tab「方案」：上传、页缩略图、触发/轮询 AI；Tab「清单」：表格编辑、确认、导出 |

UI 对齐现有采购页与 `scm-design`（淘宝活力橙），不新造视觉体系。

## 10. 验收（M1）

1. 上传样本 PPT，预处理产出 ≥1 页图与文本。
2. 配置 Dify key 后「AI 拆解」进入 `extracting`，完成后 `bom_draft` 且有行。
3. 低置信度行高亮；修改后 `is_manual=true`；`qty_gross` 随损耗重算。
4. 确认后 `bom_ready`；导出 Excel 含约定列。
5. 未配置 `DIFY_API_KEY_COSTING_BOM` 时 extract 返回明确 503/错误文案；仍可手工维护行并导出。

## 11. 风险

| 风险 | 缓解 |
|------|------|
| PPT 渲染依赖重 | Docker 明确安装 LibreOffice/poppler；CI 可用 fixture 跳过真实渲染测逻辑 |
| 多模态贵且慢 | 分页批处理、可选页范围重拆、轮询 UX |
| 模型幻觉用量 | 人审闸门 + low 默认不可确认 |
| 品类差异大 | `category` 提示词；先家具桌类样本验收 |

## 12. 实现分期

| 里程碑 | 交付 |
|--------|------|
| M1 | 本 spec 全部「做」项 |
| M2 | 价目 + 核算 + 成本 Excel + `costed` |
| M3 | 品类模板克隆、价目同义词、汇总二次 LLM 校对（可选） |
