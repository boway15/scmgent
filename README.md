# 跨境电商供应链智能体平台 (SCM Agent)

自建 Docker 部署的跨境电商供应链智能体平台。本地在 Cursor 中开发，生产运行于 **Win11 专用机 + Docker Compose + Cloudflare Tunnel**。

> **部署基线**：日常发布见 [docs/local-server-release-sop.md](docs/local-server-release-sop.md)。  
> **当前版本**：v1.0.2 — 迭代说明见 [CHANGELOG.md](CHANGELOG.md)。  
> **妙搭**：ZIP / CJS 双轨路径**已停用**（无后续对接计划）；历史材料仅作归档，见文末。

---

## 技术栈

| 层级 | 选型 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS |
| 后端 | Node.js + Hono + TypeScript（`apps/web/server`） |
| 数据库 | PostgreSQL + Drizzle ORM |
| 包管理 | pnpm |
| AI 引擎 | **本地 FAQ + 可选 Dify RAG/Workflow** |

### MVP 架构

```
自建 Docker（目标运行）
  ├── 业务 CRUD + 权限菜单
  ├── 经营看板 + 销量历史查询
  ├── 本地 TS 算法（EOQ/ROP/缺货预警）
  ├── CSV / 飞书多维表格同步
  └── 定时任务 Compose cron → HTTP /api/tasks/*

Dify（可选）── RAG / Workflow
```

---

## 快速开始

### 方式一：Docker 运行（推荐）

```bash
docker compose up -d --build
# 或
pnpm docker:up
```

浏览器访问：**http://localhost:8081**（容器与宿主机均为 8081；不占用 8080）

### 方式二：本地开发

```bash
pnpm install
docker compose up -d postgres
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev
```

### 生产专用机

首次装机：[docs/dedicated-host-server-checklist.md](docs/dedicated-host-server-checklist.md)  
日常发布：[docs/local-server-release-sop.md](docs/local-server-release-sop.md)

---

## MVP 功能

| 模块 | 路由 | 说明 |
|------|------|------|
| 经营看板 | `/dashboard` | KPI + 今日待办（登录默认首页） |
| 角色 + 自定义菜单 | `/system/roles` | 按角色配置可见菜单 |
| 商品主数据 | `/data/products` | SPU / SKU / 商家 |
| 销量历史 | `/data/sales` | 查询导入的销量，核对算法输入 |
| 数据导入 | `/data/import` | 家居品类 Demo CSV（厨房/客厅/卧室等） |
| 库存总览 | `/inventory/overview` | 多仓库存 + 问 AI |
| 安全库存 | `/inventory/safety` | 手动 / EOQ 计算 |
| 缺货预警 | `/inventory/alerts` | 摘要 + 跳转补货建议 |
| 补货建议 | `/pmc/suggestions` | 本地预测 + 合并 PMC 计划 |
| PMC 需求计划 | `/pmc/list` | 导出 CSV 下发商家 |
| 采购跟单 | `/pmc/tracking` | 内部履约台账（非采购单） |
| 合规管理 | `/compliance/overview` | 完整性看板 + SKU 维护 |
| FOB 分账 | `/logistics/fob-settlement` | 头程费用分摊 |
| AI 助手 | `/ai/chat` | 本地 FAQ + SKU 上下文 |

**安全与多仓**：`ENFORCE_RBAC=true` 启用菜单级 API 权限；`CRON_SECRET` 保护定时任务 HTTP；安全库存/预警支持 `warehouse_code`。

---

## 定时任务（Compose cron sidecar）

调度器：`deploy/cron`（supercronic），内网调用 `http://web:8081`（**不占宿主机 8080**；对外仍为 **8081**）。  
Header：`X-Cron-Secret`（与 `CRON_SECRET` 一致）。时区：`Asia/Shanghai`。

| 任务 | Cron | API |
|------|------|-----|
| 缺货预警 | `0 7 * * *` | `POST /api/tasks/stock-alert` |
| 库存周转拉取 | `30 7 * * *` | `POST /api/tasks/inventory-turnover-pull` |
| 跨境资讯 | `0 8 * * *` | `POST /api/tasks/news-ingest` |
| 大件备货拉取 | `0 8 * * *` | `POST /api/tasks/procurement-bulk-stock-pull` |
| 采购跟单拉取 | `5 8 * * *` | `POST /api/tasks/procurement-follow-up-pull` |
| 补货预测 | `0 9 * * 1`（每周一） | `POST /api/tasks/replenishment-forecast` |

跨境资讯研究每天 08:00 自动运行，组合查询型新闻源与官方 RSS 发现候选；普通正文提取不足时可按 `NEWS_INTEL_BROWSER_ENABLED` 配置按需启动镜像内 Chromium。候选默认进入人工审核，采用后才同步飞书多维表格；可选 Dify 负责内容增强。该流程不依赖 RSSHub 常驻服务，管理页仍可手动重试当日采集。

停调度：`docker compose stop cron` 或设 `CRON_ENABLED=false`。  
手动调试：

```bash
curl -X POST http://localhost:8081/api/tasks/stock-alert \
  -H "X-Cron-Secret: $CRON_SECRET"
# 或
docker compose exec cron /usr/local/bin/run-task.sh /api/tasks/stock-alert
```

设计说明：[docs/superpowers/specs/2026-07-24-self-hosted-cron-sidecar-design.md](docs/superpowers/specs/2026-07-24-self-hosted-cron-sidecar-design.md)

演示数据见 [docs/samples/import/README.md](docs/samples/import/README.md)。

---

## 目录结构

```
scm-agent/
├── apps/web/           # React + Hono 主应用（生产入口）
├── packages/db/        # Drizzle Schema + 迁移
├── docs/               # 产品 / 运维 / 设计文档
└── docker-compose.yml
```

---

## 归档：飞书妙搭（已停用）

以下仅历史参考，**请勿作为新功能或发布默认路径**：

- `pnpm zip:miaoda` / `apps/web/miaoda/` / CJS `hono-app` 转换脚本
- [docs/miaoda-new-app-release.md](docs/miaoda-new-app-release.md)
- [docs/miaoda-import-checklist.md](docs/miaoda-import-checklist.md)
- 决策记录：[docs/superpowers/specs/2026-07-24-de-miaoda-docs-baseline-design.md](docs/superpowers/specs/2026-07-24-de-miaoda-docs-baseline-design.md)
