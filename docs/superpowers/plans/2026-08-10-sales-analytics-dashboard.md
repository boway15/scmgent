# 销售分析看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地独立「销售分析看板」：从库内日销量预聚合四维 Cube 快照，前端一次拉取后做月/周筛选、KPI、图表、明细矩阵与看板内轻量外推。

**Architecture:** 日表 `sales_history` 重建为 `sales_analytics_cube_snapshots`（jsonb payload）；API 提供 cube/status/rebuild；React 页 `/data/sales-analytics` 纯前端交互。轻量预测不落库。因 `sales_history_monthly` 无仓码，**月与周序列均从日表聚合**（保留站点维；与 spec「优先月表」的意图一致，实现上以日表为准）。

**Tech Stack:** Drizzle/Postgres、Hono、React、TanStack Query、recharts、node:test

## Global Constraints

- 数据仅来自库内销售历史；不做 Excel/CSV 看板导入
- 组别：看板专用路径解析，保留「海外项目X组」；不用 `skus.project_group`
- 站点桶：US / EU / UK / 其他；UK 不并入 EU
- 轻量外推仅展示，不进 `sales_forecast_*` / 补货 / 准确率；UI 标注「看板粗估，非系统发布预测」
- 一期不做：四大类 `g` 主筛、固定 cron、整页导出、与发布预测同屏对比
- Commit 步骤仅在用户明确要求提交时执行

## File Structure

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/sales-analytics-dims.ts` | 站点归桶、组别/品类叶子、ISO 周标签 |
| `apps/web/server/lib/sales-analytics-dims.test.ts` | 维度单测 |
| `apps/web/server/lib/sales-analytics-cube.ts` | 从日表构建 cube + 读写快照 + rebuild |
| `apps/web/server/lib/sales-analytics-cube.test.ts` | 聚合/并发/清理单测（可 mock db 或测纯函数） |
| `apps/web/server/routes/sales-analytics.ts` | GET cube/status、POST rebuild |
| `apps/web/server/index.ts` | 挂载路由 |
| `packages/db/src/schema/sales-analytics.ts` | `salesAnalyticsCubeSnapshots` |
| `packages/db/src/schema/index.ts` | export |
| `packages/db/drizzle/0072_sales_analytics_cube.sql` | 表 + 菜单 + 角色授权 |
| `packages/db/drizzle/meta/_journal.json` | 登记 0072 |
| `packages/db/src/seed.ts` | 新环境菜单 |
| `apps/web/src/lib/sales-analytics-types.ts` | Cube 类型 |
| `apps/web/src/lib/sales-analytics-metrics.ts` | MoM/YoY/筛选合计/矩阵聚合 |
| `apps/web/src/lib/sales-analytics-metrics.test.ts` | 指标单测 |
| `apps/web/src/lib/sales-analytics-forecast.ts` | 轻量模型选型与外推 |
| `apps/web/src/lib/sales-analytics-forecast.test.ts` | 预测单测 |
| `apps/web/src/lib/api.ts` | API 客户端 |
| `apps/web/src/pages/SalesAnalyticsPage.tsx` | 看板页 |
| `apps/web/src/router.tsx` | 路由 |
| `apps/web/server/lib/sales-history-import.ts` | 导入成功后可选触发 rebuild（fire-and-forget） |
| `apps/web/package.json` | 增加 `recharts` |

---

### Task 1: 维度解析（TDD）

**Files:**
- Create: `apps/web/server/lib/sales-analytics-dims.ts`
- Create: `apps/web/server/lib/sales-analytics-dims.test.ts`

**Interfaces:**
- Produces:
  - `bucketAnalyticsSite(stationOrRegion: string | null | undefined): 'US' | 'EU' | 'UK' | '其他'`
  - `extractAnalyticsDept(category: string | null | undefined): string`
  - `extractAnalyticsCategoryLeaf(category: string | null | undefined): string`
  - `isoWeekLabel(ymd: string): string | null` — `YYYY-Www`

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bucketAnalyticsSite,
  extractAnalyticsDept,
  extractAnalyticsCategoryLeaf,
  isoWeekLabel,
} from './sales-analytics-dims.js';

describe('sales-analytics-dims', () => {
  it('buckets site US/EU/UK/其他', () => {
    assert.equal(bucketAnalyticsSite('US'), 'US');
    assert.equal(bucketAnalyticsSite('UK'), 'UK');
    assert.equal(bucketAnalyticsSite('DE'), 'EU');
    assert.equal(bucketAnalyticsSite('EU'), 'EU');
    assert.equal(bucketAnalyticsSite(null), '其他');
    assert.equal(bucketAnalyticsSite(''), '其他');
    assert.equal(bucketAnalyticsSite('APAC'), '其他');
  });

  it('extracts dept with overseas prefix', () => {
    assert.equal(
      extractAnalyticsDept('DJ02\\Amazon项目1组-第一曲线-US\\卧室-床'),
      '项目1组',
    );
    assert.equal(
      extractAnalyticsDept('海外事业\\海外项目3组-EU\\户外'),
      '海外项目3组',
    );
    assert.equal(extractAnalyticsDept('DJ01-郑州大件\\无项目\\叶子'), 'DJ01-郑州大件');
    assert.equal(extractAnalyticsDept(null), '(未分组)');
  });

  it('extracts category leaf', () => {
    assert.equal(
      extractAnalyticsCategoryLeaf('A\\B\\办公-电脑桌Desks'),
      '办公-电脑桌Desks',
    );
    assert.equal(extractAnalyticsCategoryLeaf(''), '(未分类)');
  });

  it('formats ISO week labels', () => {
    assert.equal(isoWeekLabel('2024-01-01'), '2024-W01');
    assert.equal(isoWeekLabel('bad'), null);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && node --import tsx --test server/lib/sales-analytics-dims.test.ts`  
