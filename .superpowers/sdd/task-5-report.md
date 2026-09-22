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

## Important Review Fixes
- `replaceBomLines` 的项目检查、状态更新时间、旧行删除与新行插入已纳入同一事务；插入失败会整体回滚。
- BOM 写入先将 `qty_net`、`loss_rate` 四舍五入到 4 位，再据此计算 `qty_gross`；创建、整表替换和单行更新统一使用该逻辑。
- PUT 空清单和 POST 单行在项目不存在时统一返回 404。

## Review Verification
Command:
`pnpm --filter @scm/web exec tsx --test server/lib/product-costing/service.test.ts server/lib/product-costing/bom-math.test.ts server/lib/product-costing/cost-calc.test.ts server/lib/product-costing/match-price.test.ts`

Output:
`tests 15; suites 6; pass 15; fail 0; duration_ms 1906.0039`

Command:
`pnpm --filter @scm/web exec tsx -e "import('./server/routes/product-costing.ts').then(() => console.log('product-costing route import ok'))"`

Output:
`product-costing route import ok`
