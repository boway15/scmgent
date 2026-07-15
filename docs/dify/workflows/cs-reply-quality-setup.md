# 客服回复质量评估 · Dify 配置指南

对应 DSL：`docs/dify/workflows/cs-reply-quality.yml`  
Dify 实例：`http://127.0.0.1:8090/`（控制台与 API 网关；API 基址为 `http://127.0.0.1:8090/v1`）

## 1. 导入工作流（方案 A）

> **不要**使用「聊天助手 / Chat」应用的 API Key。SCM 只对接 **Workflow** 的 `/workflows/run`。

1. 打开 Dify → **工作室** → **导入 DSL**（或「从 DSL 导入」）
2. 选择项目内文件：`docs/dify/workflows/cs-reply-quality.yml`
3. 导入后应用名应为 **客服回复质量评估**，模式为 **工作流**（非 advanced-chat）
4. 若 **评估回复质量** LLM 节点报红 → 改为你实例已安装的模型（DeepSeek / OpenAI 等）
5. 点击右上角 **发布**
6. 进入该 **工作流** 应用 → **访问 API** → 复制 API Key（不是旧 Chat 应用的 Key）
7. 写入 SCM `.env` 并重启后端：

```env
DIFY_BASE_URL=http://127.0.0.1:8090/v1
DIFY_API_KEY_CS_REPLY_QUALITY=app-工作流密钥
```

### 验证 Key 是否为 Workflow

PowerShell：

```powershell
(Invoke-RestMethod -Uri "http://127.0.0.1:8090/v1/info" -Headers @{
  Authorization = "Bearer app-你的工作流密钥"
}).mode
```

应输出 **`workflow`**。若显示 `advanced-chat`，说明 Key 仍来自 Chat 应用，需重新复制。

SCM 页面 **客服管理 → 回复质量评估** 顶部应显示绿色「Dify 已连接 · 客服回复质量评估（workflow）」。

## 2. 工作流输入变量

与 Excel 导入列对齐（`docs/samples/cs/tengfei近3个月买家消息.xlsx`）：

| Dify 变量 | Excel 列 | 类型 | 必填 | 说明 |
|-----------|----------|------|:----:|------|
| `buyer_message` | 买家消息 | paragraph | ✓ | 买家来信原文 |
| `agent_reply` | 客服回复 | paragraph | ✓ | 待评估回复 |
| `message_type` | 消息类型 | select | | `售前` / `售后`，默认 `售后` |
| `order_no` | 订单号 | text | | 可空 |
| `agent_name` | 回复人 | text | | 客服姓名 |
| `buyer_email` | 买家邮箱 | text | | 仅作上下文 |
| `pass_threshold` | — | number | | 及格线，默认 `70` |

## 3. 工作流输出变量

| 输出 | 类型 | 说明 |
|------|------|------|
| `overall_score` | string | 总分 0–100 |
| `score_detail` | string | JSON：`{accuracy, professionalism, empathy, resolution}` |
| `feedback` | string | 中文评语（亮点 + 问题 + 改进建议） |
| `highlights_json` | string | JSON 数组，亮点列表 |
| `issues_json` | string | JSON 数组，问题列表 |
| `pass` | string | `"true"` / `"false"`，是否 ≥ 及格线 |
| `parse_ok` | string | `"true"` / `"false"`，JSON 是否解析成功 |

`score_detail` 示例：

```json
{
  "accuracy": 85,
  "professionalism": 90,
  "empathy": 78,
  "resolution": 72
}
```

## 4. 控制台试运行

在 Dify 应用页点击 **运行**，填入示例：

**买家消息：**

```
Can I please get a refund back it's been 2 days and still nothing
```

**客服回复：**

```
Dear customer, We sincerely apologize again for this situation. If you tried all methods but still cannot find the package successfully, could you please follow the steps to get the case number and tell us? ...
```

**消息类型：** `售后`  
**订单号：** `114-7452694-9350600`  
**回复人：** `王亚敏1`

预期：结束节点出现 `overall_score`、`score_detail`、`feedback` 等字段。

## 5. API 手动验证

PowerShell（将 `app-xxx` 换成你的 Key）：

```powershell
$body = @{
  inputs = @{
    buyer_message = "Can I please get a refund back it's been 2 days and still nothing"
    agent_reply   = "Dear customer, We sincerely apologize again for this situation..."
    message_type  = "售后"
    order_no      = "114-7452694-9350600"
    agent_name    = "王亚敏1"
    pass_threshold = 70
  }
  response_mode = "blocking"
  user = "test-user"
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Uri "http://localhost:8090/v1/workflows/run" `
  -Method POST `
  -Headers @{ Authorization = "Bearer app-你的密钥"; "Content-Type" = "application/json" } `
  -Body $body
```

成功时 `data.outputs` 含 `overall_score`、`score_detail`、`feedback` 等。

curl 示例：

```bash
curl -X POST "http://localhost:8090/v1/workflows/run" \
  -H "Authorization: Bearer app-你的密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {
      "buyer_message": "Can I please get a refund?",
      "agent_reply": "Dear customer, We apologize...",
      "message_type": "售后",
      "order_no": "114-7452694-9350600",
      "agent_name": "王亚敏1",
      "pass_threshold": 70
    },
    "response_mode": "blocking",
    "user": "test-user"
  }'
```

## 6. 与 SCM 后端对接约定

后续妙搭「客服回复质量评估」模块将调用：

```typescript
// apps/web/server/integrations/dify.ts → runWorkflow()
await runWorkflow('DIFY_API_KEY_CS_REPLY_QUALITY', {
  buyer_message: row.buyerMessage,
  agent_reply: row.agentReply,
  message_type: row.messageType,
  order_no: row.orderNo ?? '',
  agent_name: row.agentName ?? '',
  buyer_email: row.buyerEmail ?? '',
  pass_threshold: 70,
});
```

返回 `outputs` 写入 `cs_reply_records` 表（模块开发中）。

## 7. 常见问题

| 现象 | 处理 |
|------|------|
| 导入失败 / 版本不兼容 | 将 YAML 顶部 `version: 0.6.0` 改为你 Dify 实例版本 |
| LLM 节点红叉 | 换已安装模型；或安装 DeepSeek 插件 |
| `parse_ok: false` | LLM 未输出合法 JSON，调低 temperature 或换更强模型 |
| API 401 | Key 未发布或 Bearer 前缀错误 |
| API 连接失败 | 确认 `8090` 端口、防火墙、`/v1` 路径 |
| 长邮件超时 | 增大 `DIFY_WORKFLOW_TIMEOUT_MS`；单条 buyer/agent 建议各 < 8000 字 |

## 8. 调优建议（可选）

导入后可在 Dify 控制台直接改 **评估回复质量** 节点的 system prompt，例如：

- 按品牌 SOP 增加禁用话术（如禁止承诺具体退款时效）
- 售前/售后使用不同权重（在 prompt 中说明）
- 将 `pass_threshold` 按季度在业务侧传入，无需改工作流
