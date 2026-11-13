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
