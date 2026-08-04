---
name: dify-agent
description: >-
  Dify 工作流、RAG 知识库开发与 scm-agent（自建 Docker）集成指南。Use when building
  AI workflows, knowledge base Q&A, replenishment forecast logic, stockout alert
  pipelines, or integrating Dify REST API with the Hono backend.
---

# Dify 开发指南（供应链 AI 引擎）

## 定位

Dify 作为 AI 引擎层，处理需要 LLM 推理、RAG 检索、算法增强的逻辑。  
**scm-agent 自建后端**通过 REST API 调用 Dify；Dify 工作流末尾可通过 HTTP 节点推送飞书消息。

## 部署

自托管（与项目 Docker 环境共存或独立 compose）：

```yaml
# docker-compose 片段
services:
  dify:
    image: langgenius/dify-api:latest
    environment:
      SECRET_KEY: your-secret
      DATABASE_URL: postgresql://...
```

生产建议：Dify + Nginx + PostgreSQL（可与 scm-agent 共用或独立 PG）。

## 核心场景

### 0. 独立站智能客服草稿（Workflow DSL）

Workflow 导入结构（节点 id、边、outputs、变量引用）见 [@dify-cs-email-draft](../dify-cs-email-draft/SKILL.md)；该技能**只管 DSL 骨架**，不管 Prompt/Gateway 业务内容。

### 1. AI 知识库（RAG）

- 上传 SOP、政策 PDF / Word / Excel
- 使用**混合检索**（向量 + 全文 BM25）+ **Cohere/Jina 重排序**
- 前端 → scm-agent 后端 → Dify Chat API → 返回答案

```typescript
// apps/web/server/integrations/dify.ts
export async function queryKnowledge(question: string, userId: string) {
  const res = await fetch(`${DIFY_BASE_URL}/v1/chat-messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DIFY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: {},
      query: question,
      response_mode: 'blocking',
      user: userId,
    }),
  });
  return res.json();
}
```

### 2. 补货预测工作流

**触发**：自建调度调用 `POST /api/tasks/replenishment-forecast`（或手动）

**Dify Workflow 节点链（可选增强）**：
```
开始(inputs: sku_list, days)
  → HTTP(GET scm-agent 库存 API)
  → Code(Python: 计算 EOQ/ROP/安全库存)
  → LLM(生成补货建议文本)
  → HTTP(POST 结果回写 scm-agent)
  → 结束
```

**scm-agent 侧调用示例**：

```typescript
// apps/web/server/tasks/replenishmentForecast.ts
export async function runReplenishmentForecast() {
  const res = await fetch(`${DIFY_BASE_URL}/v1/workflows/run`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DIFY_WORKFLOW_KEY}` },
    body: JSON.stringify({
      inputs: { sku_list: await fetchSkuList(), days: 90 },
      response_mode: 'blocking',
      user: 'system-task',
    }),
  });
  const { data } = await res.json();
  return data.outputs;
}
```

### 3. 缺货预警工作流

```
开始(inputs: threshold_check_result)
  → 条件分支(库存 < 安全库存?)
  → 是: LLM(生成预警摘要) → HTTP(飞书消息推送)
  → 否: 结束
```

**飞书消息推送（Dify HTTP 节点）**：
- URL: `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`
- Method: POST
- Header: `Authorization: Bearer {{tenant_access_token}}`

## 环境变量

```env
# .env.example
DIFY_BASE_URL=https://your-dify.internal
DIFY_API_KEY_KNOWLEDGE=app-xxxx          # 知识库对话应用
DIFY_API_KEY_REPLENISHMENT=app-yyyy      # 补货预测工作流
DIFY_API_KEY_ALERT=app-zzzz             # 缺货预警工作流
```

## 约束

- API Key 只在 scm-agent 后端使用，**不暴露给前端**
- 定时 / 批处理调用放 `apps/web/server/tasks/`，由 HTTP + `CRON_SECRET` 触发
- Dify 知识库文档变更后需在 Dify 控制台重新索引
- Dify 工作流超时默认 60s，长计算任务用 `streaming` 或拆分
- **不要**默认对接飞书妙搭 ZIP / 平台 Cron
