# Dify 方案 A 验收清单

## 环境

- [ ] `DIFY_BASE_URL` 可访问（含 `/v1`）
- [ ] 三个 API Key 已配置（可按需只配部分）
- [ ] 知识库文档已上传并索引完成

## AI 知识库（Phase 1）

- [ ] `GET /api/ai/config` 无 Key 时 `mode: "local"`
- [ ] 配置 `DIFY_API_KEY_KNOWLEDGE` 后 `mode: "dify"`
- [ ] `/ai/chat` 提问「什么是 ROP」返回答案
- [ ] 助手消息展示「参考来源」`sources`
- [ ] 停掉 Dify 或错误 Key 时自动 fallback，响应含「已切换本地助手」

## 补货 Workflow（Phase 2）

- [ ] 手动 `POST /api/tasks/replenishment-forecast`（带 `X-Cron-Secret`）
- [ ] 响应 `engine` 含 `dify-enhanced`（Key 已配且 Workflow 正常）
- [ ] `reorder_suggestions.reason` 为自然语言增强版
- [ ] `suggestedQty` 仍由本地算法决定，未被 Workflow 改写
- [ ] Workflow 失败时任务仍成功，`difyEnhanced: false`

## 预警 Workflow（Phase 3）

- [ ] 手动 `POST /api/tasks/stock-alert`
- [ ] 有预警时飞书消息为 LLM 润色版（Key 已配）
- [ ] Workflow 失败时使用 `formatAlertSummary` 模板
- [ ] 飞书凭证仍由 `FEISHU_*` 环境变量控制

## 业务上下文 Chat（Phase 4）

- [ ] 库存总览「问这个 SKU」打开 `/ai/chat?sku=...`
- [ ] Dify 模式下 `sku_context` 传入（可在 Dify 日志核对）
- [ ] 助手能结合实时库存/补货/预警回答

## 安全

- [ ] 前端网络请求无 Dify API Key
- [ ] `.env` 未打入 ZIP
- [ ] 合规相关回答不自动执行上架/审批

## 妙搭

- [ ] 环境变量在平台配置并重新发布
- [ ] `/api/ai/config` 在子路径下可访问（非 HTML fallback）
