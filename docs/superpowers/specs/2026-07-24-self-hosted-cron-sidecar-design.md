# 自建定时任务调度（Compose Sidecar）

**日期**：2026-07-24  
**状态**：已实现  
**前置**：`2026-07-24-de-miaoda-docs-baseline-design.md`（不再依赖妙搭 Cron）

## 目标

在 Docker Compose 中增加独立 **cron sidecar**，按表调用现有 `POST /api/tasks/*`（Header `X-Cron-Secret`），覆盖选项 **B** 数据/运维任务；补货预测为 **每周一 09:00**。

## 端口约束（硬性）

| 场景 | 地址 | 说明 |
|------|------|------|
| 宿主机浏览器 / Tunnel | **`http://…:8081`** | 对外只暴露 **8081**；**不占用宿主机 8080** |
| Sidecar → web | `http://web:8081` | Compose 内网服务名；**不映射任何宿主机端口** |
| web 容器监听 | `PORT=8081` | 与对外端口对齐，避免文档/配置再出现 8080 |

实现时将现有 `8081:8080` / 容器内 `PORT=8080` **统一改为 `8081:8081` / `PORT=8081`**（Dockerfile `EXPOSE` 同步）。Cron 服务 **无 `ports:`**。

## 架构

```
┌─────────────────────────────────────────────┐
│ docker compose network                      │
│                                             │
│  cron (supercronic + curl)                  │
│    TZ=Asia/Shanghai                         │
│    POST http://web:8081/api/tasks/...       │
│         Header: X-Cron-Secret               │
│              │                              │
│              ▼                              │
│  web (scm-agent) :8081  ←── host 8081       │
│    → task_runs / 业务逻辑                   │
└─────────────────────────────────────────────┘
```

- 调度器与业务进程分离；web 重启不丢 crontab 文件（在镜像/挂载中）。
- 失败：sidecar 打日志并带非零 exit（由 supercronic 记录）；业务成败仍以 `task_runs` 为准。
- 互斥：沿用现有 pull 任务 skip/409 逻辑。

## v1 任务表（Asia/Shanghai）

| 任务 | Cron | Path |
|------|------|------|
| 缺货预警 | `0 7 * * *` | `/api/tasks/stock-alert` |
| 库存周转拉取 | `30 7 * * *` | `/api/tasks/inventory-turnover-pull` |
| 跨境资讯 | `0 8 * * *` | `/api/tasks/news-ingest` |
| 大件备货拉取 | `0 8 * * *` | `/api/tasks/procurement-bulk-stock-pull` |
| 采购跟单拉取 | `5 8 * * *` | `/api/tasks/procurement-follow-up-pull` |
| 补货预测 | `0 9 * * 1` | `/api/tasks/replenishment-forecast` |

说明：跟单拉取相对大件备货错开 5 分钟，降低同秒双飞书压力。

## 配置

| 变量 | 用途 | 默认 |
|------|------|------|
| `CRON_SECRET` | 与 web 相同，注入 sidecar | 必填（与现网一致） |
| `CRON_BASE_URL` | sidecar 目标根 URL | `http://web:8081` |
| `CRON_ENABLED` | `false` 时 sidecar 空转/不启 | compose 默认启用；本地可关 |
| `TZ` | 时区 | `Asia/Shanghai` |

本地若不想跑定时：`docker compose stop cron` 或 profile `cron`（实现时二选一，优先 **独立 service + 默认 up 带上**，文档说明如何停）。

## 实现清单（实现阶段）

1. `deploy/cron/crontab`（或 `apps/web/deploy/cron/`）— supercronic 格式条目  
2. `deploy/cron/run-task.sh` — `curl -fsS -X POST -H "X-Cron-Secret: …" "$CRON_BASE_URL$path"`  
3. `docker-compose.yml` — `cron` service（`curlimages/curl` 不够跑 supercronic；选用 `ghcr.io/aptible/supercronic` 或 `alpine`+安装；**推荐** 轻量自定义 Dockerfile based on alpine + supercronic + curl）  
4. web 端口统一 8081（compose + Dockerfile）  
5. 更新 `docs/local-server-release-sop.md`、归档清单第七节、`README` 定时任务段  
6. 冒烟：`docker compose exec cron` 手动跑一条 curl，或临时改 cron 为近分钟验证 `task_runs`

## 非目标

- 不引入进程内 `node-cron`
- 不改任务业务逻辑（除文档 Cron 时刻）
- 不做失败告警通道（飞书）— 可后续加
- 不启用选项 C 中未列任务（日流水线、销量维护等）

## 验收

- [x] `docker compose ps` 可见 `cron`，无宿主机 8080 占用；web 为 `8081:8081`
- [x] 宿主机访问仍为 **8081**
- [x] 手动 `run-task.sh` 可触发任务（见实现验证）
- [x] 文档中补货预测为每周一 **09:00**
