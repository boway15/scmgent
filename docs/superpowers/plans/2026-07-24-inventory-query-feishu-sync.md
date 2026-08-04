# 库存查询 × 飞书明细同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立「库存查询」菜单与页面，每日 07:20 从飞书明细表拉取并按日归档，展示各仓库存明细；不改库存总览口径。

**Architecture:** 平行于库存总览快照：独立表 `inventory_query_snapshot_runs` + `inventory_query_daily_snapshots`；专用拉取任务直接 list 飞书整表 → 扁平化 payload → 发布快照（不走 `inventory_turnover` import / 不写 `inventory_records`）。前端新页只读快照 API。

**Tech Stack:** PostgreSQL、Drizzle ORM、Hono、React、TanStack Query、Node `tsx --test`、Compose cron sidecar。

**Status:** 已在本会话内联实现（2026-07-24）。上线前需：配置 env、执行 migrate `0048`/`0049`、重启 web+cron。

## Global Constraints

- 数据源：Base `HPJzbHdPea7elSs92T8c31BTnxe`，表 `tblubb08s6pe6DXI`（整表拉取，不按视图过滤）。
- Env：`FEISHU_BITABLE_TABLE_INVENTORY_QUERY=tblubb08s6pe6DXI`；App Token 与总览相同（优先 `FEISHU_BITABLE_PROCUREMENT_APP_TOKEN`）。
- Cron：`20 7 * * *` → `POST /api/tasks/inventory-query-pull`；`taskName=inventory_query_pull`。
- Spec：`docs/superpowers/specs/2026-07-24-inventory-query-feishu-sync-design.md`

---

### Task 1: Schema + 快照发布模型 — DONE

### Task 2: 飞书拉取任务（不写 inventory_records） — DONE

### Task 3: 读 API（列表 / 日期 / 导出） — DONE

### Task 4: 菜单 / 路由 / 前端页面 — DONE

### Task 5: 文档与验收收尾 — DONE

## 上线检查

1. `.env` 增加 `FEISHU_BITABLE_TABLE_INVENTORY_QUERY=tblubb08s6pe6DXI`
2. `pnpm db:migrate`（0048 + 0049）
3. 重启 `web` + `cron`
4. 系统任务页触发「库存查询从飞书拉取」冒烟
5. 打开 `/inventory/query` 验证列表与分仓列
