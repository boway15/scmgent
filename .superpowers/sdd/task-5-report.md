# Task 5 Report: 产品 / 清单 / 现算详情 API

## Status
DONE

## Commit
`feat(costing): add project and BOM line APIs with live cost`

## Tests
- RED：`service.test.ts` 因 `service.js` 尚不存在按预期失败。
- GREEN：产品成本 service、`calcCostSummary`、价目匹配和 BOM 数学共 14/14 通过。
- 路由模块导入检查通过；本任务三个 TypeScript 文件 IDE lint 无错误。

## Concerns
- 全量 `tsconfig.node.json` 类型检查仍有仓库既有错误，本任务文件无诊断。
- Vite 构建被既有 `SalesAnalyticsPage.tsx` 无法解析 `recharts` 阻塞。
- 未连接 PostgreSQL 做实际 CRUD/上传集成测试。
