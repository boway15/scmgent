# 自建 Cron Sidecar Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Compose 增加 cron sidecar，按表 HTTP 触发 `/api/tasks/*`；web 统一监听/映射 **8081**（不用宿主机 8080）。

**Architecture:** Alpine + supercronic + curl；`CRON_BASE_URL=http://web:8081`；业务仍走现有 task 路由与 `task_runs`。

**Tech Stack:** Docker Compose、supercronic、curl、Asia/Shanghai

## Global Constraints

- 宿主机只暴露 **8081**；cron **无 ports**
- 容器内 web `PORT=8081`，映射 `8081:8081`
- 补货预测：`0 9 * * 1`；跟单拉取：`5 8 * * *`
- 不引入进程内 node-cron；不改任务业务逻辑

---

### Task 1: deploy/cron 镜像与 crontab

**Files:**
- Create `deploy/cron/Dockerfile`
- Create `deploy/cron/crontab`
- Create `deploy/cron/run-task.sh`
- Create `deploy/cron/docker-entrypoint.sh`

- [ ] 实现上述文件（`CRON_ENABLED=false` 时 sleep 不调度）
- [ ] crontab 含 B 档 6 条任务

### Task 2: compose + web 端口 8081

**Files:**
- Modify `docker-compose.yml`
- Modify `Dockerfile`
- Modify `deploy/dedicated-host/cloudflared.config.example.yml`（注释）
- Modify `z-docker-ops.md`（端口说明）

- [ ] web `ports: 8081:8081`，`PORT: 8081`
- [ ] 增加 `cron` service（depends_on web，共享 `CRON_SECRET`）

### Task 3: 文档

**Files:**
- `README.md`、`docs/local-server-release-sop.md`、`docs/miaoda-import-checklist.md` §七、`docs/feishu-bitable-sync.md`、spec 状态

- [ ] 文档写明 sidecar + 每周一 09:00 补货
- [ ] spec 标为已实现

### Task 4: 验证

- [ ] `docker compose config` 通过
- [ ] 构建 cron 镜像；若环境可起栈则手动 curl 一条任务
