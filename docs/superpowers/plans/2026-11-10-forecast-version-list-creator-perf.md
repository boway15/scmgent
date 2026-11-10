# 销量/周销量版本列表：创建人 + 服务端分页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 月/周销量预测版本列表展示创建人，并改为真服务端分页以加速首屏；用本地 Docker（`localhost:8081`）验收。

**Architecture:** Schema 已有 `created_by`，列表 `leftJoin users` 暴露 `createdByName`。月列表 API 从裸数组改为 `{ items, total, page, pageSize }`，stats 只算当前页；周列表补 `status` + 创建人，前端停用 `pageSize: 500`。

**Tech Stack:** Hono / Drizzle / React Query / Docker Compose

**Spec:** [docs/superpowers/specs/2026-11-10-forecast-version-list-creator-perf-design.md](../specs/2026-11-10-forecast-version-list-creator-perf-design.md)

## Global Constraints

- 无 DB migration
- 创建人列插在「创建 / 发布」之前；空值 `—`
- 不改详情页创建人、不做按创建人筛选、不做明细 wide/horizon 优化
- Commit 仅在用户明确要求时执行（本计划不默认 commit）
- 验收：开发机 `pnpm docker:build && pnpm docker:start`，`http://localhost:8081`

---

## File map

| Action | Path |
|--------|------|
| Modify | `apps/web/server/lib/forecast-version.ts` |
| Modify | `apps/web/server/routes/sales-forecast.ts` |
| Modify | `apps/web/server/routes/demand-plans.ts` |
| Modify | `apps/web/src/lib/api.ts` |
| Modify | `apps/web/src/pages/SalesForecastListPage.tsx` |
| Modify | `apps/web/src/pages/DemandPlanPilotPage.tsx` |
| Modify | `apps/web/src/components/ForecastStrategySection.tsx` |
| Modify | `apps/web/src/pages/SalesForecastVersionDetailPage.tsx` |

---

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

### Task 2: 周版本列表 status + createdByName

**Files:**
- Modify: `apps/web/server/routes/demand-plans.ts`

**Interfaces:**
- Consumes: 现有 `parseListPagination`、`demandPlanVersions`、`users`
- Produces: list item 含 `createdByName`；支持 `status` query

- [ ] **Step 1: 扩展 `GET /demand-plans`**

在现有 `q` / scope 条件上增加：

```ts
const status = c.req.query('status')?.trim();
if (status) {
  conditions.push(eq(demandPlanVersions.status, status));
}
```

select 增加 join：

```ts
.select({
  // ...existing fields...
  createdByName: users.name,
})
.from(demandPlanVersions)
.leftJoin(users, eq(demandPlanVersions.createdBy, users.id))
```

确保文件顶部从 `@scm/db` 导入 `users`。

- [ ] **Step 2: 确认 count 查询仍用同一 `where`（不含 join 重复计数）**  
count 继续 `from(demandPlanVersions).where(where)`，不要 join users。

---

### Task 3: API 客户端类型与方法

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: 类型加 `createdByName`**

```ts
export type ForecastVersionListItem = {
  // ...
  createdByName?: string | null;
  stats: ForecastVersionStats;
};

export type ForecastVersionBasic = {
  // ...
  createdByName?: string | null;
};

export type DemandPlanVersionListItem = {
  // ...
  createdByName?: string | null;
};
```

- [ ] **Step 2: 改 `getSalesForecastVersions` 为分页**

```ts
getSalesForecastVersions: (params?: {
  status?: 'draft' | 'published' | 'archived';
  includeStats?: boolean;
  statsScope?: 'list' | 'full';
  page?: number;
  pageSize?: number;
  q?: string;
}) => {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.includeStats) qs.set('includeStats', '1');
  if (params?.includeStats && params.statsScope) qs.set('statsScope', params.statsScope);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params?.q) qs.set('q', params.q);
  const query = qs.toString();
  if (params?.includeStats) {
    return request<PaginatedResult<ForecastVersionListItem>>(
      `/api/sales-forecast-versions${query ? `?${query}` : ''}`,
    );
  }
  return request<PaginatedResult<ForecastVersionBasic>>(
    `/api/sales-forecast-versions${query ? `?${query}` : ''}`,
  );
},
```

- [ ] **Step 3: `listDemandPlanVersions` 增加 `status`**

```ts
listDemandPlanVersions: (params?: {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: string;
}) => {
  const qs = new URLSearchParams();
  // ...existing...
  if (params?.status) qs.set('status', params.status);
  // type items include createdByName?: string | null
},
```

---

### Task 4: 月列表页真分页 + 创建人列 + 附属查询

**Files:**
- Modify: `apps/web/src/pages/SalesForecastListPage.tsx`
- Modify: `apps/web/src/components/ForecastStrategySection.tsx`
- Modify: `apps/web/src/pages/SalesForecastVersionDetailPage.tsx`

- [ ] **Step 1: 列表 query 改为服务端参数**

