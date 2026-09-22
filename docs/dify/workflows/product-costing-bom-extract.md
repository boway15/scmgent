# 产品成本核算 · AI 拆 BOM（Dify Workflow）

配合 scm-agent：`POST /api/procurement/costing/projects/:id/extract`。

**可导入 DSL**：[`product-costing-bom-extract.yml`](./product-costing-bom-extract.yml)
导入路径：Dify 控制台 → 工作室 → 导入 DSL → 发布后把 API Key 配到 `DIFY_API_KEY_COSTING_BOM`。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DIFY_BASE_URL` | 如 `http://host.docker.internal:8080/v1`（容器内） |
| `DIFY_API_KEY_COSTING_BOM` | 本 Workflow 的 API Key（`app-…`） |
| `DIFY_WORKFLOW_TIMEOUT_MS` | 必须 ≥ `300000`（多模态，至少 300 秒） |
| `COSTING_DATA_DIR` | 附件目录，默认 `data/costing` |
| `COSTING_PREPROCESS_MODE` | `auto`（默认，优先 LibreOffice）/ `fixture`（本地联调）/ `libreoffice` |

生产 Docker 镜像已包含 `libreoffice` 与 `poppler-utils`（`soffice` + `pdftoppm`），用于 PPT/PDF 页图渲染。

除 scm-agent 的 `DIFY_WORKFLOW_TIMEOUT_MS=300000` 外，还必须在 **Dify 管理后台**
将该 workflow/app 的**执行超时**设置为 **≥ 300 秒**。两处超时相互独立；只提高
scm-agent 调用超时，Dify 仍可能先终止执行。

## Workflow 输入

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `category` | string | 品类提示，如「书桌」 |
| `extract_hints` | string | 品类拆单规则、结构类型、抽屉数、默认基材、外形尺寸、本页任务、价目标准名 |
| `pages_json` | string | JSON 数组字符串 |

`pages_json` 元素：

```json
{
  "page": 1,
  "page_type": "bom_list",
  "text": "台面 1800x800 …",
  "image_base64": "<png/jpeg base64 不含 data: 前缀>",
  "image_mime_type": "image/png"
}
```

`page_type` 用于标识 `bom_list`、`cmf`、`size`、`explosion`、`notes` 等页面类型。
平台优先发送 BOM 相关页面；解析顺序为尺寸/CMF/设计说明 → 爆炸图。
**文档分工**：设计说明=板厚与默认标准；爆炸图=零件清单；产品尺寸页=整柜 W×D×H。scm-agent 用尺寸页外形套到结构件（notes 含「由结构关系推算」），不以爆炸图小板开料代替整柜。纯 `render`、`cover`
效果图页不发送，带材料关键词的页面仍可能发送供材质识别。

## Workflow 输出

输出变量建议命名 `lines`（string 或 object/array 均可，平台会兼容解析）。

单行字段（snake_case）：

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
  "origin": "explicit",
  "notes": ""
}
```

`confidence` 仅允许：`high` | `medium` | `low`。
`origin` 仅允许：`explicit` | `template`。图文无法确认的结构件用
`origin=template`、`qty_net=0`，不得猜测用量。严禁补造图文中未出现的五金。
`qty_gross` 由 scm-agent 计算，模型无需返回。

## 模型要求

- 必须支持**多模态**（看图读尺寸/结构/爆炸图标注）
- **不要使用** `deepseek-chat` 等纯文本模型；导入后请在 LLM 节点改为例如：
  - OpenAI `gpt-4o` / `gpt-4o-mini`
  - 通义 `qwen-vl-max` / `qwen2.5-vl-72b-instruct`
  - Google `gemini-2.0-flash`（或你实例已安装的其他 vision 模型）
- Prompt 要求：只输出 `lines` JSON 数组，每项含 `origin`；按 `page_type` 限定本页抽取范围
- 禁止输出「产品尺寸」物料行；「高度/盖住」不是物料；板件单位用张/块
- 图文不确定的结构件必须 `origin=template`、`qty_net=0`、`confidence=low`
- 禁止编造图或文字中未出现的五金件
- 材料名优先使用 `extract_hints` 中的价目标准名；同义词归一（中纤板=密度板）

scm-agent 每批会同时发送 **text + image_base64 + image_mime_type**；请确认所选模型能解析 Prompt 内的 `data:image/jpeg;base64,...` 图片。

### 页图传递限制

Dify 的 LLM `vision.variable_selector` 只接受 `File/ArrayFile` 变量，而 Code
节点不能从 `pages_json.image_base64` 产出该文件类型。因此本 DSL 不能仅靠小幅
接线修改把 base64 页图接入原生 vision/files 输入；当前将页图作为 Markdown data
URL 放入 Prompt，是否被识别取决于所选多模态模型及 provider。单图上限已放宽为
560,000 个 base64 字符，可覆盖后端发送的 400 KiB JPEG。若部署环境的 provider
不解析 data URL，需要增加可输出 Dify File 的解码插件，或由调用端先上传图片并
通过文件变量传入，再将 `vision.variable_selector` 指向该变量。

## 导入失败排查

| 现象 | 处理 |
|------|------|
| 导入时报 LLM / vision 校验错误 | 本 DSL **已关闭** `vision.enabled`；页图走 Prompt 内 data URL。请勿手动开启 Vision 且不选变量 |
| 提示缺少 deepseek 插件 | 在 Dify 插件市场安装 DeepSeek，或导入后把 LLM 节点模型改成你实例已有的多模态模型 |
| `pages_json` 超长 | scm-agent 默认每批 1 页；DSL 输入上限 500,000 字符，足够单页图文 |
| 导入成功但运行无清单 | 检查 `DIFY_API_KEY_COSTING_BOM`、Workflow 超时 ≥300s、模型是否支持读 Prompt 内图片 |
| 报未知输入 `extract_hints` | 需重新导入本 DSL 并发布；scm-agent 会把品类规则/外形/价目名写入该变量 |

## 建议节点链

```
开始(category, extract_hints, pages_json；每页含 page_type)
  → Code：解析 pages_json，透传 extract_hints
  → LLM（多模态）：按 page_type + 品类规则抽取 BOM
  → Code：校验/归一化 lines
  → 结束(outputs.lines)
```

## 变更记录

### 2026-08-21

- **Prompt**：禁止纯基材占位行（密度板/颗粒板且无 spec、qty=0）；禁止「设计标准/设计规则-xxx」假物料；明确 size 页必出「抽面」、explosion 页必出五金
- **prepare_pages**：新增输出 `page_types_line`（本批页型摘要，如 `p4:size, p5:explosion`）
- **parse_lines**：后处理过滤纯基材行、设计规则占位、产品尺寸行、无开料尺寸的饰面行

## 验收记录（模板）

- [ ] 配置 `DIFY_API_KEY_COSTING_BOM`
- [ ] 上传 `docs/samples/采购/实木弯腿行政桌新方案-zwn-2026.6.2.pptx`
- [ ] AI 拆解完成，材料清单有分组
- [ ] 图文不确定的结构件为 `origin=template`、`qty_net=0`
- [ ] 未出现的五金没有被补造
- [ ] 导出 Excel 含「材料清单」「成本汇总」两张工作表
- [ ] 未配置 key 时 extract 返回明确错误，仍可手工增行导出
