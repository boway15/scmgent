# MVP PRD：AI 助手（阶段 A+B，本期不启 Dify）

**版本**：v2.0（2026-06-06 修订）  
**定位**：本期交付对话体验与业务嵌入式增强；**不配置 Dify API Key**。代码与表结构预留 Dify 切换。

## 1. 需求分析

### 背景

供应链团队需快速查阅 SOP、理解补货/预警原因。本期用**本地 FAQ + 规则摘要**提供可用价值，避免 Mock 空话；下期启用 Dify RAG 后无缝升级。

### 用户角色

| 角色 | 操作 |
|------|------|
| 所有角色 | 知识问答、查看历史对话 |
| 采购/PMC | 在补货/预警/库存页使用上下文助手 |

### 分期范围（已确认）

| 阶段 | 本期 | 说明 |
|------|------|------|
| A — 知识库体验 | ✅ | 多轮对话 UI、历史列表、本地 FAQ |
| B — 业务嵌入 | ✅ | 补货原因、预警摘要、库存页问 SKU |
| Dify RAG | ❌ | 下期配置 `DIFY_API_KEY_KNOWLEDGE` |
| 流式 SSE | ❌ | 随 Dify 启用 |
| 合规 Agent | ❌ | 见合规 PRD 阶段 B |

---

## 2. 数据模型

### 表：kb_conversations / kb_messages

（与 v1 相同，已实现）

| 表 | 关键字段 |
|----|----------|
| kb_conversations | user_id, dify_conversation_id, title |
| kb_messages | conversation_id, role, content, sources |

---

## 3. 页面流程

### 知识问答（`/ai/chat`）

```
[历史对话侧栏]  |  [消息流]
                |  [连接状态：本地助手模式]
                |  [输入框]
```

- 新建 / 切换对话
- 展示 user/assistant 消息
- sources 区域预留（Dify 启用后展示引用）
- 页内说明：「知识库引擎未配置，当前为本地助手」

### 业务嵌入（Phase B）

| 入口 | 行为 |
|------|------|
| 补货建议列表 | 展开 `reason` 字段（算法已生成） |
| 缺货预警 | 增强摘要文案；可选跳转补货建议 |
| 库存总览 SKU 行 | 「问这个 SKU」→ 带上下文打开 AI |

---

## 4. API

### 本期新增

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/conversations` | 当前用户对话列表 |
| GET | `/api/ai/conversations/:id/messages` | 对话消息 |
| POST | `/api/ai/chat` | 提问（本地 FAQ 或 Dify） |

### 本地 FAQ 逻辑

- 关键词匹配：安全库存、ROP、EOQ、PMC 计划、采购跟单、合规字段等
- 无匹配：返回「未找到相关信息」+ 建议联系管理员
- 带 `skuCode` 上下文：拼接库存/补货公开 API 摘要（只读）

### Dify 切换（下期）

配置 `DIFY_API_KEY_KNOWLEDGE` 后 `queryKnowledge()` 自动走 Dify Chat API，前端无需改路由。

---

## 5. 质量要求

- [x] 对话历史可查看、可续聊
- [x] 本地模式不编造业务数据（FAQ + SKU 实时快照）
- [x] 无 Dify 时明确提示连接状态
- [x] 补货 reason、预警摘要人类可读
- [x] Dify 启用后引用来源可展示（结构已预留）

---

## 6. 环境变量

| 变量 | 本期 | 说明 |
|------|------|------|
| `DIFY_API_KEY_KNOWLEDGE` | 留空 | 留空 = 本地助手 |
| `DIFY_BASE_URL` | 可选 | 默认 localhost |