```ts
const { data, isLoading } = useQuery({
  queryKey: [
    'sales-forecast-versions',
    'stats',
    'list',
    versionPage,
    versionPageSize,
    statusFilter,
    appliedVersionKeyword,
  ],
  queryFn: () =>
    api.getSalesForecastVersions({
      includeStats: true,
      statsScope: 'list',
      page: versionPage,
      pageSize: versionPageSize,
      status: statusFilter === 'all' ? undefined : statusFilter,
      q: appliedVersionKeyword.trim() || undefined,
    }),
  staleTime: 30_000,
  refetchInterval: (query) => {
    const rows = query.state.data?.items ?? [];
    return rows.some(
      (v) => v.pipelineStatus === 'generating' || v.pipelineStatus === 'landing',
    )
      ? 5000
      : false;
  },
});
const versions = data?.items ?? [];
const total = data?.total ?? 0;
```

删除基于全量的 `filteredVersions` / `searchedVersions` / `pagedVersions`；表格直接 `versions.map`；`ListPagination` 的 `total={total}`。

- [ ] **Step 2: 最新已发布轻量查询**

```ts
const { data: latestPublishedPage } = useQuery({
  queryKey: ['sales-forecast-versions', 'latest-published'],
  queryFn: () =>
    api.getSalesForecastVersions({ status: 'published', page: 1, pageSize: 1 }),
  staleTime: 30_000,
});
const latestPublishedVersion = latestPublishedPage?.items?.[0];
```

凡依赖「全量 versions 找 draft/published」的 legacy tab / calibrationImport effect，改为单独 `status=draft&pageSize=1` 或 `status=published&pageSize=1` 查询（enabled 按需）。

- [ ] **Step 3: VersionRow 增加创建人列**

表头在「创建 / 发布」前加 `<th>创建人</th>`；单元格：

```tsx
<td className="p-2 text-sm text-text-sub">{version.createdByName ?? '—'}</td>
```

- [ ] **Step 4: 适配其它调用方**

`ForecastStrategySection.tsx`：

```ts
queryFn: () =>
  api.getSalesForecastVersions({ status: 'draft', page: 1, pageSize: 1 }),
// latestForecastDraft = forecastDrafts?.items?.[0]
```

`SalesForecastVersionDetailPage.tsx`：

```ts
queryFn: () =>
  api.getSalesForecastVersions({ status: 'published', page: 1, pageSize: 100 }),
// publishedVersions = data?.items ?? []
```

---

### Task 5: 周列表页真分页 + 创建人列

**Files:**
- Modify: `apps/web/src/pages/DemandPlanPilotPage.tsx`

- [ ] **Step 1: 停用 pageSize 500**

```ts
const versionsQuery = useQuery({
  queryKey: ['demand-plan-versions', page, pageSize, statusFilter, appliedKeyword],
  queryFn: () =>
    api.listDemandPlanVersions({
      page,
      pageSize,
      status: statusFilter === 'all' ? undefined : statusFilter,
      q: appliedKeyword.trim() || undefined,
    }),
});
const versions = versionsQuery.data?.items ?? [];
const total = versionsQuery.data?.total ?? 0;
```

删除本地 filter/slice；`ListPagination total={total}`。

若页面仍需要「已采纳 published」计数且不能靠当前页，另加：

```ts
api.listDemandPlanVersions({ status: 'pilot_published', page: 1, pageSize: 1 })
```

仅在确有 UI 依赖时保留。

- [ ] **Step 2: 创建人列**

同月列表：表头在「创建 / 发布」前；`version.createdByName ?? '—'`。

---

### Task 6: 本地 Docker 发布验证

**Files:** 无代码；按开发机 Docker 流程

- [ ] **Step 1: 构建并启动**

在 `d:\Docker\project\scm-agent`：

```powershell
pnpm docker:build
pnpm docker:start
docker compose -p scm-agent ps
curl.exe -s http://localhost:8081/api/health
```

Expected: web Up；health JSON 且 db 正常。

- [ ] **Step 2: API 冒烟（需已登录 cookie 或用浏览器 DevTools）**

浏览器打开 `http://localhost:8081`，登录后：

1. `/data/forecast`：Network 中 `sales-forecast-versions` 应带 `page`/`pageSize`，响应为 `{ items, total, ... }`；列表有「创建人」；默认约 20 条。
2. `/data/demand-plan`：请求 **不再** `pageSize=500`；有「创建人」；翻页/筛选正常。
3. 策略 Tab、草稿详情「合并到已发布」不报错（读 `items`）。

- [ ] **Step 3: 记录结果**

在对话中回报：health、两列表首屏请求 pageSize、创建人是否可见、发现的问题。

---

## Self-review (plan vs spec)

| Spec 要求 | Task |
|-----------|------|
| createdByName 列表列 | 1,2,4,5 |
| 无 migration | Global |
| 月分页 + 当前页 stats | 1,4 |
| 周 status + 停 500 | 2,5 |
| 调用方适配 Strategy/Detail | 4 |
| 本地 Docker 验收 | 6 |
| 非目标未纳入 | OK |
