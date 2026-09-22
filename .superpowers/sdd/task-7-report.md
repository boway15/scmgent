# Task 7 Report: 解析流水线

## Status
- 完成筛页、压图、默认单页分批调用 Dify，并按批持久化清单与进度。
- 整单首批成功后才清理旧 AI 行；失败保留已成功批次，错误包含页码。
- 完成解析端点、页图端点、前端 2 秒轮询/失败重试与 Docker 持久卷配置。

## Verification
- 产品成本核算测试：42 passed。
- `vite build`：通过。
- 解析模块 strict TypeScript 检查：通过。
- `docker compose config --quiet`：通过。
- 全仓 `tsc -b` 仍有既存类型/NestJS 依赖错误；Task 7 新增模块无类型错误。

## Commit
- `feat(costing): extract BOM in filtered one-page Dify batches`

## Important Review Fixes
- `startExtractRun` 在事务内锁定核算项目，并查询同项目 `pending` / `running` 任务；项目为 `extracting` 或存在活动任务时返回 409「正在解析中，请稍候」。
- 解析轮询进入 `failed` 后刷新当前核算项目及项目列表，使前端展示失败前已持久化的清单行。
- 新增 `hasActiveExtractRun` 单元测试；`pnpm exec tsx --test server/lib/product-costing/extract-batches.test.ts`：4 passed。
