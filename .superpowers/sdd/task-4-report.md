# Task 4 Report: 月列表页真分页 + 创建人列 + 附属查询

**Status:** 完成  
**Commits:** none（按要求未提交）

## Summary
- 月列表改为服务端 `page` / `pageSize` / `status` / `q`，表格用 `data.items`，分页用 `data.total`；创建人列在「创建 / 发布」前，空值显示「—」。
- 页头最新已发布、旧 tab（publish/insights）与校准导入改为 `pageSize=1` 的按需查询，不再在全量数组里 find。
- 策略区草稿与详情页已发布合并判断分别改为 `pageSize=1` / `pageSize=100` 并读 `.items`。`apps/web/src` 无其它调用点。

## Concerns
- 最新已发布跟随接口 `createdAt` 倒序，不再按 `publishedAt` 客户端排序。
- 已发布查询未成功时不展示「尚无已发布」提示，insights 旧链接也不会清掉 tab。
- 详情合并只取已发布前 100 条；有任意一条即视为可合并，与原先「存在其它已发布版本」等价。

**Report path:** `.superpowers/sdd/task-4-report.md`
