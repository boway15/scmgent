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
