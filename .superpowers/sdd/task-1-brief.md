### Task 1: 补货任务 dry-run 与基线导出

迁移前先固定基线。此任务不改变任何业务结果。

**Files:**
- Modify: `apps/web/server/tasks/replenishmentForecast.ts`
- Create: `apps/web/scripts/replenishment-baseline.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ReplenishmentRunOptions = {
    dryRun?: boolean;          // true：不同步三池、不写任何表、不调 Dify
    skuIds?: string[];         // 只跑这些 SKU
  };
  export type ReplenishmentDryRow = {
    skuCode: string;
    warehouseCode: string;     // 网络行为 'NETWORK'
    suggestedQty: number;
    suggestedDate: string;
    healthStatus: string;
    needsManualConfirm: boolean;
  };
  export type ReplenishmentHealthDryRow = {
    skuCode: string;
    warehouseCode: string;
    healthStatus: string;
    suggestedQty: number;
    suggestedDate: string;
  };
  export async function runReplenishmentForecast(options?: ReplenishmentRunOptions): Promise<{
    suggestionCount: number;
    snapshotCount: number;
    engine?: string;
    difyEnhanced?: boolean;
    results: Array<{ skuCode: string; warehouseCode: string; suggestedQty: number; healthStatus: InventoryHealth; reason: string }>;
    dry?: { suggestions: ReplenishmentDryRow[]; health: ReplenishmentHealthDryRow[] };
    message?: string;
  }>;
  ```

- [ ] **Step 1: 改函数签名与写库分支**

在 `replenishmentForecast.ts` 顶部（`positionKey` 之后）加入类型，并修改函数：

```ts
export type ReplenishmentRunOptions = {
  /** 试算 / 基线：不同步三池、不写任何表、不调 Dify */
  dryRun?: boolean;
  skuIds?: string[];
};

export type ReplenishmentDryRow = {
  skuCode: string;
  warehouseCode: string;
  suggestedQty: number;
  suggestedDate: string;
  healthStatus: string;
  needsManualConfirm: boolean;
};

export type ReplenishmentHealthDryRow = {
  skuCode: string;
  warehouseCode: string;
  healthStatus: string;
  suggestedQty: number;
  suggestedDate: string;
};
```

`export async function runReplenishmentForecast()` 改为 `export async function runReplenishmentForecast(options: ReplenishmentRunOptions = {})`，并做以下替换：

1. 开头三池同步包一层：
   ```ts
   const dryRun = options.dryRun === true;
   if (!dryRun) {
     try {
       await syncInventorySupplyLots();
     } catch (err) {
       console.warn('[replenishmentForecast] supply lot sync skipped:', err);
     }
   }
   ```
2. `activeSkus` 查询的 `.where(eq(skus.isActive, true))` 改为：
   ```ts
   .where(
     options.skuIds?.length
       ? and(eq(skus.isActive, true), inArray(skus.id, options.skuIds))
       : eq(skus.isActive, true),
   );
   ```
3. 循环内 `await upsertSafetyStock(...)` 改为 `if (!dryRun) await upsertSafetyStock(...)`。
4. `const snapshotCount = await saveHealthSnapshots(healthRows);` 与 `await syncReplenishLightFromHealth(healthRows);` 改为：
   ```ts
   const snapshotCount = dryRun ? 0 : await saveHealthSnapshots(healthRows);
   if (!dryRun) await syncReplenishLightFromHealth(healthRows);
   ```
5. `const shouldEnhance = ...` 改为 `const shouldEnhance = !dryRun && eligibleItems.length > 0 && isReplenishmentWorkflowEnabled();`
6. 在 `const expireSkuIds = ...` 之前插入 dry-run 提前返回：
   ```ts
   if (dryRun) {
     return {
       suggestionCount: eligibleItems.length,
       snapshotCount: 0,
       results: [],
       dry: {
         suggestions: eligibleItems.map((item) => ({
           skuCode: item.skuCode,
           warehouseCode: item.warehouseCode ?? 'NETWORK',
           suggestedQty: item.suggestedQty,
           suggestedDate: item.suggestedDate,
           healthStatus: item.healthStatus,
           needsManualConfirm: item.metrics?.needsManualConfirm === true,
         })),
         health: healthRows.map((row) => ({
           skuCode: row.skuCode,
           warehouseCode: row.warehouseCode,
           healthStatus: row.healthStatus,
           suggestedQty: row.suggestedQty,
           suggestedDate: row.suggestedDate,
         })),
       },
     };
   }
   ```
   若 `SkuHealthRow` 上字段名与此不符（`skuCode`、`warehouseCode`、`healthStatus`、`suggestedQty`、`suggestedDate`），以 `inventory-health-service.ts` 中 `SkuHealthRow` 定义为准调整映射，不改语义。

- [ ] **Step 2: 写基线脚本**

`apps/web/scripts/replenishment-baseline.ts`：

默认抽样：最近有补货建议的在售 SKU 最多 300 个，加上其余在售 SKU 按编码顺序取 200 个；抽中的 SKU id 写进基线文件，`compare` 用同一批 SKU。`--full` 跑全部在售 SKU（全量单次可能超过 1 小时，只在 Task 10 收尾时用）。

