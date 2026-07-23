# 采购列表飞书定时拉取 Implementation Plan

> **For agentic workers:** 按任务逐步执行；每步完成后打勾。

**Goal:** 为大件备货申请、采购跟单各增加独立的每日 08:00 从飞书全量拉取任务，并与手动推送/拉取互斥。

**Architecture:** 复用 `executeProcurementFeishuSync`；新增两个 `/api/tasks/*-pull` 路由与 `task_runs` 名称；共享 push/pull 互斥检查。

**Tech Stack:** Hono routes、现有 `task-runs`、node:test

## File map

- `apps/web/server/lib/task-runs.ts` — 增加 pull task names
- `apps/web/server/lib/procurement-feishu-sync-lock.ts` — 共享互斥
- `apps/web/server/lib/procurement-feishu-pull-task.ts` — pull task 名称与 runner
- `apps/web/server/tasks/procurementFeishuPull.ts` — cron 入口封装（可选，可内联 routes）
- `apps/web/server/routes/tasks.ts` — 注册两个 endpoint
- `apps/web/server/routes/procurement-lists.ts` — 手动 sync/push 互斥
- `apps/web/server/lib/procurement-feishu-push-task.ts` — 改用共享互斥
- 测试与文档

## Tasks

1. 写互斥 + task name 单测（失败先红）
2. 实现 lock / pull-task / task-runs 扩展
3. 挂 routes（cron + 手动 sync 记 running）
4. 更新文档 Cron 表
5. 跑相关测试
