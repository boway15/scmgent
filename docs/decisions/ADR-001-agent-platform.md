# ADR-001：智能体平台选型决策

**日期**：2026-06-06  
**状态**：已决策  
**MVP 状态（2026-06-18 修订）**：Dify **可选对接**，未配置 Key 时使用本地 FAQ / 算法；配置后自动启用 RAG 与 Workflow 增强。

## 背景

MVP 包含 AI 知识库、补货预测、缺货预警等功能。本地 Docker 已安装 Dify，但 MVP 阶段优先落地妙搭兼容业务系统。

## 决策

**MVP 阶段：妙搭 + 本地 TS 算法**

| 功能 | 默认（无 Key） | 配置 Dify Key 后 |
|------|----------------|------------------|
| 业务 CRUD / 权限 / 导入 | 妙搭（本地 Hono） | 不变 |
| 安全库存 / 补货数量 | 本地 EOQ/ROP | 不变（数量仍本地） |
| 补货建议文案 | 本地 reason 模板 | Dify Workflow 增强 |
| 缺货预警 | 本地规则 + 飞书模板 | Dify 摘要 + 飞书 |
| AI 知识库 | 本地 FAQ + SKU 上下文 | Dify RAG |
| 飞书审批 | 不做 | aily（Phase 3） |

**三平台分工（目标态）：**

```
妙搭（业务） ──HTTP──▶ Dify（AI，本地已有） ──▶ aily（飞书原生）
```

MVP 实现妙搭业务 + 可选 Dify 增强；aily 审批留 Phase 3。

## Dify 对接支持

- **已接通**：REST API（Chat + Workflow），见 `apps/web/server/integrations/dify.ts`、`dify-workflows.ts`
- **启用说明**：[dify-integration-readiness.md](../dify-integration-readiness.md)、[dify/setup-guide.md](../dify/setup-guide.md)
- **启用条件**：配置 `DIFY_API_KEY_*` 环境变量；留空则全本地

## 后续扩展

- Phase 2（Dify）：知识库 RAG + 补货/预警 Workflow — **代码已落地，按 Key 启用**
- Phase 3：aily 审批流、ERP API 对接
