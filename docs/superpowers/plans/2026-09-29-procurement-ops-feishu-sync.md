# 采购运营 × 飞书同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 库存运营下新增「采购运营」只读日快照页，每天 06:00 从飞书 `tblWUnYLwD8UATAS` 拉取。

**Architecture:** 平行于库存查询：`procurement_ops_*` 表 + `procurement-ops-pull` 任务 + `/inventory/procurement-ops` 页面。

**Tech Stack:** PostgreSQL、Drizzle、Hono、React、Compose cron。

**Spec:** `docs/superpowers/specs/2026-09-29-procurement-ops-feishu-sync-design.md`

## Global Constraints

- Env：`FEISHU_BITABLE_TABLE_PROCUREMENT_OPS=tblWUnYLwD8UATAS`；Token 与库存总览相同。
- Cron：`0 6 * * *` → `POST /api/tasks/procurement-ops-pull`；`taskName=procurement_ops_pull`。
- 不回写飞书、不写 `inventory_records`、不驱动补货。

---

## 上线检查

1. `pnpm db:migrate`（0108 + 0109）
2. `.env` 增加 `FEISHU_BITABLE_TABLE_PROCUREMENT_OPS`
3. 重启 `web` + `cron`
4. 系统任务页触发「采购运营飞书拉取」
5. 打开 `/inventory/procurement-ops` 验证
