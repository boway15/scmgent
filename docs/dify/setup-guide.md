# Dify 部署与应用创建指南（方案 A）

## 1. 部署形态

推荐本地或内网自托管 Dify，与 SCM 业务库分离：

| 组件 | 建议 |
|------|------|
| Dify API | `http://<host>:8080/v1` |
| PostgreSQL | 独立实例（勿与妙搭业务库混用） |
| 向量库 | Weaviate / Qdrant（按 Dify 安装向导） |

`DIFY_BASE_URL` 必须包含 `/v1` 后缀，例如 `http://localhost:8080/v1`。

## 2. 创建三个 Dify 应用

### 2.1 供应链知识库（Chat + RAG）

1. 新建「聊天助手」应用，开启知识库
2. 创建知识库「scm-sop」，上传 `docs/dify/knowledge-base/` 下全部 Markdown
3. 检索：混合检索 + 重排序（可选 Cohere/Jina）
4. 系统提示词建议：

```
你是跨境电商供应链助手。仅基于知识库与传入的 sku_context 回答。
不得编造库存数量、补货量或审批结果。实时数据以 sku_context 为准。
```

5. 添加输入变量（可选，供业务上下文）：
   - `sku_context`（paragraph，可选）
   - `sku_code`（text，可选）
   - `warehouse_code`（text，可选）

6. 发布应用，复制 API Key → `DIFY_API_KEY_KNOWLEDGE`

### 2.2 补货建议增强（Workflow）

**输入变量：**

| 变量 | 类型 | 说明 |
|------|------|------|
| `suggestions_json` | string | JSON 数组，每项含 skuCode、warehouseCode、suggestedQty、reason |
| `days` | number | 预测天数，默认 90 |

**节点链：**

```
开始 → LLM（根据 suggestions_json 生成更易读的业务说明）→ 结束
```

**输出变量：**

| 变量 | 类型 | 说明 |
|------|------|------|
| `enhanced_json` | string | JSON 数组，每项含 skuCode、warehouseCode、reason、summary、risk_notes |

LLM 不得修改 `suggestedQty`，只增强 `reason` / `summary` / `risk_notes`。

发布 → `DIFY_API_KEY_REPLENISHMENT`

### 2.3 缺货预警通报（Workflow）

**输入变量：**

| 变量 | 类型 | 说明 |
|------|------|------|
| `alert_rows_json` | string | JSON 数组，每项含 skuCode、type、currentQty、threshold |

**输出变量：**

| 变量 | 类型 | 说明 |
|------|------|------|
| `feishu_message` | string | 飞书群通报正文（纯文本） |

发布 → `DIFY_API_KEY_ALERT`

## 3. 环境变量

```env
DIFY_BASE_URL=http://localhost:8080/v1
DIFY_API_KEY_KNOWLEDGE=app-xxxxxxxx
DIFY_API_KEY_REPLENISHMENT=app-yyyyyyyy
DIFY_API_KEY_ALERT=app-zzzzzzzz
```

API Key 仅配置在后端（`.env` 或妙搭环境变量），**不要**写入前端或 ZIP。

## 4. 数据边界

- Dify **不**直接写 PostgreSQL；补货/预警仍由 Hono 本地算法判定
- Workflow 只增强文案，不覆盖核心数量字段
- 飞书凭证保留在 `integrations/feishu.ts`，不由 Dify HTTP 节点持有

## 5. 验证

1. `GET /api/ai/config` → `mode: "dify"`
2. `/ai/chat` 提问「什么是 ROP」→ 返回答案 + `sources`
3. `POST /api/tasks/replenishment-forecast` → `engine` 含 `dify-enhanced`（若 Key 已配）
4. `POST /api/tasks/stock-alert` → 飞书消息为 LLM 润色版（若 Key 已配）

完整验收见 [dify-acceptance-checklist.md](../qa/dify-acceptance-checklist.md)。
