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
