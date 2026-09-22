# 产品成本核算 · AI 识别结构与设计标准

配合 scm-agent：`POST /api/procurement/costing/projects/:id/analyze-facts`。

**可导入 DSL**：[`product-costing-facts-extract.yml`](./product-costing-facts-extract.yml)

| 变量 | 说明 |
|------|------|
| `DIFY_API_KEY_COSTING_FACTS` | 本工作流 API Key。未配时尝试 `DIFY_API_KEY_COSTING_BOM`（仅当该 Key 指向本工作流才有效） |

与拆 BOM 工作流分开：本步只输出 `product_facts` 对象，不输出物料 `lines`。导入后请换成多模态模型，超时 ≥ 300s。

## 输入

与拆 BOM 相同：`category`、`extract_hints`、`pages_json`（封面/尺寸/设计说明/CMF，至多 1 页爆炸图）。

## 输出

`product_facts` JSON 字符串，字段含 `product_name`、`category`、`construction_type`、`drawer_count`、`default_substrate`、板厚、`structure_summary`、`design_principles`。

scm-agent 会写入核算单并允许人工修改；确认后再用爆炸图+尺寸图调用拆 BOM 工作流。
