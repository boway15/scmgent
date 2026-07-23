# 采购列表飞书定时拉取设计

## 1. 背景与目标

「大件备货申请」「采购跟单」已支持手动「从飞书同步 / 同步到飞书」及对应预览。  
本期补齐：**每天 08:00（中国时区）分别从飞书全量拉取两张表到本地**。

## 2. 决策

| 项 | 选择 |
|----|------|
| 任务形态 | **两个独立 Cron**（可单独重跑/排障） |
| 冲突策略 | **跳过并记失败**（同表已有 push 或 pull 在跑） |
| 实现模式 | HTTP 任务 + `X-Cron-Secret`（对齐现有 tasks） |
| 数据语义 | 与手动「从飞书同步」相同：全量覆盖本地 |

## 3. API

| 任务 | Cron | Endpoint |
|------|------|----------|
| 大件备货从飞书拉取 | `0 8 * * *` | `POST /api/tasks/procurement-bulk-stock-pull` |
| 采购跟单从飞书拉取 | `0 8 * * *` | `POST /api/tasks/procurement-follow-up-pull` |

Header：`X-Cron-Secret: {CRON_SECRET}`

## 4. 行为细节

- `task_runs.taskName`：`procurement_bulk_stock_pull` / `procurement_follow_up_pull`
- `triggeredBy`：定时为 `cron`；手动调试同现有任务
- `lastSyncBy`：定时写入哨兵值 `cron`
- 未配置多维表格：失败，不写空表
- 同表 push/pull 已有 `running`：结束本 run 为 failed，文案说明冲突跳过
- 手动「从飞书同步」「同步到飞书」启动前同样做互斥检查；手动拉取期间也记 `task_runs`，避免与定时互踩

## 5. 非范围

- 不改页面按钮与推送全量覆盖语义
- 不引入进程内 node-cron
- 不合并为单一「两表一起拉」API

## 6. 文档

在 `docs/miaoda-import-checklist.md`、`docs/feishu-bitable-sync.md` 补充上述两条自动化任务。