Expected: FAIL — 模块不存在

- [ ] **Step 3: 最小实现**

```ts
import { normalizeCategoryPath } from './sku-category.js';

const DEPT_PAT = /(?:海外)?\s*项目\s*第?\s*([0-9一二三四五六七八九十]+)\s*组/;
const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function cn2num(z: string): number {
  if (/^\d+$/.test(z)) return Number.parseInt(z, 10);
  if (z === '十') return 10;
  if (z.includes('十')) return 10;
  return CN_NUM[z] ?? 0;
}

export function bucketAnalyticsSite(
  stationOrRegion: string | null | undefined,
): 'US' | 'EU' | 'UK' | '其他' {
  const s = (stationOrRegion ?? '').trim().toUpperCase();
  if (!s) return '其他';
  if (s === 'UK' || s === 'GB') return 'UK';
  if (s === 'US') return 'US';
  if (s === 'EU' || s === 'DE' || s === 'FR' || s === 'IT' || s === 'ES' || s === 'IE') {
    return 'EU';
  }
  return '其他';
}

export function extractAnalyticsDept(category: string | null | undefined): string {
  const raw = (category ?? '').trim();
  if (!raw) return '(未分组)';
  const m = raw.match(DEPT_PAT);
  if (m) {
    const num = cn2num(m[1]);
    const isHaiwai = raw.includes('海外');
    return `${isHaiwai ? '海外项目' : '项目'}${num}组`;
  }
  const normalized = normalizeCategoryPath(raw);
  const first = normalized.split('/').filter(Boolean)[0];
  return first || '(未分组)';
}

export function extractAnalyticsCategoryLeaf(
  category: string | null | undefined,
): string {
  const normalized = normalizeCategoryPath(category);
  if (!normalized) return '(未分类)';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || '(未分类)';
}

export function isoWeekLabel(ymd: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ymd).trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同上  
Expected: PASS

- [ ] **Step 5: Commit**（仅用户要求时）

```bash
git add apps/web/server/lib/sales-analytics-dims.ts apps/web/server/lib/sales-analytics-dims.test.ts
git commit -m "feat(sales-analytics): add dimension parsers for analytics cube"
```

---

### Task 2: Schema + 迁移 + 菜单

**Files:**
- Create: `packages/db/src/schema/sales-analytics.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0072_sales_analytics_cube.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`（idx 74 / tag `0072_sales_analytics_cube`）
- Modify: `packages/db/src/seed.ts`（`data` 子菜单增加 `data.sales_analytics`，角色授权与 `data.sales` / `data.forecast` 同级）

**Interfaces:**
- Produces: table `salesAnalyticsCubeSnapshots`（Drizzle）

- [ ] **Step 1: Schema**

```ts
import { pgTable, uuid, varchar, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './auth';

export type SalesAnalyticsCubePayload = {
  meta: {
    generatedAt: string;
    dateStart: string | null;
    dateEnd: string | null;
    weekStart: string | null;
    weekEnd: string | null;
    recordCount: number;
    totalSales: number;
    sites: string[];
    depts: string[];
    categories: string[];
    platforms: string[];
  };
  months: string[];
  weeks: string[];
  data: Array<{
    s: string;
    b: string;
    c: string;
    p: string;
    v: number[];
    vw: number[];
  }>;
};

export const salesAnalyticsCubeSnapshots = pgTable(
  'sales_analytics_cube_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: varchar('status', { length: 20 }).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    meta: jsonb('meta').$type<SalesAnalyticsCubePayload['meta']>(),
    payload: jsonb('payload').$type<SalesAnalyticsCubePayload>(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (table) => ({
    statusCreatedIdx: index('sales_analytics_cube_snapshots_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
  }),
);
```

在 `index.ts` 增加：`export * from './sales-analytics';`

- [ ] **Step 2: SQL 迁移**

`packages/db/drizzle/0072_sales_analytics_cube.sql`：

```sql
CREATE TABLE IF NOT EXISTS "sales_analytics_cube_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" varchar(20) NOT NULL,
  "generated_at" timestamptz,
  "meta" jsonb,
  "payload" jsonb,
  "error_message" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_analytics_cube_snapshots_status_created_idx"
  ON "sales_analytics_cube_snapshots" ("status", "created_at");
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'data.sales_analytics', '销售分析看板', '/data/sales-analytics', p."id", 4, true
FROM "menus" p WHERE p."code" = 'data'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
  AND m."code" = 'data.sales_analytics'
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
```

Journal 追加 idx `74`、tag `0072_sales_analytics_cube`、`when` 用当前毫秒时间戳。

- [ ] **Step 3: seed.ts**

在 `data` children 于 `data.forecast` 后增加：

```ts
{ code: 'data.sales_analytics', name: '销售分析看板', path: '/data/sales-analytics', sortOrder: 4, isLeaf: true },
```

各角色菜单 code 列表加入 `'data.sales_analytics'`（与 `data.forecast` 同出现处）。

- [ ] **Step 4: 本地迁移（有 DB 时）**

按仓库既有 migrate 命令执行 0072（常见：`pnpm --filter @scm/db migrate` 或项目 SOP）。  
Expected: 表与菜单存在

- [ ] **Step 5: Commit**（仅用户要求时）

```bash
git add packages/db/src/schema/sales-analytics.ts packages/db/src/schema/index.ts \
  packages/db/drizzle/0072_sales_analytics_cube.sql packages/db/drizzle/meta/_journal.json \
  packages/db/src/seed.ts
git commit -m "feat(db): add sales analytics cube snapshots and menu"
```

---

### Task 3: Cube 构建与快照读写（TDD 纯函数 + 服务）

**Files:**
- Create: `apps/web/server/lib/sales-analytics-cube.ts`
- Create: `apps/web/server/lib/sales-analytics-cube.test.ts`

**Interfaces:**
- Consumes: dims helpers；`stationForWarehouse` from `forecast-demand.ts`；`normalizeSalesPlatformSync` from `sales-platform.ts`
- Produces:
  - `accumulateCubeRows(rows, warehouseStationByCode, platformNameByCode): SalesAnalyticsCubePayload`
  - `getLatestReadyCube(): Promise<SalesAnalyticsCubePayload | null>`
  - `getCubeStatus(): Promise<{ running: boolean; generatedAt: string | null; meta: ...; errorMessage: string | null }>`
  - `rebuildSalesAnalyticsCube(createdBy?: string | null): Promise<{ ok: true } | { ok: false; conflict: true } | { ok: false; error: string }>`

- [ ] **Step 1: 写失败测试（纯聚合）**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accumulateCubeRows } from './sales-analytics-cube.js';

describe('accumulateCubeRows', () => {
  it('rolls daily rows into month and week vectors by s/b/c/p', () => {
    const stationMap = new Map([['US-WEST', 'US'], ['DE-1', 'DE']]);
    const names = new Map([['AMAZON', '亚马逊'], ['UNKNOWN', '未知']]);
    const payload = accumulateCubeRows(
      [
        {
          saleDate: '2026-01-05',
          qtySold: 10,
          warehouseCode: 'US-WEST',
          channel: '亚马逊',
          category: '部\\项目1组-US\\书桌',
        },
        {
          saleDate: '2026-01-06',
          qtySold: 5,
          warehouseCode: 'US-WEST',
          channel: '亚马逊',
          category: '部\\项目1组-US\\书桌',
        },
        {
          saleDate: '2026-02-01',
          qtySold: 3,
          warehouseCode: 'DE-1',
          channel: 'wayfair',
          category: '部\\项目1组-US\\书桌',
        },
      ],
      stationMap,
      names,
    );
    assert.deepEqual(payload.months, ['2026-01', '2026-02']);
    assert.ok(payload.weeks.length >= 2);
    const us = payload.data.find((e) => e.s === 'US' && e.b === '项目1组' && e.p === '亚马逊');
    assert.ok(us);
    assert.equal(us.v[0], 15);
    assert.equal(us.v[1], 0);
    const eu = payload.data.find((e) => e.s === 'EU');
    assert.ok(eu);
    assert.equal(eu.v[1], 3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && node --import tsx --test server/lib/sales-analytics-cube.test.ts`  
Expected: FAIL

- [ ] **Step 3: 实现 `accumulateCubeRows` + DB 服务**

要点：

1. 扫描全部输入行，收集 `months`/`weeks` 有序集合，再二次填充向量（或两遍：先收集期轴，再累加）。
2. 站点：`warehouseCode` → `stationMap.get` → `bucketAnalyticsSite`；无仓 → `其他`。
3. 平台：`normalizeSalesPlatformSync(channel)` → 展示名 `platformNameByCode.get(code) ?? code`；`UNKNOWN` → `(未标注平台)`。
4. 品类：行 `category` 优先（调用方在读 DB 时用 `COALESCE(sales.category, skus.category)`）。
5. `rebuildSalesAnalyticsCube`：
   - 若存在 `status='running'` → `{ ok: false, conflict: true }`
   - insert `running`
   - 读 warehouses 建 stationMap（`stationForWarehouse(regionGroup, countryCode)`）
   - 读 `sales_platforms` 建 name map
   - 流式/分页读 `sales_history` left join `skus`（大批量时按 `sale_date` 或 id 分块）
   - `accumulateCubeRows` → update 同行 `ready` + payload/meta/`generated_at`；失败则 `failed` + `error_message`
   - 成功后删除过旧快照：保留最近 5 条（按 `created_at` desc），其余 DELETE
6. `getLatestReadyCube`：`where status=ready order by generated_at desc limit 1`

- [ ] **Step 4: 跑测试确认通过**

Run: 同上  
Expected: PASS

- [ ] **Step 5: Commit**（仅用户要求时）

```bash
git add apps/web/server/lib/sales-analytics-cube.ts apps/web/server/lib/sales-analytics-cube.test.ts
git commit -m "feat(sales-analytics): build and persist analytics cube snapshots"
```

---

### Task 4: HTTP API

**Files:**
- Create: `apps/web/server/routes/sales-analytics.ts`
- Modify: `apps/web/server/index.ts`（import + `app.route('/api', salesAnalyticsRoutes)`）

**Interfaces:**
- Consumes: cube 服务；`requireMenu('data.sales_analytics')`
- Produces:
  - `GET /api/sales-analytics/cube` → 200 payload 或 404 `{ error: 'NO_CUBE' }`
  - `GET /api/sales-analytics/status`
  - `POST /api/sales-analytics/rebuild` → 200 / 409

- [ ] **Step 1: 实现路由**

```ts
import { Hono } from 'hono';
import { requireMenu } from '../lib/rbac.js';
import { getCurrentUserOptional } from '../lib/auth-context.js';
import {
  getCubeStatus,
  getLatestReadyCube,
  rebuildSalesAnalyticsCube,
} from '../lib/sales-analytics-cube.js';

export const salesAnalyticsRoutes = new Hono();

salesAnalyticsRoutes.get('/sales-analytics/status', requireMenu('data.sales_analytics'), async (c) => {
  return c.json(await getCubeStatus());
});

salesAnalyticsRoutes.get('/sales-analytics/cube', requireMenu('data.sales_analytics'), async (c) => {
  const cube = await getLatestReadyCube();
  if (!cube) return c.json({ error: 'NO_CUBE' }, 404);
  return c.json(cube);
});

salesAnalyticsRoutes.post('/sales-analytics/rebuild', requireMenu('data.sales_analytics'), async (c) => {
  const user = await getCurrentUserOptional(c);
  const result = await rebuildSalesAnalyticsCube(user?.id ?? null);
  if ('conflict' in result && result.conflict) {
    return c.json({ error: 'REBUILD_IN_PROGRESS' }, 409);
  }
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json({ ok: true });
});
```

同步 rebuild 可接受（数据量中等）；若超时风险高，可改为 insert running 后 `setImmediate`/无 await 后台跑，status 轮询——一期优先同步，超时再改异步。

- [ ] **Step 2: 挂载**

在 `server/index.ts` 与其它 `app.route('/api', …)` 并列注册。

- [ ] **Step 3: 手工冒烟**

```bash
# 登录后
curl -s -b cookies.txt http://localhost:5173/api/sales-analytics/status
curl -s -b cookies.txt -X POST http://localhost:5173/api/sales-analytics/rebuild
curl -s -b cookies.txt http://localhost:5173/api/sales-analytics/cube | head -c 400
```

Expected: rebuild 后 cube 含 `months`/`weeks`/`data`

- [ ] **Step 4: Commit**（仅用户要求时）

```bash
git add apps/web/server/routes/sales-analytics.ts apps/web/server/index.ts
git commit -m "feat(sales-analytics): expose cube status and rebuild APIs"
```

---

### Task 5: 前端指标与轻量预测（TDD）

**Files:**
- Create: `apps/web/src/lib/sales-analytics-types.ts`
- Create: `apps/web/src/lib/sales-analytics-metrics.ts`
- Create: `apps/web/src/lib/sales-analytics-metrics.test.ts`
- Create: `apps/web/src/lib/sales-analytics-forecast.ts`
- Create: `apps/web/src/lib/sales-analytics-forecast.test.ts`

**Interfaces:**
- Produces:
  - `sumSeries(entities, gran): number[]`
  - `momPct(v, i): number | null` / `yoyPct(v, periods, i): number | null`
  - `filterEntities(data, sel): entities`
  - `chooseModel(v, isWeek): { type, ... }` / `modelForecast(...)` / `MODEL_NAME`
  - `nextPeriodLabel(label, k, isWeek)`

- [ ] **Step 1: 指标测试**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { momPct, yoyPct } from './sales-analytics-metrics.js';

describe('sales-analytics-metrics', () => {
  it('computes mom and yoy', () => {
    const v = [100, 110, 90];
    const periods = ['2025-01', '2025-02', '2026-02'];
    assert.equal(momPct(v, 0), null);
    assert.ok(Math.abs((momPct(v, 1) ?? 0) - 10) < 1e-6);
    // yoy: index 2 (2026-02) vs 2025-02 at index 1
    assert.ok(Math.abs((yoyPct(v, periods, 2) ?? 0) - ((90 - 110) / 110) * 100) < 1e-6);
  });
});
```

- [ ] **Step 2: 预测测试**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseModel, modelForecast } from './sales-analytics-forecast.js';

describe('sales-analytics-forecast', () => {
  it('picks naive for flat noisy short series', () => {
    const v = [10, 10, 10];
    const m = chooseModel(v, false);
    assert.ok(['naive', 'avg', 'trend'].includes(m.type));
    const fc = modelForecast(m, v.length, 3, '2026-07', false);
    assert.equal(fc.length, 3);
  });
});
```

阈值对齐原型（月）：`r2>=0.55 && trendRel>0.02` → trend/seasonal；`r2>=0.35` → avg；否则 naive。周度无季节。

- [ ] **Step 3: 实现 metrics + forecast 模块**（逻辑移植自 `.tmp-workbuddy-practice/.../dashboard_template.html` 的 `momPct`/`yoyPct`/`chooseModel`/`modelForecast`）

- [ ] **Step 4: 跑测试**

Run:

```bash
cd apps/web && node --import tsx --test src/lib/sales-analytics-metrics.test.ts src/lib/sales-analytics-forecast.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**（仅用户要求时）

```bash
git add apps/web/src/lib/sales-analytics-types.ts \
  apps/web/src/lib/sales-analytics-metrics.ts apps/web/src/lib/sales-analytics-metrics.test.ts \
  apps/web/src/lib/sales-analytics-forecast.ts apps/web/src/lib/sales-analytics-forecast.test.ts
git commit -m "feat(sales-analytics): add client metrics and lightweight forecast"
```

---

### Task 6: API 客户端 + 看板页壳（KPI/筛选/图）

**Files:**
- Modify: `apps/web/package.json`（依赖 `recharts`）
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/pages/SalesAnalyticsPage.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Produces: `api.getSalesAnalyticsCube` / `getSalesAnalyticsStatus` / `rebuildSalesAnalyticsCube`

- [ ] **Step 1: 安装 recharts**

```bash
cd apps/web && pnpm add recharts
```

- [ ] **Step 2: api.ts 增加方法**

```ts
getSalesAnalyticsStatus: () =>
  request<{
    running: boolean;
    generatedAt: string | null;
    meta: SalesAnalyticsCubePayload['meta'] | null;
    errorMessage: string | null;
  }>('/sales-analytics/status'),
getSalesAnalyticsCube: () => request<SalesAnalyticsCubePayload>('/sales-analytics/cube'),
rebuildSalesAnalyticsCube: () =>
  request<{ ok: true }>('/sales-analytics/rebuild', { method: 'POST' }),
```

（`request` 基路径已含 `/api` 则按现有写法。）

- [ ] **Step 3: 路由**

```tsx
import { SalesAnalyticsPage } from './pages/SalesAnalyticsPage';
// ...
<Route path="data/sales-analytics" element={<SalesAnalyticsPage />} />
```

- [ ] **Step 4: 页面壳**

`SalesAnalyticsPage.tsx` 最小可用：

- `PageHeader` 标题「销售分析看板」+ 副文案含 `generatedAt`
- 无 cube：提示 +「生成看板数据」按钮 → rebuild → 轮询 status → 拉 cube
- 有 cube：月/周 Tab；四维多选（默认全选）；期段起止；5 个 KPI；recharts `BarChart`（期销量）+ `LineChart`（MoM/YoY）
- 样式跟现有 Card / scm-design，不引入原型蓝紫主题硬编码为唯一风格；可用现有 tailwind token
- 重建中禁用刷新按钮

- [ ] **Step 5: 手工验证**

打开 `/data/sales-analytics`，刷新生成，切换月/周与筛选，KPI/图更新。

- [ ] **Step 6: Commit**（仅用户要求时）

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/api.ts \
  apps/web/src/pages/SalesAnalyticsPage.tsx apps/web/src/router.tsx
git commit -m "feat(sales-analytics): add dashboard shell with KPI and charts"
```

---

### Task 7: 明细矩阵、走势锁定、底部预估、CSV 导出

**Files:**
- Modify: `apps/web/src/pages/SalesAnalyticsPage.tsx`
- 可选拆分: `apps/web/src/components/sales-analytics/MatrixTable.tsx`、`ForecastPanel.tsx`（若单文件过大再拆）

- [ ] **Step 1: 明细矩阵**

- 模式：`b` / `s` / `sb` / `sc` / `sp` / `bc` / `bp`
- 列：期销量（筛选区间）+ 预测期（高亮背景）+ 预测模型 + 区间累计 / 最新期 MoM / YoY / 峰 / 谷
- 行点击 → `pinnedKey`；矩阵走势图显示该行或合计
- 文案：「看板粗估，非系统发布预测」

- [ ] **Step 2: 底部预估面板**

- `fcScope`: filter | all
- `fcHorizon`: 月 5–12 默认 5；周 20–52 默认 20
- 历史+预估折线；表：预估期、销量、环比、依据

- [ ] **Step 3: 矩阵 CSV 导出**

用现有 `buildCsv` 模式或前端拼 CSV + download：

```ts
function downloadMatrixCsv(filename: string, headers: string[], rows: string[][]) {
  const lines = [headers, ...rows].map((r) =>
    r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','),
  );
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
```

- [ ] **Step 4: 手工验收对照 spec §9.2**

- 独立菜单、月/周、四维、矩阵、粗估标注、刷新更新 `generatedAt`

- [ ] **Step 5: Commit**（仅用户要求时）

```bash
git add apps/web/src/pages/SalesAnalyticsPage.tsx apps/web/src/components/sales-analytics/
git commit -m "feat(sales-analytics): matrix, forecast panel, and CSV export"
```

---

### Task 8: 导入后可选异步刷新

**Files:**
- Modify: `apps/web/server/lib/sales-history-import.ts`（`persistDailySalesRowsAsHistory` 末尾）
- 或 import handler 成功回调处（若日销导入不经该函数，找实际入口）

- [ ] **Step 1: fire-and-forget**

在导入成功且 `insertedSalesRows > 0`（或月聚合完成）后：

```ts
void rebuildSalesAnalyticsCube(null).catch((err) => {
  console.warn('[sales-analytics] post-import rebuild failed', err);
});
```

不 await；不改变导入 API 响应。若已有 running，cube 服务返回 conflict，忽略即可。

- [ ] **Step 2: 确认导入路径覆盖日销与月宽表（若月宽表只写 monthly 不写 daily，则月导入后也应触发 rebuild；无日仓码时站点多为「其他」——可接受并在 status.meta 备注）**

- [ ] **Step 3: Commit**（仅用户要求时）

```bash
git add apps/web/server/lib/sales-history-import.ts
git commit -m "feat(sales-analytics): trigger cube rebuild after sales import"
```

---

## Spec Coverage Checklist

| Spec 项 | Task |
|---------|------|
| 独立菜单 `/data/sales-analytics` | 2, 6 |
| Cube 快照表 jsonb | 2, 3 |
| 四维 s/b/c/p + 海外组别 | 1, 3 |
| 月+周 | 3, 6 |
| KPI / 图 / 筛选 | 5, 6 |
| 矩阵 + 锁行 + 轻量预测 | 5, 7 |
| API cube/status/rebuild | 4 |
| 手动刷新 + 导入可选触发 | 4, 6, 8 |
| 不进发布预测 | 5, 7 文案 + 无写 forecast 表 |
| 不做 Excel 导入看板 | 全局约束 |
| 矩阵 CSV | 7 |
| 单测：维/聚合/MoM/模型 | 1, 3, 5 |

## 实现备注（相对 spec 的明确化）

1. **月序列数据源**：因 `sales_history_monthly` 无 `warehouse_code`，rebuild 用日表同时生成 `v` 与 `vw`。
2. **站点映射链**：`warehouse_code` → `stationForWarehouse(regionGroup, countryCode)` → `bucketAnalyticsSite`（DE→EU，UK 独立）。
3. **rebuild 一期同步**：若生产超时，再改为后台任务，API 契约不变（409 + status.running）。
