# 产品成本核算 · AI 拆 BOM（Dify Workflow）

配合 scm-agent M1：`POST /api/procurement/costing/:id/extract`。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DIFY_BASE_URL` | 如 `http://host.docker.internal:8080/v1`（容器内） |
| `DIFY_API_KEY_COSTING_BOM` | 本 Workflow 的 API Key（`app-…`） |
| `DIFY_WORKFLOW_TIMEOUT_MS` | 建议 ≥ `180000`（多模态） |
| `COSTING_DATA_DIR` | 附件目录，默认 `data/costing` |
| `COSTING_PREPROCESS_MODE` | `fixture`（无 LibreOffice）/ `libreoffice`（生产） |

## Workflow 输入

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `category` | string | 品类提示，如「实木办公桌」 |
| `pages_json` | string | JSON 数组字符串 |

`pages_json` 元素：

```json
{
  "page": 1,
  "text": "台面 1800x800 …",
  "image_base64": "<png/jpeg base64 不含 data: 前缀>"
}
```

每批最多约 4 页；平台会分批调用并合并结果。

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
  "notes": ""
}
```

`confidence` 仅允许：`high` | `medium` | `low`。  
`qty_gross` 由 scm-agent 计算，模型无需返回。

## 模型要求

- 必须支持**多模态**（看图读尺寸/结构）
- Prompt 要求：只输出清单 JSON，不确定项 `confidence=low` 并在 `notes` 说明

## 建议节点链

```
开始(category, pages_json)
  → Code：解析 pages_json
  → LLM（多模态）：按 schema 抽取 BOM
  → Code：校验/归一化 lines
  → 结束(outputs.lines)
```

## 验收记录（模板）

- [ ] 配置 `DIFY_API_KEY_COSTING_BOM`
- [ ] 上传 `docs/samples/采购/实木弯腿行政桌新方案-zwn-2026.6.2.pptx`
- [ ] AI 拆解完成，状态 `bom_draft`，有清单行
- [ ] 校对后确认 → `bom_ready`
- [ ] 导出 Excel 列：大类/物料名称/规格/单位/净用量/损耗率/毛用量/来源/置信度/备注
- [ ] 未配置 key 时 extract 返回明确错误，仍可手工增行导出
