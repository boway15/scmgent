# 跨境资讯研究 Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在无搜索 API、无新增常驻服务的条件下，将固定 RSSHub 采集改造成每天自动执行的查询型新闻源、官方站点与按需浏览器研究任务，并提供候选人工审核流程。

**Architecture:** 保留 `/api/tasks/news-ingest`、现有数据库和飞书集成。查询策略生成受控的 Google News/Bing News RSS 搜索源，采集结果统一进入 `pending_review` 候选池；普通 HTTP 抽取失败时按需启动 Chromium。只有人工标记为 `published` 的候选可同步飞书，稳定后彻底移除 RSSHub 容器和运行时依赖。

**Tech Stack:** TypeScript、Node 20、Hono、Drizzle/PostgreSQL、React 18、TanStack Query、Node test、playwright-core、Alpine Chromium、Docker Compose。

## Global Constraints

- 每天 `08:00` 继续由 Compose `cron` 调用 `/api/tasks/news-ingest`。
- 不使用搜索 API、OpenClaw、SearXNG、宿主机计划任务或 Docker Socket。
- 不新增常驻服务；Chromium 仅按需启动并在 `finally` 中关闭。
- 第一阶段不因相关度低而丢弃候选，仅过滤确定垃圾、无标题/链接和超出回看窗口记录。
- 新候选默认 `pending_review`；仅 `published` 可同步飞书。
- 禁止绕过登录、验证码、付费墙和反爬机制。
- 当前工作区在 `main` 且包含用户未提交改动；用户已明确允许就地实施。不得提交 Git，不得覆盖无关改动。

---

### Task 1: 查询策略与查询型 RSS

**Files:**
- Create: `apps/web/server/lib/news-intel/research-queries.ts`
- Create: `apps/web/server/lib/news-intel/research-queries.test.ts`
- Modify: `apps/web/server/lib/news-intel/policy.ts`
- Modify: `apps/web/server/lib/news-intel/openclaw-policy.json`
- Modify: `apps/web/server/lib/news-intel/sources.seed.json`

**Interfaces:**
- Produces: `buildResearchQueries(policy: NewsIntelPolicy): ResearchQuery[]`
- Produces: `buildGoogleNewsFeedUrl(query: ResearchQuery): string`
- Produces: `ResearchQuery = { code: string; label: string; query: string; language: 'zh' | 'en'; region: string }`

- [ ] **Step 1: Write failing query generation tests**

```ts
it('generates bounded unique queries for platforms, brands and policy topics', () => {
  const queries = buildResearchQueries(policy);
  assert.ok(queries.some((q) => q.query.includes('Amazon')));
  assert.ok(queries.some((q) => q.query.includes('FlexiSpot')));
  assert.equal(new Set(queries.map((q) => q.code)).size, queries.length);
  assert.ok(queries.length <= policy.research.maxQueriesPerRun);
});

it('builds a seven-day Google News feed without double encoding', () => {
  const url = new URL(buildGoogleNewsFeedUrl({
    code: 'amazon_us',
    label: 'Amazon 美国',
    query: 'Amazon seller policy',
    language: 'en',
    region: 'US',
  }));
  assert.equal(url.hostname, 'news.google.com');
  assert.match(url.searchParams.get('q') ?? '', /when:7d/);
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/news-intel/research-queries.test.ts`

Expected: FAIL because `research-queries.ts` and `policy.research` do not exist.

- [ ] **Step 3: Implement bounded query generation**

Add `research` to `NewsIntelPolicy`:

```ts
research: {
  maxQueriesPerRun: number;
  maxItemsPerQuery: number;
  providers: Array<'google_news'>;
  queryTemplates: Array<{
    code: string;
    label: string;
    template: string;
    dimension: 'platform' | 'brand' | 'topic';
    language: 'zh' | 'en';
    region: string;
  }>;
};
```

Generate one query per selected dimension value, deduplicate by normalized query, deterministically sort by code, and slice to `maxQueriesPerRun`. Build Google News URLs with `URL`/`URLSearchParams`, adding `when:${lookbackDays}d`.

- [ ] **Step 4: Replace broad static Google query seeds with generated-query metadata**

Keep native/official RSS seeds. Mark legacy RSSHub seeds `enabled: false`. Query sources will be upserted by Task 2 rather than maintaining dozens of encoded URLs by hand.

