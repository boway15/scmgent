# 系统设置 · 定时任务页（只读运维）

**日期**：2026-07-24  
**状态**：已采纳  
**前置**：`2026-07-24-self-hosted-cron-sidecar-design.md`

## 目标

在「系统设置」增加定时任务运维页：展示 sidecar 任务目录、最近 `task_runs`，并支持超管「立即执行」。**不**在 UI 修改 Cron。

## 范围

| 项 | 内容 |
|----|------|
| 路由 | `/system/tasks` |
| 菜单 | `system.tasks`「定时任务」，挂在 `system` 下；默认赋给 `super_admin` |
| 权限 | 仅超管可看/可触发（与操作日志同级） |
| 目录 | 与 `deploy/cron/crontab` 对齐的 6 条任务（静态配置） |
| 记录 | 最近 N 条 `task_runs` |
| 触发 | `POST /api/tasks/*`（会话超管或 `X-Cron-Secret`） |

## API

- 调整 `requireCronSecret`：**已登录 `super_admin` 始终可过**（不依赖 `AUTH_DEV` / bypass）；保留 Header 密钥路径给 sidecar。
- `GET /api/tasks/runs`、各 `POST` 沿用现有路由。

## UI

- 上：任务表（名称、Cron 释义、立即执行）
- 下：运行记录表（刷新）；长任务提示「已启动，请刷新查看」
- 对齐 `AuditLogsPage` / `PageHeader` 风格

## 非目标

- UI 改 Cron / 开关任务
- WebSocket 进度
- 非超管角色默认授权

## 验收

- [x] 菜单可见（超管 seed 后）
- [x] 列表展示 6 任务 + 最近 runs（页面已上线）
- [x] 超管会话可过 `requireCronSecret`（不依赖 AUTH_BYPASS）
- [ ] 浏览器点「立即执行」冒烟（请本地超管登录验证）
- [x] 无密钥的非超管无法调用（仍走 401）
