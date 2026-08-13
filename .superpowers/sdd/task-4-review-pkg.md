BASE 2874345
HEAD 46c5f1f

46c5f1f chore(forecast): validate July T4B/T99 plan-A relax offline
 apps/web/scripts/validate-july-t4b-relax.ts        | 233 ++++++++++++++
 .../plans/2026-08-12-t4b-t99-optimistic-relax.md   | 353 +++++++++++++++++++++
 .../2026-08-12-t4b-t99-optimistic-relax-design.md  |   2 +-
 3 files changed, 587 insertions(+), 1 deletion(-)
diff --git a/apps/web/scripts/validate-july-t4b-relax.ts b/apps/web/scripts/validate-july-t4b-relax.ts
new file mode 100644
index 0000000..6bb77c0
--- /dev/null
+++ b/apps/web/scripts/validate-july-t4b-relax.ts
@@ -0,0 +1,233 @@
+/**
+ * T4B+T99 鏂规 A 甯搁噺澶嶇洏锛氱敤宸插彂甯冪増鏈?7 鏈堣鐨?horizon_factors + 鏂扮増 T4B/T99 鍏紡锛?+ * 绂荤嚎澶嶇畻绯荤粺鏃ュ潎锛屽姣斿疄闄呴攢閲忥紝杈撳嚭鍒嗗眰 WMAPE / 鍋忓樊鎶ュ憡锛堜笉鍐欏簱锛夈€?+ *
+ * Usage: pnpm --filter @scm/web exec tsx scripts/validate-july-t4b-relax.ts
+ */
+import { config } from 'dotenv';
+import { resolve } from 'node:path';
+import { execFileSync } from 'node:child_process';
+import {
+  applyPeerPlatformNearFloor,
+  computeAllCatV41BoundedDaily,
+  V41_T4B_CONSERVATIVE_FACTOR,
+  V41_T4B_NEAR_CONSERVATIVE_FACTOR,
+  V41_T4B_RECENT30_CAP,
+  V41_T4B_RECENT90_CAP,
+  type AllCatV41Metrics,
+  type AllCatV41Tier,
+} from '../server/lib/forecast-allcat-v41.js';
+import { T99_SYSTEM_FLOOR_DISCOUNT } from '../server/lib/forecast-demand.js';
+
+const ROOT = resolve(import.meta.dirname, '../../..');
+config({ path: resolve(ROOT, '.env') });
+
+type Row = {
+  sku_code: string;
+  platform: string;
+  segment: string;
+  abcd: string;
+  blend_d: number;
+  old_system_d: number;
+  actual_m: number;
+  factors: string | null;
+};
+
+function q(sql: string): string {
+  return execFileSync(
+    'docker',
+    ['exec', 'scm-agent-postgres-1', 'psql', '-U', 'scm', '-d', 'scm_dev', '-t', '-A', '-c', sql],
+    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
+  ).trim();
+}
+
+function parseFactors(raw: string | null): Record<string, unknown> | null {
+  if (!raw) return null;
+  try {
+    const once = JSON.parse(raw);
+    if (typeof once === 'string') return JSON.parse(once);
+    return once as Record<string, unknown>;
+  } catch {
+    return null;
+  }
+}
+
+function num(v: unknown, fallback = 0): number {
+  const n = Number(v);
+  return Number.isFinite(n) ? n : fallback;
+}
+
+function recompute(row: Row): number {
+  const factors = parseFactors(row.factors);
+  const tier = (row.segment || 'T4B') as AllCatV41Tier;
+
+  const metrics: AllCatV41Metrics = {
+    q1: num(factors?.q1),
+    q3: num(factors?.q3),
+    q6: num(factors?.q6),
+    q12: num(factors?.q12),
+    d2: num(factors?.d2, num(factors?.d3)),
+    d3: num(factors?.d3),
+    d6: num(factors?.d6),
+    d12: num(factors?.d12),
+    active2: Math.round(num(factors?.active2)),
+    active6: Math.round(num(factors?.active6)),
+    active12: Math.round(num(factors?.active12)),
+    cv6: num(factors?.cv6),
+    trendRatio: num(factors?.trendRatio, 1),
+  };
+
+  const productCategory = String(factors?.productCategory ?? row.abcd ?? 'C');
+  const recent30 = num(factors?.recent30DailyAvg, null as unknown as number);
+  const recent90 = num(factors?.recent90DailyAvg, null as unknown as number);
+  const baseDaily = row.blend_d > 0 ? row.blend_d : num(factors?.levelDaily, row.old_system_d);
+
+  const bounded = computeAllCatV41BoundedDaily({
+    tier,
+    baseDaily,
+    productCategory,
+    forecastMonth: 7,
+    horizonIndex: 0,
+    metrics,
+    recent30DailyAvg: Number.isFinite(recent30) ? recent30 : null,
+    recent90DailyAvg: Number.isFinite(recent90) ? recent90 : null,
+  });
+
+  // 鍚?SKU 鍏朵粬骞冲彴杩戠锛氱敤鍚?sku 鍦?AMAZON 鐨勫疄闄呮棩鍧囦綔 peer 杩戜技锛堝鐩樼敤锛?+  return bounded.forecastDaily;
+}
+
+function wmape(rows: Array<{ system: number; actualD: number }>): number | null {
+  let abs = 0;
+  let act = 0;
+  for (const r of rows) {
+    if (r.actualD <= 0) continue;
+    abs += Math.abs(r.system - r.actualD);
+    act += r.actualD;
+  }
+  return act > 0 ? abs / act : null;
+}
+
+function bias(rows: Array<{ system: number; actualM: number }>): number | null {
+  let s = 0;
+  let a = 0;
+  for (const r of rows) {
+    s += r.system * 31;
+    a += r.actualM;
+  }
+  return a > 0 ? s / a - 1 : null;
+}
+
+function main() {
+  console.log('constants', {
+    T4B_near: V41_T4B_NEAR_CONSERVATIVE_FACTOR,
+    T4B_far: V41_T4B_CONSERVATIVE_FACTOR,
+    T4B_r30_cap: V41_T4B_RECENT30_CAP,
+    T4B_r90_cap: V41_T4B_RECENT90_CAP,
+    T99_discount: T99_SYSTEM_FLOOR_DISCOUNT,
+  });
+
+  const json = q(`
+    SELECT json_agg(t)
+    FROM (
+      SELECT
+        s.code AS sku_code,
+        sfm.platform,
+        COALESCE(sfm.profile_segment, '?') AS segment,
+        COALESCE(sfm.forecast_profile_class, '?') AS abcd,
+        sfm.baseline_daily_avg::float8 AS blend_d,
+        sfm.forecast_daily_avg::float8 AS old_system_d,
+        COALESCE(act.qty_sold, 0)::float8 AS actual_m,
+        sfm.horizon_factors::text AS factors
+      FROM sales_forecast_monthly sfm
+      JOIN skus s ON s.id = sfm.sku_id
+      JOIN sales_forecast_versions v ON v.id = sfm.version_id
+      LEFT JOIN sales_history_monthly act
+        ON act.sku_id = sfm.sku_id AND act.channel = sfm.platform
+       AND act.sale_year = 2026 AND act.month = 7
+      WHERE sfm.forecast_year = 2026 AND sfm.month = 7
+        AND v.status = 'published'
+        AND sfm.forecast_daily_avg::numeric > 0
+    ) t
+  `);
+
+  const rows = JSON.parse(json) as Row[];
+  const rescored = rows.map((row) => {
+    const newSystem = recompute(row);
+    const actualD = row.actual_m / 31;
+    return {
+      ...row,
+      new_system_d: newSystem,
+      actualD,
+    };
+  });
+
+  const bySeg = new Map<string, typeof rescored>();
+  for (const r of rescored) {
+    const list = bySeg.get(r.segment) ?? [];
+    list.push(r);
+    bySeg.set(r.segment, list);
+  }
+
+  const pct = (x: number | null) => (x == null ? '鈥? : `${(x * 100).toFixed(1)}%`);
+
+  console.log('=== 7 鏈堝鐩橈細鏃х郴缁?vs T4B+T99 鏂规 A锛堢绾块噸绠楋級===\n');
+  console.log(
+    [
+      '鍒嗗眰'.padEnd(6),
+      '琛屾暟'.padStart(6),
+      '鏃MAPE'.padStart(10),
+      '鏂癢MAPE'.padStart(10),
+      '鏃у亸宸?.padStart(10),
+      '鏂板亸宸?.padStart(10),
+    ].join(' '),
+  );
+
+  for (const [seg, list] of [...bySeg.entries()].sort((a, b) => b[1].length - a[1].length)) {
+    const oldW = wmape(list.map((r) => ({ system: r.old_system_d, actualD: r.actualD })));
+    const newW = wmape(list.map((r) => ({ system: r.new_system_d, actualD: r.actualD })));
+    const oldB = bias(list.map((r) => ({ system: r.old_system_d, actualM: r.actual_m })));
+    const newB = bias(list.map((r) => ({ system: r.new_system_d, actualM: r.actual_m })));
+    console.log(
+      [
+        seg.padEnd(6),
+        String(list.length).padStart(6),
+        pct(oldW).padStart(10),
+        pct(newW).padStart(10),
+        pct(oldB).padStart(10),
+        pct(newB).padStart(10),
+      ].join(' '),
+    );
+  }
+
+  const oldW = wmape(rescored.map((r) => ({ system: r.old_system_d, actualD: r.actualD })));
+  const newW = wmape(rescored.map((r) => ({ system: r.new_system_d, actualD: r.actualD })));
+  const oldB = bias(rescored.map((r) => ({ system: r.old_system_d, actualM: r.actual_m })));
+  const newB = bias(rescored.map((r) => ({ system: r.new_system_d, actualM: r.actual_m })));
+  console.log('\n鍏ㄤ綋', `鏃MAPE=${pct(oldW)} 鏂癢MAPE=${pct(newW)} 鏃у亸宸?${pct(oldB)} 鏂板亸宸?${pct(newB)}`);
+
+  // T99 婕忔姤瑕嗙洊锛氱郴缁?0 浣嗕粛鏈夊疄闄?+  const t99Miss = q(`
+    SELECT COUNT(*)::int, COALESCE(SUM(act.qty_sold),0)::bigint
+    FROM sales_forecast_monthly sfm
+    JOIN sales_forecast_versions v ON v.id = sfm.version_id
+    JOIN sales_history_monthly act
+      ON act.sku_id = sfm.sku_id AND act.channel = sfm.platform
+     AND act.sale_year = 2026 AND act.month = 7
+    WHERE sfm.forecast_year = 2026 AND sfm.month = 7 AND v.status = 'published'
+      AND sfm.forecast_daily_avg::numeric = 0 AND act.qty_sold > 0
+      AND COALESCE(sfm.profile_segment,'') = 'T99'
+  `);
+  const [t99Rows, t99Qty] = t99Miss.split('|');
+  console.log(`\nT99 婕忔姤锛堢郴缁?0 鏈夊疄闄咃級: ${t99Rows} 琛? 瀹為檯鏈堥攢閲?${t99Qty}锛堣ˉ璐т晶 t99_fallback 瑕嗙洊锛塦);
+
+  // peer floor smoke on known July underforecast
+  const peerDemo = applyPeerPlatformNearFloor({
+    forecastDaily: 0.23,
+    horizonIndex: 0,
+    peerPlatformRecentDaily: 20,
+  });
+  console.log(`\n璺ㄥ钩鍙版姮搴曟牱渚? 0.23 + peer20 鈫?${peerDemo.forecastDaily} (floor=${peerDemo.peerPlatformFloor})`);
+}
+
+main();
diff --git a/docs/superpowers/plans/2026-08-12-t4b-t99-optimistic-relax.md b/docs/superpowers/plans/2026-08-12-t4b-t99-optimistic-relax.md
new file mode 100644
index 0000000..26b2a6f
--- /dev/null
+++ b/docs/superpowers/plans/2026-08-12-t4b-t99-optimistic-relax.md
@@ -0,0 +1,353 @@
+# T4B / T99 娓╁拰涔愯鏀惧锛堟柟妗?A锛?Implementation Plan
+
+> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
+
+**Goal:** 灏?T4B / T99 姘翠綅甯搁噺娓╁拰鎶珮锛岀紦瑙ｅ垎灞傚鐩樹腑鐨勭郴缁熸€ф€婚噺浣庝及锛涙湰杞笉鏀?Ghost / 鏂攢闂搞€?+
+**Architecture:** 浠呮敼 `forecast-allcat-v41.ts` 涓?`forecast-demand.ts` 涓殑甯搁噺鍙婁緷璧栧畠浠殑鍏紡鏂囨/鍗曟祴锛沀I 涓‖缂栫爜銆屆?.6銆嶅悓姝ヤ负銆屆?.8銆嶃€傜敤鐜版湁 7 鏈堢绾胯剼鏈獙璇佸亸宸柟鍚戙€備笉寮哄埗閲嶇畻宸?published 鐗堟湰銆?+
+**Tech Stack:** TypeScript銆丯ode `tsx --test`銆佹棦鏈?V4.1 / T99 淇濆簳閾捐矾銆?+
+**Spec:** [`docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md`](../specs/2026-08-12-t4b-t99-optimistic-relax-design.md)
+
+## Global Constraints
+
+- T4B锛歚NEAR_CONSERVATIVE` 0.8鈫?*0.9**锛沗CONSERVATIVE` 0.6鈫?*0.75**锛沗RECENT30_CAP` 0.85鈫?*0.95**锛沗RECENT90_CAP` 0.9鈫?*1.0**
+- T99锛歚T99_SYSTEM_FLOOR_DISCOUNT` 涓庤ˉ璐?fallback 榛樿鎶樻墸 0.6鈫?*0.8**
+- **涓嶅彉**锛歍99 `recent30鈮?鈫?`锛汿99/T4B flex `k鈮? 脳0.72`锛汫host 寮卞姩閿€闃堝€硷紱T1鈥揟4A 甯搁噺锛沗t99FloorMode` 鏋氫妇鍚?`recent_max06` 淇濈暀
+- 浠呮柊鐢熸垚鐗堟湰鐢熸晥锛涗富 KPI 浠嶆帓闄?T4B/T99
+- 娴嬭瘯鍛戒护锛歚pnpm --filter @scm/web exec tsx --test <path>`
+
+---
+
+## File map
+
+| 鏂囦欢 | 鑱岃矗 |
+|------|------|
+| `apps/web/server/lib/forecast-demand.ts` | T99 鎶樻墸甯搁噺 + fallback 榛樿 |
+| `apps/web/server/lib/forecast-demand.test.ts` | T99 姘翠綅 / fallback 鏈熸湜鍊?|
+| `apps/web/server/lib/forecast-allcat-v41.ts` | T4B 鍥涘甯搁噺锛汿99 鍏紡/澶嶆牳鏂囨涓殑 脳0.6 |
+| `apps/web/server/lib/forecast-allcat-v41.test.ts` | T4B cap / T99 floor 鏈熸湜鍊?|
+| `apps/web/src/components/ForecastStrategySection.tsx` | 绛栫暐琛?T99 鍏紡鏂囨 |
+| `apps/web/src/pages/SalesForecastListPage.tsx` | 鍒楄〃 T99 璇存槑 |
+| `apps/web/scripts/validate-july-t4b-relax.ts` | 绂荤嚎澶嶇洏锛堝彲閫夊皬鏀癸細鎵撳嵃甯搁噺鐗堟湰锛涚‘璁ゅ惈 T99 閲嶇畻锛?|
+| `docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md` | 鐘舵€佹敼涓哄凡瀹炵幇锛堝叏閮ㄤ换鍔″畬鎴愬悗锛?|
+
+---
+
+### Task 1: T99 鎶樻墸 0.6鈫?.8锛圱DD锛?+
+**Files:**
+- Modify: `apps/web/server/lib/forecast-demand.test.ts`
+- Modify: `apps/web/server/lib/forecast-demand.ts`
+- Modify: `apps/web/server/lib/forecast-allcat-v41.test.ts`锛堟湰浠诲姟鍙敼 T99 鐩稿叧鏂█锛汿4B 鐣欑粰 Task 2锛?+- Modify: `apps/web/server/lib/forecast-allcat-v41.ts`锛堝叕寮忓瓧绗︿覆涓?`buildT99ReviewMessage` 涓殑 脳0.6锛?+
+**Interfaces:**
+- Consumes: 鐜版湁 `resolveT99SystemFloorDaily` / `resolveT99ReplenishmentFallbackDaily`
+- Produces: `T99_SYSTEM_FLOOR_DISCOUNT = 0.8`锛沠allback 榛樿 `discount = 0.8`锛涙暟鍊兼湡鏈?`max(r30,r90)*0.8`
+
+- [ ] **Step 1: 鏀瑰け璐ュ崟娴嬶紙demand锛?*
+
+灏?`forecast-demand.test.ts` 涓笅鍒楁柇瑷€鏀逛负 0.8 鍙ｅ緞锛?+
+```ts
+it('resolveT99SystemFloorDaily uses max(r30,r90)*0.8 near and *0.72 far', () => {
+  // max(2, 4) * 0.8 = 3.2; far = 3.2 * 0.72 = 2.304
+  const near = resolveT99SystemFloorDaily({
+    recent30DailyAvg: 2,
+    recent90DailyAvg: 4,
+    horizonIndex: 1,
+  });
+  const far = resolveT99SystemFloorDaily({
+    recent30DailyAvg: 2,
+    recent90DailyAvg: 4,
+    horizonIndex: 3,
+  });
+  assert.equal(near.daily, 3.2);
+  assert.equal(near.mode, 'recent_max06');
+  assert.equal(far.daily, 2.304);
+  assert.equal(far.mode, 'recent_max06');
+});
+```
+
+灏嗐€孴99 zero forecast falls back鈥︺€嶄腑鏈熸湜 `1.2` 鏀逛负 `1.6`锛坄max(2,1)*0.8`锛夛紝涓ゅ `assert.equal(..., 1.2)` 鈫?`1.6`銆?+
+鏂攢闂告祴渚嬶紙daily=0锛?*涓嶈鏀?*銆?+
+- [ ] **Step 2: 璺戞祴纭澶辫触**
+
+Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts`
+
+Expected: FAIL锛堜粛涓?2.4 / 1.2锛?+
+- [ ] **Step 3: 鏀瑰疄鐜板父閲?*
+
+鍦?`forecast-demand.ts`锛?+
+```ts
+export const T99_SYSTEM_FLOOR_DISCOUNT = 0.8;
+```
+
+`resolveT99ReplenishmentFallbackDaily` 娉ㄩ噴涓庨粯璁わ細
+
+```ts
+  /** 鐩稿杩戞湡鍔ㄩ攢鐨勬姌鎵ｏ紝榛樿 0.8锛堜笌 T99_SYSTEM_FLOOR_DISCOUNT 瀵归綈锛?*/
+  discount?: number;
+}): number {
+  const discount =
+    input.discount != null && Number.isFinite(input.discount) && input.discount > 0
+      ? input.discount
+      : 0.8;
+```
+
+浼樺厛锛氶粯璁ゆ姌鎵ｇ洿鎺ュ紩鐢ㄥ父閲忥紝閬垮厤婕傜Щ锛?+
+```ts
+      : T99_SYSTEM_FLOOR_DISCOUNT;
+```
+
+- [ ] **Step 4: 鍚屾 allcat T99 鏂█涓庢枃妗?*
+
+`forecast-allcat-v41.test.ts` 涓?`computeAllCatV41ForecastForMonth writes T99 floor...`锛?+
+```ts
+assert.equal(result.forecastDaily, 2.4); // max(3,2)*0.8
+assert.equal(result.formula, 'max(recent30,recent90)*0.8 with far decay');
+assert.equal(result.horizonFactors.t99FloorDaily, 2.4);
+```
+
+`forecast-allcat-v41.ts`锛?+
+- `tierFormula` T99 鍒嗘敮锛歚'max(recent30,recent90)*0.8 with far decay'`
+- `buildT99ReviewMessage`锛歚锛坢ax(杩?0,杩?0)脳0.8锛岃繙鏈堣“鍑忥級`
+
+- [ ] **Step 5: 璺戞祴閫氳繃**
+
+Run:
+
+```bash
+pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts
+pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts
+```
+
+Expected: PASS锛堣嫢 allcat 鍥?T4B 鏃?cap 鏂█灏氭湭鏀硅€屽け璐ワ紝鍙厛鍙‘璁?demand + T99 鐩稿叧鐢ㄤ緥锛涘畬鏁?allcat 鍦?Task 2 鍚庡繀缁匡級
+
+- [ ] **Step 6: Commit**
+
+```bash
+git add apps/web/server/lib/forecast-demand.ts apps/web/server/lib/forecast-demand.test.ts apps/web/server/lib/forecast-allcat-v41.ts apps/web/server/lib/forecast-allcat-v41.test.ts
+git commit -m "feat(forecast): raise T99 floor discount 0.6鈫?.8"
+```
+
+---
+
+### Task 2: T4B 鍥涘甯搁噺鏀惧锛圱DD锛?+
+**Files:**
+- Modify: `apps/web/server/lib/forecast-allcat-v41.ts`
+- Modify: `apps/web/server/lib/forecast-allcat-v41.test.ts`
+
+**Interfaces:**
+- Consumes: `tierConservativeFactor` / `applyV41TailUpperBiasCap` / `computeAllCatV41BoundedDaily`
+- Produces: 鏂板父閲忓€煎涓?+
+```ts
+export const V41_T4B_CONSERVATIVE_FACTOR = 0.75;
+export const V41_T4B_NEAR_CONSERVATIVE_FACTOR = 0.9;
+export const V41_T4B_RECENT90_CAP = 1.0;
+export const V41_T4B_RECENT30_CAP = 0.95;
+```
+
+- [ ] **Step 1: 鏀?琛ュけ璐ユ柇瑷€**
+
+鐜版湁鐢ㄤ緥宸茬敤甯搁噺绗﹀彿鏂█ `tierConservativeFactor`锛屽父閲忎竴鏀瑰嵆鑷姩璺熸柊銆傞渶鏀圭‖缂栫爜 cap锛?+
+`computeAllCatV41BoundedDaily caps T4B with tail upper bias`锛?+
+```ts
+assert.ok(bounded.forecastDaily <= 1.36 * 1.0); // V41_T4B_RECENT90_CAP
+```
+
+鍦ㄥ悓鏂囦欢杩藉姞锛堟垨鎵╁睍鐜版湁 near horizon 鐢ㄤ緥锛夋樉寮忛攣瀹氭暟鍊硷細
+
+```ts
+it('T4B plan-A constants: near 0.9 / far 0.75 / caps 0.95 & 1.0', () => {
+  assert.equal(V41_T4B_NEAR_CONSERVATIVE_FACTOR, 0.9);
+  assert.equal(V41_T4B_CONSERVATIVE_FACTOR, 0.75);
+  assert.equal(V41_T4B_RECENT30_CAP, 0.95);
+  assert.equal(V41_T4B_RECENT90_CAP, 1.0);
+  assert.equal(tierConservativeFactor('T4B', 'C', 0), 0.9);
+  assert.equal(tierConservativeFactor('T4B', 'C', 3), 0.75);
+});
+```
+
+纭繚 import 鍚?`V41_T4B_RECENT30_CAP`銆乣V41_T4B_RECENT90_CAP`锛堣嫢灏氭湭 import锛夈€?+
+- [ ] **Step 2: 璺戞祴纭澶辫触锛堝父閲忎粛涓烘棫鍊兼椂锛?*
+
+Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts`
+
+Expected: 鏂板父閲忔柇瑷€ FAIL
+
+- [ ] **Step 3: 鏀瑰父閲?*
+
+鍦?`forecast-allcat-v41.ts` 灏嗘敞閲娿€岀紦瑙ｇ郴缁熸€т綆浼般€嶄繚鐣欙紝鏇存柊鍥涘€硷細
+
+```ts
+/** T4B 绋冲畾淇濆簳灞傦細杩滄湀鍘?ghost锛涜繎绔?k鈮? 鏀惧淇濆畧绯绘暟骞舵姮搴曪紙鏂规 A 娓╁拰涔愯锛?*/
+export const V41_T4B_CONSERVATIVE_FACTOR = 0.75;
+export const V41_T4B_NEAR_CONSERVATIVE_FACTOR = 0.9;
+// ...
+export const V41_T4B_RECENT90_CAP = 1.0;
+export const V41_T4B_RECENT30_CAP = 0.95;
+```
+
+鍕挎敼 `V41_T4B_FLEX_*`銆佽繎绔姮搴曘€丟host 闃堝€笺€?+
+- [ ] **Step 4: 璺戝叏閲忕浉鍏冲崟娴?*
+
+Run:
+
+```bash
+pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts
+pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts
+```
+
+Expected: PASS
+
+- [ ] **Step 5: Commit**
+
+```bash
+git add apps/web/server/lib/forecast-allcat-v41.ts apps/web/server/lib/forecast-allcat-v41.test.ts
+git commit -m "feat(forecast): relax T4B conservative factor and recent caps"
+```
+
+---
+
+### Task 3: UI 鏂囨鍚屾 脳0.6鈫捗?.8
+
+**Files:**
+- Modify: `apps/web/src/components/ForecastStrategySection.tsx`
+- Modify: `apps/web/src/pages/SalesForecastListPage.tsx`
+
+**Interfaces:**
+- 鏃犳柊 API锛涗粎灞曠ず鏂囨涓庡悗绔姌鎵ｄ竴鑷?+
+- [ ] **Step 1: 鏀圭瓥鐣ヨ〃涓庡垪琛ㄨ鏄?*
+
+`ForecastStrategySection.tsx` T99 琛岋細
+
+```ts
+'max(杩?0,杩?0)脳0.8锛岃繙鏈埫?.72锛涗笉杩涗富 KPI'
+```
+
+`SalesForecastListPage.tsx`锛?+
+```tsx
+max(杩?0,杩?0)脳0.8
+```
+
+锛堟暣鍙ュ叾浣欓儴鍒嗕笉鍙樸€傦級
+
+- [ ] **Step 2: 鍏ㄥ簱鎵畫鐣欑‖缂栫爜**
+
+Run锛堝湪 `apps/web`锛夛細
+
+```bash
+rg "杩?0\)脳0\.6|recent90\)\*0\.6|max\(杩?0,杩?0\)脳0\.6" -g "*.ts" -g "*.tsx"
+```
+
+Expected: 鏃犱笟鍔℃枃妗堝懡涓紙娴嬭瘯鍘嗗彶娉ㄩ噴闄ゅ锛沗recent_max06` 鏋氫妇鍚嶅彲淇濈暀锛?+
+- [ ] **Step 3: Commit**
+
+```bash
+git add apps/web/src/components/ForecastStrategySection.tsx apps/web/src/pages/SalesForecastListPage.tsx
+git commit -m "docs(forecast): sync T99 UI copy to 0.8 floor discount"
+```
+
+---
+
+### Task 4: 绂荤嚎 7 鏈堝鐩?+ 鏀跺熬
+
+**Files:**
+- Modify (鍙€?: `apps/web/scripts/validate-july-t4b-relax.ts` 鈥?鍦ㄦ爣棰樻墦鍗板綋鍓?`V41_T4B_*` / `T99_SYSTEM_FLOOR_DISCOUNT`
+- Modify: `docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md` 鈥?鐘舵€佹敼涓恒€屽凡瀹炵幇銆?+
+**Interfaces:**
+- 鑴氭湰浠嶄笉鍐欏簱锛汿99 琛岃嫢 `old_system_d>0` 鍙蛋 `computeAllCatV41BoundedDaily`锛涜剼鏈幇鏈?`tier === 'T99' return 0` 闇€鏀逛负璋冪敤鐪熷疄 T99 鍒嗘敮锛堝惁鍒欏鐩樼湅涓嶅埌鎶樻墸鎶崌锛?+
+- [ ] **Step 1: 淇剼鏈?T99 閲嶇畻**
+
+灏?`recompute` 涓細
+
+```ts
+if (tier === 'T99') return 0;
+```
+
+鏀逛负鐓у父璋冪敤 `computeAllCatV41BoundedDaily`锛堜笌鍏跺畠灞傜浉鍚岋級锛岃 T99 璧扮郴缁熶繚搴曘€?+
+鏂囦欢澶存敞閲婃敼涓鸿鏄庛€孴4B+T99 鏂规 A 甯搁噺澶嶇洏銆嶃€?+
+鍦?`main` 寮€澶?`console.log` 鎵撳嵃锛?+
+```ts
+import {
+  V41_T4B_CONSERVATIVE_FACTOR,
+  V41_T4B_NEAR_CONSERVATIVE_FACTOR,
+  V41_T4B_RECENT30_CAP,
+  V41_T4B_RECENT90_CAP,
+} from '../server/lib/forecast-allcat-v41.js';
+import { T99_SYSTEM_FLOOR_DISCOUNT } from '../server/lib/forecast-demand.js';
+
+console.log('constants', {
+  T4B_near: V41_T4B_NEAR_CONSERVATIVE_FACTOR,
+  T4B_far: V41_T4B_CONSERVATIVE_FACTOR,
+  T4B_r30_cap: V41_T4B_RECENT30_CAP,
+  T4B_r90_cap: V41_T4B_RECENT90_CAP,
+  T99_discount: T99_SYSTEM_FLOOR_DISCOUNT,
+});
+```
+
+- [ ] **Step 2: 璺戠绾垮鐩橈紙鐜鍏佽鏃讹級**
+
+Run: `pnpm --filter @scm/web exec tsx scripts/validate-july-t4b-relax.ts`
+
+Expected: 杈撳嚭鍚?T4B / T99 琛岋紱鐩稿銆屾棫绯荤粺銆嶅亸宸簲鍚?0 闈犳嫝锛堜笉瑕佹眰涓€娆¤揪鏍?0锛夈€傝嫢鏈満鏃?Docker/DB锛岃褰曡烦杩囧師鍥狅紝涓嶉樆濉炲悎骞讹紱鍗曟祴宸茶鐩栧父閲忋€?+
+- [ ] **Step 3: 鏍囪 spec 宸插疄鐜?*
+
+灏嗚璁℃枃妗ｅご閮ㄦ敼涓猴細
+
+```markdown
+> **鐘舵€?*锛氬凡瀹炵幇  
+```
+
+- [ ] **Step 4: Commit**
+
+```bash
+git add apps/web/scripts/validate-july-t4b-relax.ts docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md
+git commit -m "chore(forecast): validate July T4B/T99 plan-A relax offline"
+```
+
+---
+
+## Spec coverage checklist
+
+| Spec 瑕佹眰 | Task |
+|-----------|------|
+| T4B 鍥涘父閲?| Task 2 |
+| T99 鎶樻墸 0.8 + fallback 瀵归綈 | Task 1 |
+| 涓嶆柇閿€闂?/ 涓?Ghost | 鍏ㄤ换鍔′笉鏀圭浉鍏抽槇鍊?|
+| 鍗曟祴 | Task 1鈥? |
+| UI 脳0.6 鍚屾 | Task 3 |
+| 7 鏈堢绾垮鐩?| Task 4 |
+| 浠呮柊鐗堟湰鐢熸晥 | 鏃犱唬鐮佸己鍒堕噸绠?|
+| 鏂规 B 涓嶅仛 | 鏈垪鍏ヤ换鍔?|
+
+## Self-review
+
+- 鏃?TBD / 銆岀被浼?Task N銆嶅崰浣?+- T99 鏁板€硷細`max(2,4)*0.8=3.2`锛宍*0.72=2.304`锛沗max(3,2)*0.8=2.4`锛沠allback `max(2,1)*0.8=1.6` 鈥?涓庡疄鐜颁竴鑷?+- `recent_max06` 鏋氫妇鍚嶆寜 spec 淇濈暀
diff --git a/docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md b/docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md
index c5c3246..86c458d 100644
--- a/docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md
+++ b/docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md
@@ -1,11 +1,11 @@
 # T4B / T99 娓╁拰涔愯鏀惧锛堟柟妗?A锛? 
-> **鐘舵€?*锛氬凡鎵瑰噯璁捐  
+> **鐘舵€?*锛氬凡瀹炵幇  
 > **鏃ユ湡**锛?026-08-12  
 > **鐩爣**锛氱紦瑙ｅ垎灞傚鐩樹腑 T4B / T99 绯荤粺鎬ф€婚噺浣庝及锛涘厛鍋氭俯鍜屾姮绯绘暟锛岀绾?7 鏈堝鐩樺悗鍐嶅喅瀹氭槸鍚﹀姞鏂规 B锛堟紡鎶ラ椄锛夈€? 
 ---
 
 ## 1. 鑳屾櫙涓庡喅绛? 
 鍒嗗眰鍑嗙‘鐜囷紙鍏ㄦ湡鏈夌鍙?MAPE锛夋樉绀哄熬閮ㄤ袱灞傛槑鏄句綆浼帮細
