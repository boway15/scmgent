# Dify 应用配置模板

在 Dify 控制台创建应用后，将 API Key 填入项目 `.env`：

```env
DIFY_API_KEY_KNOWLEDGE=app-xxxxxxxx      # Chat 应用 - SCM 知识库
DIFY_API_KEY_REPLENISHMENT=app-yyyyyyyy  # Workflow - 补货预测
DIFY_API_KEY_ALERT=app-zzzzzzzz          # Workflow - 缺货预警
```

## 应用 1：SCM 知识库（Chat）

- **类型**：聊天助手
- **知识库**：上传 `docs/` 下供应链 SOP 文档
- **检索**：混合检索，Top-K=5
- **测试问题**：「安全库存如何计算？」

## 应用 2：补货预测（Workflow）

**输入变量**：
- `sku_list` (string): JSON 数组，SKU 编码列表
- `days` (number): 历史天数，默认 90

**输出变量**：
- `suggestions` (array): `[{ sku_code, suggested_qty, suggested_date, reason }]`

**Code 节点示例（Python）**：
```python
import json
import math

def main(sku_list: str, days: int) -> dict:
    codes = json.loads(sku_list)
    suggestions = []
    for code in codes:
        suggestions.append({
            "sku_code": code,
            "suggested_qty": 500,
            "suggested_date": "2026-06-15",
            "reason": f"Based on {days}-day forecast (placeholder)"
        })
    return {"suggestions": suggestions}
```

## 应用 3：缺货预警（Workflow）

**输入变量**：
- `alert_summary` (string): 预警摘要文本

**输出变量**：
- `message` (string): 格式化后的推送消息

可选：添加 LLM 节点润色 `alert_summary` 为更易读的消息。

## 本地验证命令

```bash
# 知识库
curl -X POST "$DIFY_BASE_URL/chat-messages" \
  -H "Authorization: Bearer $DIFY_API_KEY_KNOWLEDGE" \
  -H "Content-Type: application/json" \
  -d '{"inputs":{},"query":"测试","response_mode":"blocking","user":"test"}'

# 补货工作流
curl -X POST "$DIFY_BASE_URL/workflows/run" \
  -H "Authorization: Bearer $DIFY_API_KEY_REPLENISHMENT" \
  -H "Content-Type: application/json" \
  -d '{"inputs":{"sku_list":"[\"SKU-HM-001\",\"SKU-HM-003\"]","days":90},"response_mode":"blocking","user":"test"}'
```