- [ ] **Step 5: Run GREEN**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/news-intel/research-queries.test.ts`

Expected: PASS.

---

### Task 2: 研究来源数据模型、来源生成与安全采集

**Files:**
- Create: `packages/db/drizzle/0051_news_research_agent.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema/news-intel.ts`
- Modify: `apps/web/server/lib/news-intel/types.ts`
- Modify: `apps/web/server/lib/news-intel/source-service.ts`
- Create: `apps/web/server/lib/news-intel/source-service.test.ts`
- Create: `apps/web/server/lib/news-intel/url-safety.ts`
- Create: `apps/web/server/lib/news-intel/url-safety.test.ts`

**Interfaces:**
- Consumes: `buildResearchQueries`, `buildGoogleNewsFeedUrl`
- Produces: `ensureResearchQuerySources(): Promise<number>`
- Produces: `assertSafePublicHttpUrl(raw: string): URL`
- Extends `NewsSourceType` with `query_feed | sitemap | web_page`

- [ ] **Step 1: Write failing tests for safe URLs and query source mapping**

```ts
it('rejects loopback and private destinations', () => {
  for (const value of ['http://127.0.0.1/x', 'http://10.0.0.1/x', 'file:///etc/passwd']) {
    assert.throws(() => assertSafePublicHttpUrl(value));
  }
});

