---
name: feishu-aily-agent
description: >-
  飞书 aily 智能体与工作流开发指南。Use when building supply chain AI agents,
  aily workflows, knowledge Q&A, MCP connectors, or integrating agents with
  the self-hosted scm-agent app via HTTP/Feishu API.
---

# 飞书 aily 开发指南

> 业务应用部署在 **自建 Docker**（非妙搭）。aily 通过 HTTP 调用 scm-agent API。

## 三平台分工

| 功能 | scm-agent（自建） | Dify | aily |
|------|-------------------|------|------|
| 业务 CRUD / 数据库 | ✅ | — | — |
| AI 知识库 / RAG | — | ✅ | 基础 |
| 补货预测工作流 | ✅ 本地算法 / 可选 Dify | ✅ | — |
| 缺货预警计算 | ✅ `/api/tasks/*` | ✅ | — |
| 飞书群消息推送 | ✅ 飞书开放 API | HTTP 节点 | ✅ 原生 |
| **飞书审批流** | — | — | ✅ 原生 |
| 定时任务 | ✅ HTTP + 外部调度（待自建） | ✅ 定时触发 | — |

**aily 核心价值**：飞书原生的审批流和复杂群机器人场景。若无审批需求，可由 scm-agent 或 Dify 直接推飞书消息。

## 四种对话模式（按场景选择）

| 模式 | 本项目适用场景 |
|------|----------------|
| 工作流 | 采购审批通知、预警通报（确定性流程） |
| 知识问答 | 备用：若不用 Dify，基础 SOP 问答 |
| 混合调度 | 多技能组合查询 |
| 模型推理 | 开放问答兜底 |

## 供应链审批工作流示例

```
采购单提交（scm-agent Webhook / 业务事件）
  → HTTP(GET 采购单详情 from scm-agent API)
  → 条件分支(金额 > 10万?)
    → 是: 飞书审批节点(发送审批给总监)
          → 审批通过: HTTP(PUT scm-agent /api/po/{id}/approve)
          → 审批拒绝: HTTP(PUT scm-agent /api/po/{id}/reject)
    → 否: HTTP(PUT scm-agent /api/po/{id}/auto-approve)
  → 飞书消息(通知采购员结果)
```

## 与自建 scm-agent 集成

1. 外部调度或业务事件触发 aily Webhook
2. aily 工作流调用 scm-agent REST API 读写业务数据（`APP_BASE_URL` + 鉴权）
3. aily 飞书技能推送通知至目标群/用户

## 开发约束

- MVP 阶段审批流若不紧急，**优先用 scm-agent / 飞书开放 API** 完成消息推送
- aily 不支持自托管，数据流经飞书云（注意敏感数据脱敏）
- aily 工作流可逐步替代 Dify，取决于 aily RAG 能力演进
- **不要**默认对接妙搭「自动化任务」或 ZIP 导入路径