```ts
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { and, asc, desc, eq, notInArray } from 'drizzle-orm';
import { db, reorderSuggestions, skus } from '@scm/db';
import { runReplenishmentForecast } from '../server/tasks/replenishmentForecast.js';

const SAMPLE_WITH_SUGGESTIONS = 300;
const SAMPLE_OTHERS = 200;

async function pickSampleSkuIds(): Promise<string[]> {
  const suggested = await db
    .selectDistinct({ id: skus.id, generatedAt: reorderSuggestions.generatedAt })
    .from(reorderSuggestions)
    .innerJoin(skus, eq(reorderSuggestions.skuId, skus.id))
    .where(eq(skus.isActive, true))
    .orderBy(desc(reorderSuggestions.generatedAt));
  const withSuggestions = [...new Set(suggested.map((r) => r.id))].slice(0, SAMPLE_WITH_SUGGESTIONS);
  const others = await db
    .select({ id: skus.id })
    .from(skus)
    .where(
      withSuggestions.length
        ? and(eq(skus.isActive, true), notInArray(skus.id, withSuggestions))
        : eq(skus.isActive, true),
    )
    .orderBy(asc(skus.code))
    .limit(SAMPLE_OTHERS);
  return [...withSuggestions, ...others.map((r) => r.id)];
}

type Row = Record<string, string | number | boolean>;

function keyOf(row: Row): string {
  return `${row.skuCode}::${row.warehouseCode}`;
}

function sortRows<T extends Row>(rows: T[]): T[] {
  return [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

function diffRows(name: string, base: Row[], next: Row[]): string[] {
  const out: string[] = [];
  const baseMap = new Map(base.map((r) => [keyOf(r), r]));
  const nextMap = new Map(next.map((r) => [keyOf(r), r]));
  for (const [key, row] of baseMap) {
    const other = nextMap.get(key);
    if (!other) {
      out.push(`[${name}] 缺失 ${key}`);
      continue;
    }
    for (const field of Object.keys(row)) {
      if (row[field] !== other[field]) {
        out.push(`[${name}] ${key} ${field}: ${row[field]} → ${other[field]}`);
      }
    }
  }
  for (const key of nextMap.keys()) {
    if (!baseMap.has(key)) out.push(`[${name}] 新增 ${key}`);
  }
  return out;
}

type Baseline = {
  /** null 表示全量 */
  skuIds: string[] | null;
  suggestions: Row[];
  health: Row[];
};

async function main() {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const [mode, file] = args.filter((a) => !a.startsWith('--'));
  if ((mode !== 'export' && mode !== 'compare') || !file) {
    console.error('用法: tsx scripts/replenishment-baseline.ts <export|compare> <file.json> [--full]');
    process.exit(2);
  }
  const base = mode === 'compare' ? (JSON.parse(readFileSync(file, 'utf8')) as Baseline) : null;
  const skuIds = base ? base.skuIds : full ? null : await pickSampleSkuIds();
  const started = Date.now();
  const result = await runReplenishmentForecast({ dryRun: true, ...(skuIds ? { skuIds } : {}) });
  const current: Baseline = {
    skuIds,
    suggestions: sortRows(result.dry?.suggestions ?? []),
    health: sortRows(result.dry?.health ?? []),
  };
  const seconds = Math.round((Date.now() - started) / 1000);
  if (mode === 'export') {
    writeFileSync(file, JSON.stringify(current, null, 2), 'utf8');
    console.log(
      `已导出 ${skuIds ? `${skuIds.length} 个 SKU` : '全量'}：${current.suggestions.length} 条建议、${current.health.length} 条健康行，用时 ${seconds}s → ${file}`,
    );
    process.exit(0);
  }
  if (!base) process.exit(2);
  const diffs = [
    ...diffRows('suggestions', base.suggestions, current.suggestions),
    ...diffRows('health', base.health, current.health),
  ];
  if (diffs.length) {
    console.error(diffs.slice(0, 200).join('\n'));
    console.error(`共 ${diffs.length} 处差异`);
    process.exit(1);
  }
  console.log('与基线一致');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: 跑现有测试**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts server/lib/replenishment-coverage.test.ts server/lib/network-replenishment.test.ts server/lib/replenish-light-sync.test.ts`
Expected: `fail 0`

- [ ] **Step 4: 导出基线**

前置：本地数据库为一份生产快照（按 `docs/local-server-release-sop.md` 恢复），`.env` 指向它。

Run: `pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts export ../../.tmp-rules-baseline.json`
Expected: 输出「已导出 K 个 SKU：N 条建议、M 条健康行」，K ≈ 500，N、M > 0。

然后立即跑一次 compare，确认 dry-run 结果可重复（同一代码两次运行一致）：

Run: `pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts compare ../../.tmp-rules-baseline.json`
Expected: `与基线一致`。若不一致，说明计算本身有不确定性（如依赖当前时刻），须先查明原因再继续。

基线文件不提交（`.tmp-*` 前缀）。**时间轴依赖当天日期，基线对照须在同一天完成**；跨天时按 Task 8 Step 1 用 worktree 重新导出基线。

- [ ] **Step 5: Commit 并打标签**

```bash
git add apps/web/server/tasks/replenishmentForecast.ts apps/web/scripts/replenishment-baseline.ts
git commit -m "feat(replenishment): dry-run option and baseline export script"
git tag rules-p0-baseline
```

---

