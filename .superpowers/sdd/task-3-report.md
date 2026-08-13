# Task 3 Report: UI 文案同步 ×0.6→×0.8

## Status

**DONE**

## Summary

T99 保守保底折扣 UI 文案由 `max(近30,近90)×0.6` 同步为 `max(近30,近90)×0.8`，与 Task 1 后端 `V41_T99_FLOOR_DISCOUNT = 0.8` 一致。仅改 brief 指定的两处展示文案；全库扫描无业务文案残留。

## Files Modified

| File | Change |
|------|--------|
| `apps/web/src/components/ForecastStrategySection.tsx` | 策略表 T99 行：`max(近30,近90)×0.6` → `×0.8`（远月 `×0.72` 不变） |
| `apps/web/src/pages/SalesForecastListPage.tsx` | 列表说明 T99 括号内：`max(近30,近90)×0.6` → `×0.8`（整句其余不变） |

## Scan (Step 2)

命令（在 `apps/web`）：

```bash
rg "近90\)×0\.6|recent90\)\*0\.6|max\(近30,近90\)×0\.6" -g "*.ts" -g "*.tsx"
```

结果：**无命中**（exit 1 = no matches）。符合 brief 预期：无业务文案残留；`recent_max06` 枚举名等可保留。

## Commit

| SHA | Subject |
|-----|---------|
| `2874345` | docs(forecast): sync T99 UI copy to 0.8 floor discount |

Commit scope：仅上述 2 个 UI 文件（2 insertions, 2 deletions）。

## Verification

- 两处文案已改为 `×0.8`。
- 未触碰后端常量、测试或其它 dirty 工作区文件。
- 无新增 API；纯展示文案与后端折扣对齐。

## Concerns

- 无。若后续 Task 4+ 改 horizon column help 或其它页面 T99 说明，需单独核对；本次扫描模式未覆盖非 `×0.6` 表述的 T99 文案。
