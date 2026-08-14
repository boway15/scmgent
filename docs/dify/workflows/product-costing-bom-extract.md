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
| `category` | string | 品类提示，如「实木办公桌」 |
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
平台优先发送 BOM 相关页面，并按单页调用工作流后合并结果；纯 `render`、`cover`
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

- 必须支持**多模态**（看图读尺寸/结构）
- Prompt 要求：只输出 `lines` JSON 数组，每项含 `origin`
- 图文不确定的结构件必须 `origin=template`、`qty_net=0`、`confidence=low`
- 禁止编造图或文字中未出现的五金件

### 页图传递限制

Dify 的 LLM `vision.variable_selector` 只接受 `File/ArrayFile` 变量，而 Code
节点不能从 `pages_json.image_base64` 产出该文件类型。因此本 DSL 不能仅靠小幅
接线修改把 base64 页图接入原生 vision/files 输入；当前将页图作为 Markdown data
URL 放入 Prompt，是否被识别取决于所选多模态模型及 provider。单图上限已放宽为
560,000 个 base64 字符，可覆盖后端发送的 400 KiB JPEG。若部署环境的 provider
不解析 data URL，需要增加可输出 Dify File 的解码插件，或由调用端先上传图片并
通过文件变量传入，再将 `vision.variable_selector` 指向该变量。

## 建议节点链

```
开始(category, pages_json；每页含 page_type)
  → Code：解析 pages_json
  → LLM（多模态）：按 schema 抽取 BOM
  → Code：校验/归一化 lines
  → 结束(outputs.lines)
```

## 验收记录（模板）

- [ ] 配置 `DIFY_API_KEY_COSTING_BOM`
- [ ] 上传 `docs/samples/采购/实木弯腿行政桌新方案-zwn-2026.6.2.pptx`
- [ ] AI 拆解完成，材料清单有分组
- [ ] 图文不确定的结构件为 `origin=template`、`qty_net=0`
- [ ] 未出现的五金没有被补造
- [ ] 导出 Excel 含「材料清单」「成本汇总」两张工作表
- [ ] 未配置 key 时 extract 返回明确错误，仍可手工增行导出
