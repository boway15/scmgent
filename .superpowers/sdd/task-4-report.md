# Task 4 Report: 离线 7 月复盘 + 收尾

## Status

**DONE**

## Summary

修复 `validate-july-t4b-relax.ts`：移除 T99 硬编码 `return 0`，改为与其它分层一样调用 `computeAllCatV41BoundedDaily`；启动时打印方案 A 常量。设计 spec 状态改为「已实现」。本机 Docker/DB 可用，离线复盘已成功执行。

## Implementation

### `apps/web/scripts/validate-july-t4b-relax.ts`
- 文件头注释改为「T4B+T99 方案 A 常量复盘」。
- 导入 `V41_T4B_*` 与 `T99_SYSTEM_FLOOR_DISCOUNT`，`main` 开头 `console.log('constants', …)`。
- 删除 `recompute` 中 `if (tier === 'T99') return 0`。
- 报告标题改为「旧系统 vs T4B+T99 方案 A」。

### `docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md`
- 状态：`已批准设计` → `已实现`。

## Offline validate

**Ran** — `pnpm --filter @scm/web exec tsx scripts/validate-july-t4b-relax.ts`（exit 0）

关键输出：
- constants: T4B_near=0.9, T4B_far=0.75, T4B_r30_cap=0.95, T4B_r90_cap=1, T99_discount=0.8
- T4B: 旧偏差 -67.1% → 新偏差 -45.6%（WMAPE 72.1% → 58.5%）
- 全体: 旧偏差 -42.3% → 新偏差 -27.1%
- T99 漏报（系统=0 有实际）: 1659 行 / 32281 月销量（主查询 `forecast_daily_avg > 0` 不含此类行，分层表未出现 T99 行）

## Commit

- `46c5f1f` — `chore(forecast): validate July T4B/T99 plan-A relax offline`
- 仅 stage：脚本、spec、plan（未含其它 dirty 文件）

## Verification

- [x] T99 走真实 `computeAllCatV41BoundedDaily` 分支
- [x] 启动打印 Plan A 常量
- [x] spec 状态已更新
- [x] 离线脚本可运行（Docker/Postgres 可用）
- [x] Lint 无新增问题

## Concerns

- 7 月 published 行中 T99 几乎均为 `forecast_daily_avg=0`，分层表看不到 T99 重算效果；需新生成版本或放宽查询条件才能量化 T99 抬升。
- T99 漏报 1659 行仍大，方案 B（漏报闸）是否开启留待业务判断。
