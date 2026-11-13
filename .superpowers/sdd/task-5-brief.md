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
