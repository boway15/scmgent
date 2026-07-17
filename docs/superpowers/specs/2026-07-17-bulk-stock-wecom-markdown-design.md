# 大件备货企微推送 · Markdown + 日历超期

## 背景

大件备货「待供应商确认」提醒需 Markdown 推送，并按日历天数判定超期（非滚动小时）。

## 决策

- 企微 `msgtype: markdown`；拆条标题带 `(续N)`
- 超期规则：**不计今天**，超过 N 天（环境变量 `DAYS_THRESHOLD`，默认 2）
  - 例：今天 7/17、N=2 → 统计 **7/14 及之前**
  - `cutoff_ms` = 上海时区「今天 − N 日」00:00:00（不含）；`push_ms < cutoff` 命中
- 推送标题：`大件备货申请·待供应商确认超{N}天`

## 改动文件

- `docs/dify/workflows/bulk-stock-wecom-alert.yml`
- `docs/dify/workflows/bulk-stock-wecom-alert-setup.md`
