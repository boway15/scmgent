# Task 2 报告：周版本列表 status + createdByName

## Status: DONE

## 变更摘要

### `apps/web/server/routes/demand-plans.ts`

仅改动 `GET /demand-plans` 列表块（约 L131–201）：

1. **`@scm/db` 导入** 增加 `users`。
2. **查询参数 `status`**：`trim` 后非空则 `eq(demandPlanVersions.status, status)`（无额外 enum 校验，与 brief 及 `forecast-version` 列表模式一致）。
3. **列表 select** 增加 `createdByName: users.name`。
4. **列表查询** `leftJoin(users, eq(demandPlanVersions.createdBy, users.id))`。
5. **count 查询** 仍为 `from(demandPlanVersions).where(where)`，未 join users，避免重复计数。

未改动同文件内 download-center / 导出 / 其它路由逻辑。

## 自检

- [x] count 与 list 共用同一 `where`（含 status / scope / q）
- [x] `createdBy` 外键存在于 `demand_plan_versions` schema
- [x] 对齐 `listForecastVersionsPage` 的 join + count 分离模式
- [x] 未 git commit
- [x] ESLint/IDE：本文件无新增 lint

## 测试

| 命令 | 结果 |
|------|------|
| `npx tsx --test server/routes/demand-plans.test.ts` | 3 pass / 2 fail（`parseGenerateBody` 期望缺少 `startWeek` 字段，与本次改动无关） |

未新增 list 集成测试；Task 2 brief 未要求。

## 关注点

- `status` 为任意字符串等值过滤；无效值返回空列表，非 400（与多数列表路由一致）。
- `createdBy` 为空或用户已删时 `createdByName` 为 `null`（left join）。

## Commits

无（按用户要求）
