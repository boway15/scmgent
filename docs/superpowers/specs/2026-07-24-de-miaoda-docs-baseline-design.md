# 去妙搭化文档基线（方案 1）

**日期**：2026-07-24  
**状态**：已采纳（文档层）  
**范围**：入口文档 / Cursor Rule & Skill / 运维清单口径；**不含**删除 ZIP/CJS 脚本或实现自建 Cron。

## 背景

- 生产已走 Win11 专用机 + Docker Compose + Cloudflare Tunnel（见 `docs/local-server-release-sop.md`）。
- 妙搭 ZIP 导入与 CJS 双轨迭代成本过高，**当前未对接、后续无计划对接妙搭**。
- 定时任务仍为「HTTP + `X-Cron-Secret`」形态，原假定由妙搭「自动化任务」触发；自建调度另立实现。

## 决策

| 项 | 决定 |
|----|------|
| 默认部署目标 | 自建 Docker（专用机 / 本地 Compose） |
| 妙搭 ZIP / `hono-app` CJS / 相关脚本 | **保留代码**，文档标「已停用 / 历史归档」 |
| Agent 默认行为 | 不为新功能准备妙搭导入；PRD/开发面向 `apps/web/server` + Docker |
| 定时任务文档 | 列出 Cron 建议与 API；明确调度器待自建补齐 |

## 非目标（本次）

- 不删除 `pnpm zip:miaoda`、`miaoda-cjs-transform`、`apps/web/miaoda/`
- 不实现 node-cron / compose sidecar / Windows Task Scheduler
- 不物理搬迁文件到 `docs/archive/`

## 相关入口

- 日常发布：`docs/local-server-release-sop.md`
- 首次装机：`docs/dedicated-host-server-checklist.md`
- 任务 API：`apps/web/server/routes/tasks.ts`、`apps/web/server/tasks/`
