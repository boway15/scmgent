# Task 5 Acceptance (code-level)

Date: 2026-08-12
HEAD: 7db3457

## Checklist (from plan)

| 场景 | 结果 | 证据 |
|------|------|------|
| draft + `?view=accuracy` | PASS (code) | `isViewAllowed` includes draft; availableViews push accuracy for draft |
| 地平线含当月 → 进行中 | PASS (unit) | forecast-qty-totals.test.ts in_progress case |
| 全过去月、无销量 → `-` | PASS (unit) | empty_actual case |
| 有预测与销量 → 数字比 | PASS (unit) | ready formats thousands |
| 运行回测绑当前 versionId | PASS (code) | backtest mutation `versionId` only |
| 无走步 UI | PASS (code) | no WalkForward / walkForward in detail page |
| 列表无新列；草稿准确率 `-` | PASS (code) | ListPage accuracy column unchanged; 复盘 link added |
| qty-totals API | PASS (code) | route registered |
| unit tests | 7/7 PASS | tsx --test forecast-qty-totals.test.ts |

## Live UI / DB

Not exercised in this session (no browser / no backtest against live DB). Recommend smoke: open historical-startMonth draft → 准确率复盘 → confirm label + run 回测.

## Spec

Marked `已实现` in docs/superpowers/specs/2026-08-12-forecast-accuracy-detail-totals-design.md (commit 7db3457)
