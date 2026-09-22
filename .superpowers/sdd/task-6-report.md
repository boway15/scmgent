# Task 6 Report: 单页产品成本核算工具

## Status
DONE

## Commit
`647760c` — `feat(costing): add single-page costing tool UI`

## Verification
- `pnpm build`：成功（2347 modules transformed）。
- IDE lint：本任务 6 个文件无错误；目标文件 `git diff --check` 通过。
- 全量 `tsc` 仍有仓库既有错误，输出中无本任务文件。
- 按 brief 静态复核：单路由、唯一实心「解析」且 disabled、价目折叠/增改导入、BOM 分组失焦保存、高亮、看板与 localStorage key 均已落实。

## Concerns
- 未登录浏览器或连接 PostgreSQL 做 CRUD 集成验收。

## Review Fixes
- 价目新增、修改、停用、导入成功后同时失效当前 `costing-project` 查询，实时刷新成本与看板。
- 使用现有 `useCurrentUser` 的 `viewer` 角色判定，隐藏或禁用项目、价目与 BOM 写操作。
