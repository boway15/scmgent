# Task 4 Report: 价目 API

## Status
DONE

## Commit
`29272f7` — `feat(costing): add shared material price book API`

## Tests
- RED：导入测试因 `price-book-import.js` 不存在而失败。
- GREEN：`pnpm exec tsx --test server/lib/product-costing/*.test.ts`，26/26 通过。
- 路由模块导入检查通过；相关文件 IDE lint 无错误。

## Concerns
- 全量 `tsc --noEmit` 受仓库既有 TS6305 项目引用问题阻塞；`tsconfig.node.json` 亦有大量既有错误，本任务文件修正后未再报错。
- 未连接 PostgreSQL 做实际 CRUD/xlsx upsert 集成测试。

## Review fix (empty unit price)

Command:
```
cd apps/web && pnpm exec tsx --test server/lib/product-costing/price-book-import.test.ts server/lib/product-costing/parse-unit-price.test.ts
```

Output:
```
▶ parseUnitPrice
  ✔ accepts numbers and non-empty numeric strings (0.7543ms)
  ✔ rejects empty, null, and undefined (0.1543ms)
  ✔ rejects invalid or negative values (0.1355ms)
✔ parseUnitPrice (2.0625ms)
▶ parsePriceBookSheet
  ✔ maps Chinese headers and normalizes an empty spec (4.2235ms)
  ✔ maps English headers (0.6187ms)
  ✔ skips rows with a negative unit price (0.55ms)
✔ parsePriceBookSheet (9.2156ms)
ℹ tests 6
ℹ suites 2
ℹ pass 6
ℹ fail 0
```

## Review fix (empty unit price import)

Command:
```
cd apps/web && pnpm exec tsx --test server/lib/product-costing/price-book-import.test.ts server/lib/product-costing/parse-unit-price.test.ts
```

Output:
```
▶ parseUnitPrice
  ✔ accepts numbers and non-empty numeric strings (5.9765ms)
  ✔ rejects empty, null, and undefined (0.7045ms)
  ✔ rejects invalid or negative values (0.6703ms)
✔ parseUnitPrice (10.0541ms)
▶ parsePriceBookSheet
  ✔ maps Chinese headers and normalizes an empty spec (1.4715ms)
  ✔ maps English headers (0.2421ms)
  ✔ skips rows with a negative unit price (0.1527ms)
  ✔ counts empty or missing unit price as errors, not rows (0.117ms)
✔ parsePriceBookSheet (2.8829ms)
ℹ tests 7
ℹ suites 2
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1858.5153
```
