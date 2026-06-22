# 跨境电商供应链智能体平台 (SCM Agent)

面向飞书妙搭部署的跨境电商供应链智能体平台。本地在 Cursor 中开发，最终通过 ZIP 导入飞书妙搭运行。

> **命名说明**：「飞书秒搭」即官方产品 **飞书妙搭（Miaoda）**。

---

## 技术栈

| 层级 | 选型 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS |
| 后端 | Node.js + Hono + TypeScript |
| 数据库 | PostgreSQL + Drizzle ORM |
| 包管理 | pnpm |
| AI 引擎 | **本地 FAQ 助手（Dify RAG 预留）** |

### MVP 架构

```
飞书妙搭（目标运行）
  ├── 业务 CRUD + 权限菜单
  ├── 经营看板 + 销量历史查询
  ├── 本地 TS 算法（EOQ/ROP/缺货预警）
  ├── CSV 导入
  └── 自动化任务（Cron）

Dify（本地 Docker 已有）── 架构预留，后续 Phase 启用
```

---

## 快速开始

### 方式一：Docker 运行（推荐）

```bash
docker compose up -d --build
# 或
pnpm docker:up
```

浏览器访问：**http://localhost:8081**（宿主机 8080 常被 Dify 等占用，本项目默认映射 8081）

### 方式二：本地开发

```bash
pnpm install
docker compose up -d postgres
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev
```

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

**安全与多仓（迭代 5–6）**：`ENFORCE_RBAC=true` 启用菜单级 API 权限；`CRON_SECRET` 保护定时任务；安全库存/预警支持 `warehouse_code`。

---

## 妙搭导入

```bash
pnpm zip:miaoda
# 产出 apps/web/scm-agent-miaoda.zip
# 妙搭「新建应用」→ 导入 ZIP → 按 ZIP 内 miaoda/MIAODA-SETUP.md 四步配置
```

**新版本发布**（新建应用即用）：[docs/miaoda-new-app-release.md](docs/miaoda-new-app-release.md)  
完整验收与避坑：[docs/miaoda-import-checklist.md](docs/miaoda-import-checklist.md)

演示数据见 [docs/samples/import/README.md](docs/samples/import/README.md)。

---

## 目录结构

```
scm-agent/
├── apps/web/           # React + Hono 主应用
├── packages/db/        # Drizzle Schema + 迁移
├── docs/prd/           # 产品需求文档
└── docker-compose.yml
```