it('maps each research query to a disabled-safe query_feed seed', () => {
  const rows = buildResearchSourceRows(policy);
  assert.ok(rows.every((row) => row.sourceType === 'query_feed'));
  assert.ok(rows.every((row) => row.configJson.discoveryQuery));
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/news-intel/url-safety.test.ts server/lib/news-intel/source-service.test.ts`

Expected: FAIL because the helpers and source enum values do not exist.

- [ ] **Step 3: Add migration and schema fields**

Migration contents:

```sql
ALTER TYPE "news_source_type" ADD VALUE IF NOT EXISTS 'query_feed';
ALTER TYPE "news_source_type" ADD VALUE IF NOT EXISTS 'sitemap';
ALTER TYPE "news_source_type" ADD VALUE IF NOT EXISTS 'web_page';

ALTER TABLE "news_articles"
  ADD COLUMN IF NOT EXISTS "discovery_channel" varchar(30),
  ADD COLUMN IF NOT EXISTS "discovery_query" text,
  ADD COLUMN IF NOT EXISTS "source_domain" varchar(255),
  ADD COLUMN IF NOT EXISTS "aggregator_only" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "reviewed_by" uuid;
```

Append journal entry `idx: 50`, tag `0051_news_research_agent`. Do not extend the archived Miaoda ZIP/CJS init SQL builder.

- [ ] **Step 4: Implement safe URL validation**

Allow only `http:`/`https:`. Reject `localhost`, `.local`, loopback, link-local, RFC1918 IPv4, IPv6 loopback/link-local/ULA, and credential-bearing URLs before every HTTP/browser fetch.

- [ ] **Step 5: Upsert generated query sources**

`ensureNewsSourcesSeeded()` must:

1. Keep existing static source upserts.
2. Upsert generated `query_feed` rows with stable codes prefixed `research_`.
3. Persist `discoveryQuery`, language and region in `configJson`.
4. Force all legacy `rsshub` rows disabled without depending on `RSSHUB_BASE_URL`.

- [ ] **Step 6: Run GREEN**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/news-intel/url-safety.test.ts server/lib/news-intel/source-service.test.ts`

Expected: PASS.

---

### Task 3: 候选优先采集、人工审核门禁与互斥

**Files:**
- Modify: `apps/web/server/lib/news-intel/ingest-pipeline.ts`
- Modify: `apps/web/server/lib/news-intel/ingest-pipeline.test.ts`
- Modify: `apps/web/server/lib/news-intel/bitable-sync.ts`
- Create: `apps/web/server/lib/news-intel/bitable-sync.test.ts`
- Modify: `apps/web/server/routes/tasks.ts`

**Interfaces:**
- Produces: `decideCandidateDisposition(input): 'discard' | 'pending_review'`
- Produces: `canSyncNewsArticle(status: NewsArticleStatus): boolean`
- Produces: `tryAcquireNewsIngestLock(): (() => void) | null`

- [ ] **Step 1: Write failing candidate and sync-gate tests**

```ts
it('keeps low-scoring but non-garbage content for review', () => {
  assert.equal(decideCandidateDisposition({ hardFilterPassed: true, relevanceScore: 5 }), 'pending_review');
});

it('only allows published articles to sync', () => {
  assert.equal(canSyncNewsArticle('published'), true);
  assert.equal(canSyncNewsArticle('pending_review'), false);
  assert.equal(canSyncNewsArticle('ignored'), false);
});

it('rejects a concurrent ingest lock and releases after completion', () => {
  const release = tryAcquireNewsIngestLock();
  assert.ok(release);
  assert.equal(tryAcquireNewsIngestLock(), null);
  release();
  assert.ok(tryAcquireNewsIngestLock());
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/news-intel/ingest-pipeline.test.ts server/lib/news-intel/bitable-sync.test.ts`

Expected: FAIL because candidate disposition, sync gate and lock do not exist.

- [ ] **Step 3: Change ingestion semantics**

- Keep hard relevance/date/garbage checks.
- Do not `continue` when `relevanceScore < NEWS_INTEL_MIN_RELEVANCE`; increment the low-score metric but insert the candidate.
- Insert with `status: 'pending_review'`, `bitableSyncStatus: 'pending'`, discovery fields and source domain.
- Remove immediate `syncArticleToBitable()` after insertion.
- At run end, `syncPendingArticlesToBitable()` only finds `status = 'published'`.

- [ ] **Step 4: Add process-local mutex**

Wrap `runNewsIngest` in a lock released by `finally`. Cron and manual endpoints return a clear `409`-compatible error when another ingest is active. Keep the existing same-day idempotence check and `force` behavior.

- [ ] **Step 5: Run GREEN and existing news tests**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/news-intel/*.test.ts`

Expected: all news-intel tests PASS.

---

### Task 4: 按需 Chromium 正文补抓

**Files:**
- Create: `apps/web/server/lib/news-intel/browser-extract.ts`
- Create: `apps/web/server/lib/news-intel/browser-extract.test.ts`
- Modify: `apps/web/server/lib/news-intel/body-extract.ts`
- Modify: `apps/web/server/lib/news-intel/config.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `Dockerfile`

**Interfaces:**
- Produces: `extractBodyWithBrowser(url: string, deps?: BrowserDeps): Promise<string | undefined>`
- Produces: `isBrowserExtractionEnabled(): boolean`
- Uses environment `NEWS_INTEL_BROWSER_ENABLED` and `CHROMIUM_EXECUTABLE_PATH`

- [ ] **Step 1: Write failing cleanup and fallback tests**

Inject a fake browser dependency and assert:

```ts
it('closes browser when extraction throws', async () => {
  await assert.rejects(() => extractBodyWithBrowser('https://example.com/a', deps));
  assert.equal(closeCalls, 1);
});

it('returns undefined for login and captcha pages', async () => {
  assert.equal(await extractBodyWithBrowser('https://example.com/a', captchaDeps), undefined);
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/news-intel/browser-extract.test.ts`

Expected: FAIL because browser extractor does not exist.

- [ ] **Step 3: Add latest `playwright-core` dependency**

Run: `pnpm --filter @scm/web add playwright-core`

Expected: package and lockfile updated by pnpm.

- [ ] **Step 4: Implement browser extraction**

- Validate URL with `assertSafePublicHttpUrl`.
- Launch configured Chromium with downloads disabled and a temporary context.
- Use concurrency 1 per extraction helper, navigation timeout 20 seconds, and maximum body length from existing config.
- Detect login/captcha/access-denied text and return `undefined`.
- Close context/browser and remove temporary data in `finally`.

- [ ] **Step 5: Add browser as final body fallback**

Keep current RSS content, direct HTTP and optional Jina paths first. Call Chromium only when those paths produce insufficient text and browser extraction is enabled.

- [ ] **Step 6: Install Chromium in runtime image**

Change runner setup to `apk add --no-cache postgresql-client chromium` and set:

```dockerfile
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

- [ ] **Step 7: Run GREEN**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/news-intel/browser-extract.test.ts`

Expected: PASS without launching a real browser.

---

### Task 5: 审核 API 与候选池页面

**Files:**
- Modify: `apps/web/server/routes/news-intel.ts`
- Modify: `apps/web/server/lib/news-intel/ingest-pipeline.ts`
- Create: `apps/web/server/lib/news-intel/article-review.test.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/pages/NewsIntelPage.tsx`
- Modify: `apps/web/src/lib/scheduled-tasks.ts`

**Interfaces:**
- Extends PATCH `/api/news-intel/articles/:id` with `status`
- Produces review transitions `pending_review | published | ignored`
- Article list supports `status`, `discoveryChannel`, `sourceDomain`

- [ ] **Step 1: Write failing review transition tests**

```ts
it('sets reviewer metadata when publishing or ignoring', () => {
  const patch = buildReviewPatch('published', 'user-1', now);
  assert.equal(patch.status, 'published');
  assert.equal(patch.reviewedBy, 'user-1');
  assert.equal(patch.reviewedAt, now);
});

it('clears reviewer metadata when restoring pending review', () => {
  const patch = buildReviewPatch('pending_review', 'user-1', now);
  assert.equal(patch.reviewedBy, null);
  assert.equal(patch.reviewedAt, null);
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/news-intel/article-review.test.ts`

Expected: FAIL because review patch helper does not exist.

- [ ] **Step 3: Implement authenticated review updates**

Use the current super-admin user ID from the route. Accept only `pending_review`, `published`, and `ignored`. Publishing leaves `bitableSyncStatus = 'pending'`; ignored/restored records do not sync automatically.

- [ ] **Step 4: Update the page**

- Rename page to “跨境资讯研究”。
- Default article query to `pending_review`.
- Add status tabs/filter and buttons “采用 / 忽略 / 恢复待审核 / 打开原文”。
- Show discovery channel, source domain and query.
- Replace RSSHub status with “研究采集：查询 RSS + 官方站点 + 按需浏览器”。
- Keep “执行今日采集 / 强制全量采集” for manual retry.

- [ ] **Step 5: Run GREEN and frontend build**

Run:

```powershell
pnpm --filter @scm/web exec tsx --test server/lib/news-intel/article-review.test.ts
pnpm --filter @scm/web build
```

Expected: test PASS and Vite build exits 0.

---

### Task 6: 移除 RSSHub 部署与最终验证

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/feishu-bitable-sync.md`
- Modify: `docs/miaoda-import-checklist.md`
- Modify: `apps/web/miaoda/MIAODA-SETUP.md`
- Modify: `docs/superpowers/specs/2026-07-24-self-hosted-cron-sidecar-design.md`

**Interfaces:**
- Removes runtime `RSSHUB_BASE_URL`
- Removes Compose `rsshub` service and `web.depends_on.rsshub`

- [ ] **Step 1: Remove RSSHub runtime wiring**

Delete the `rsshub` service, Web environment override, health dependency, and obsolete documentation/config examples. Keep database enum value `rsshub` and historical records for compatibility, but force those sources disabled.

- [ ] **Step 2: Document new behavior**

Document daily 08:00 automatic research, manual retry, candidate review, optional Dify, optional browser flag and Chromium resource impact.

- [ ] **Step 3: Run focused tests**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/news-intel/*.test.ts`

Expected: all news-intel tests PASS.

- [ ] **Step 4: Run database and application verification**

Run:

```powershell
pnpm --filter @scm/db exec tsc --noEmit
pnpm --filter @scm/web exec tsc --noEmit
pnpm --filter @scm/web build
docker compose config
```

Expected: all commands exit 0 and Compose output contains no `rsshub` service or dependency.

- [ ] **Step 5: Review scoped diff**

Run: `git diff --check -- apps/web/server/lib/news-intel apps/web/server/routes/news-intel.ts apps/web/server/routes/tasks.ts apps/web/src/pages/NewsIntelPage.tsx apps/web/src/lib/api.ts apps/web/src/lib/scheduled-tasks.ts packages/db/src/schema/news-intel.ts packages/db/drizzle/0051_news_research_agent.sql packages/db/drizzle/meta/_journal.json Dockerfile docker-compose.yml README.md docs`

Expected: no whitespace errors. Confirm no unrelated user changes were overwritten and do not commit.
