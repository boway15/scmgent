# Dify 对接就绪说明

**结论：支持 Dify 对接；未配置 API Key 时自动使用本地 FAQ 与 TS 算法。**

## 支持情况

| 能力 | 状态 | 代码位置 | 未配置时 |
|------|------|----------|----------|
| AI 知识库问答 | 已接通 | `apps/web/server/integrations/dify.ts` | 本地 FAQ + SKU 上下文 |
| Dify 故障降级 | 已接通 | `apps/web/server/routes/ai.ts` | 自动 fallback 本地助手 |
| 补货建议增强 | 已接通 | `apps/web/server/integrations/dify-workflows.ts` | 本地 `reason` 模板 |
| 缺货预警摘要 | 已接通 | `apps/web/server/tasks/stockAlert.ts` | `formatAlertSummary` 模板 |
| 环境变量 | 已文档化 | `.env.example` | 留空 = 全本地 |

## 启用步骤

1. 按 [dify/setup-guide.md](./dify/setup-guide.md) 部署 Dify 并创建三个应用
2. 上传知识库文档：`docs/dify/knowledge-base/*.md`
3. 配置环境变量：

```env
DIFY_BASE_URL=http://localhost:8080/v1
DIFY_API_KEY_KNOWLEDGE=app-xxxxxxxx
DIFY_API_KEY_REPLENISHMENT=app-yyyyyyyy
DIFY_API_KEY_ALERT=app-zzzzzzzz
# 可选：Workflow 超时毫秒，默认 120000
DIFY_WORKFLOW_TIMEOUT_MS=120000
```

4. 重启后端
5. 验收见 [qa/dify-acceptance-checklist.md](./qa/dify-acceptance-checklist.md)

## 集成架构

```
React /ai/chat
  → Hono routes/ai.ts
      ├── Dify Chat API（RAG + sku_context inputs）
      └── fallback → lib/local-assistant.ts

Cron replenishment-forecast
  → tasks/replenishmentForecast.ts
      ├── lib/replenishment.ts（EOQ/ROP 数量）
      └── Dify Workflow（增强 reason 文案）

Cron stock-alert
  → tasks/stockAlert.ts
      ├── 本地规则识别预警
      ├── Dify Workflow（飞书摘要）
      └── integrations/feishu.ts（发送）
```

## Workflow 输入输出契约

### 补货 Workflow（`DIFY_API_KEY_REPLENISHMENT`）

**输入：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `suggestions_json` | string | `[{ skuCode, warehouseCode, suggestedQty, reason }]` |
| `days` | number | 默认 90 |

**输出：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `enhanced_json` | string | `[{ skuCode, warehouseCode, reason, summary?, risk_notes? }]` |

数量字段由本地算法写入，Workflow **不得**覆盖 `suggestedQty`。

### 预警 Workflow（`DIFY_API_KEY_ALERT`）

**输入：** `alert_rows_json`（`[{ skuCode, type, currentQty, threshold }]`）、`alert_count`

**输出：** `feishu_message` 或 `summary`（纯文本）

## Chat 业务上下文（inputs）

当用户从库存页「问这个 SKU」进入时，后端将以下变量传入 Dify：

| 变量 | 说明 |
|------|------|
| `sku_context` | 库存快照、补货建议、开放预警 |
| `sku_code` | SKU 编码 |
| `warehouse_code` | 仓库编码（可选） |

Dify 应用需在控制台声明同名输入变量。

## Fallback 策略

| 场景 | 行为 |
|------|------|
| 未配置 `DIFY_API_KEY_KNOWLEDGE` | 全程本地助手 |
| Dify Chat 超时/5xx | 本地助手 + 提示「已切换本地助手」 |
| 未配置补货/预警 Key | 跳过 Workflow，保留本地文案 |
| Workflow 失败 | 日志 warn，任务仍成功完成 |

## 妙搭发布

- 环境变量在妙搭控制台配置，保存后重新发布
- API Key 仅后端可见，ZIP 不含 `.env`
- `zip:miaoda` 会将 `server/integrations/dify*.ts` 同步到 `server/hono-app/`

详细 API 见 [`.cursor/skills/dify-agent/SKILL.md`](../.cursor/skills/dify-agent/SKILL.md)
