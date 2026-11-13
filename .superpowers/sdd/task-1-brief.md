### Task 1: 月版本列表服务端分页 + createdByName

**Files:**
- Modify: `apps/web/server/lib/forecast-version.ts`
- Modify: `apps/web/server/routes/sales-forecast.ts`

**Interfaces:**
- Produces: `listForecastVersionsPage(params) → { items: ForecastVersionListItem[]; total; page; pageSize }`
- `ForecastVersionListItem` 增加 `createdByName: string | null`

- [ ] **Step 1: 扩展 `ForecastVersionListItem` 与 `toVersionListItem`**

在 `forecast-version.ts` 的类型与映射中增加 `createdByName`：

```ts
export type ForecastVersionListItem = {
  // ...existing fields...
  createdByName: string | null;
  stats: ForecastVersionStats;
};

function toVersionListItem(
  version: /* row + optional createdByName */,
  stats: ForecastVersionStats,
  generationPlatform: string | null = null,
): ForecastVersionListItem {
  return {
    // ...existing...
    createdByName: version.createdByName ?? null,
    stats,
  };
}
```

- [ ] **Step 2: 实现分页查询（替换裸 `listForecastVersions` 的列表用途）**

新增（或重写列表入口）大致逻辑：

```ts
import { users } from '@scm/db';
import { parseListPagination } from './list-pagination.js';
import { ilike, or, and, eq, desc, sql, count } from 'drizzle-orm';

export async function listForecastVersionsPage(input: {
  status?: ForecastVersionStatus;
  q?: string;
  page?: number;
  pageSize?: number;
  includeStats?: boolean;
  statsScope?: ForecastVersionStatsScope;
}) {
  const { page, pageSize, offset } = parseListPagination(
    input.page != null ? String(input.page) : undefined,
    input.pageSize != null ? String(input.pageSize) : undefined,
  );
  const conditions = [];
  if (input.status) conditions.push(eq(salesForecastVersions.status, input.status));
  const q = input.q?.trim();
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(salesForecastVersions.versionNo, pattern),
        ilike(salesForecastVersions.versionName, pattern),
        ilike(salesForecastVersions.station, pattern),
      )!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, countRow] = await Promise.all([
    db
      .select({
        id: salesForecastVersions.id,
        versionNo: salesForecastVersions.versionNo,
        versionName: salesForecastVersions.versionName,
        station: salesForecastVersions.station,
        status: salesForecastVersions.status,
        pipelineStatus: salesForecastVersions.pipelineStatus,
        createdAt: salesForecastVersions.createdAt,
        publishedAt: salesForecastVersions.publishedAt,
        startMonth: salesForecastVersions.startMonth,
        createdByName: users.name,
      })
      .from(salesForecastVersions)
      .leftJoin(users, eq(salesForecastVersions.createdBy, users.id))
      .where(where)
      .orderBy(desc(salesForecastVersions.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(salesForecastVersions)
      .where(where),
  ]);

  const statsMap =
    input.includeStats === false
      ? new Map()
      : await loadVersionStatsMap(
          rows.map((r) => r.id),
          input.statsScope ?? 'list',
        );

  const items = rows.map((r) =>
    toVersionListItem(r, statsMap.get(r.id) ?? emptyVersionStats()),
  );
  return { items, total: countRow[0]?.count ?? 0, page, pageSize };
}
```

注意：去掉旧「无 status 时 limit 50」对列表路径的依赖；`listForecastVersions` 若仍被别处使用可保留，但 GET 列表改走 `listForecastVersionsPage`。

- [ ] **Step 3: 改路由 `GET /sales-forecast-versions`**

`apps/web/server/routes/sales-forecast.ts`：

```ts
salesForecastRoutes.get('/sales-forecast-versions', requireMenu('data.forecast'), async (c) => {
  const statusQuery = c.req.query('status')?.trim();
  if (statusQuery && !isOneOf(statusQuery, FORECAST_VERSION_STATUSES)) {
    return c.json({ message: 'status must be one of draft, published, archived' }, 400);
  }
  const includeStats = c.req.query('includeStats')?.trim() === '1';
  const statsScopeRaw = c.req.query('statsScope')?.trim();
  const statsScope = statsScopeRaw === 'full' ? 'full' : 'list';
  const result = await listForecastVersionsPage({
    status: statusQuery as ForecastVersionStatus | undefined,
    q: c.req.query('q')?.trim(),
    page: Number(c.req.query('page') ?? 1),
    pageSize: Number(c.req.query('pageSize') ?? 20),
    includeStats,
    statsScope,
  });
  return c.json(result);
});
```

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @scm/web exec tsc -p tsconfig.server.json --noEmit`（若项目无此 config，用仓库既有 server typecheck 命令）  
Expected: 与本改动相关的错误清零（前端调用方下一任务再改）。

---
