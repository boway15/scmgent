BASE 8f77778
HEAD a362a9b

a362a9b feat(forecast): relax T4B conservative factor and recent caps
 apps/web/server/lib/forecast-allcat-v41.test.ts | 13 ++++++++++++-
 apps/web/server/lib/forecast-allcat-v41.ts      | 10 +++++-----
 2 files changed, 17 insertions(+), 6 deletions(-)
diff --git a/apps/web/server/lib/forecast-allcat-v41.test.ts b/apps/web/server/lib/forecast-allcat-v41.test.ts
index f4a8953..72fd1fb 100644
--- a/apps/web/server/lib/forecast-allcat-v41.test.ts
+++ b/apps/web/server/lib/forecast-allcat-v41.test.ts
@@ -19,20 +19,22 @@ import {
   shouldBypassT99Classification,
   T99_RECENT_MONTH_DAILY_MIN,
   trendDecayFactor,
   tierConservativeFactor,
   applyV41CoreUpperBiasCap,
   applyV41MicroSalesUpperCap,
   applyV41TailUpperBiasCap,
   buildT99ReviewMessage,
   V41_T4B_NEAR_CONSERVATIVE_FACTOR,
   V41_T4B_CONSERVATIVE_FACTOR,
+  V41_T4B_RECENT30_CAP,
+  V41_T4B_RECENT90_CAP,
 } from './forecast-allcat-v41.js';
 
 function buildSeasonalMonthlyRows(): Array<{ saleYear: number; month: number; qtySold: number }> {
   const qtyByMonth: Record<number, number> = {
     1: 600,
     2: 700,
     3: 800,
     4: 900,
     5: 1000,
     6: 1100,
@@ -737,21 +739,21 @@ describe('forecast-allcat-v41', () => {
       baseDaily: 0.87,
       productCategory: 'U',
       forecastMonth: 7,
       horizonIndex: 0,
       metrics,
       recent30DailyAvg: 1.93,
       recent90DailyAvg: 1.36,
     });
     assert.equal(bounded.growthSignal, false);
     assert.ok(bounded.forecastDaily > 0);
-    assert.ok(bounded.forecastDaily <= 1.36 * 0.9);
+    assert.ok(bounded.forecastDaily <= 1.36 * 1.0); // V41_T4B_RECENT90_CAP
   });
 
   it('isAllCatV41RecentSalesAbsent detects weak and declining tail momentum', () => {
     assert.equal(
       isAllCatV41RecentSalesAbsent({
         recent30DailyAvg: 0,
         recent90DailyAvg: 0,
         metrics: { q1: 0, active2: 2 },
         tier: 'T4B',
       }),
@@ -968,20 +970,29 @@ describe('forecast-allcat-v41', () => {
         cv6: 0.9,
         trendRatio: 0.5,
       },
       recent30DailyAvg: 0.1,
       recent90DailyAvg: 0.2,
     });
     assert.equal(bounded.forecastDaily, 0);
     assert.equal(bounded.ghostGated, true);
   });
 
+  it('T4B plan-A constants: near 0.9 / far 0.75 / caps 0.95 & 1.0', () => {
+    assert.equal(V41_T4B_NEAR_CONSERVATIVE_FACTOR, 0.9);
+    assert.equal(V41_T4B_CONSERVATIVE_FACTOR, 0.75);
+    assert.equal(V41_T4B_RECENT30_CAP, 0.95);
+    assert.equal(V41_T4B_RECENT90_CAP, 1.0);
+    assert.equal(tierConservativeFactor('T4B', 'C', 0), 0.9);
+    assert.equal(tierConservativeFactor('T4B', 'C', 3), 0.75);
+  });
+
   it('T4B near horizon uses relaxed conservative factor and blend floor', () => {
     assert.equal(tierConservativeFactor('T4B', 'C', 0), V41_T4B_NEAR_CONSERVATIVE_FACTOR);
     assert.equal(tierConservativeFactor('T4B', 'C', 3), V41_T4B_CONSERVATIVE_FACTOR);
 
     const metrics = {
       q1: 300,
       q3: 900,
       q6: 1800,
       q12: 3600,
       d2: 12,
diff --git a/apps/web/server/lib/forecast-allcat-v41.ts b/apps/web/server/lib/forecast-allcat-v41.ts
index 8fe805e..723fd0b 100644
--- a/apps/web/server/lib/forecast-allcat-v41.ts
+++ b/apps/web/server/lib/forecast-allcat-v41.ts
@@ -159,23 +159,23 @@ export const V41_T4A_NEAR_CONSERVATIVE_FACTOR = 0.72;
 export const V41_T4A_FLOOR_MIN_DAILY = 0;
 export const V41_T4A_FLOOR_D6_RATIO = 0.08;
 export const V41_T4A_NEAR_BLEND_FLOOR = 0.65;
 export const V41_T4A_NEAR_D6_FLOOR = 0.7;
 export const V41_T4A_NEAR_RECENT90_FLOOR = 0.6;
 export const V41_T4A_FLEX_DECAY_FROM_K = 3;
 export const V41_T4A_FLEX_DECAY_FACTOR = 0.72;
 export const V41_T4A_MIN_TREND_RATIO = 0.8;
 export const V41_T4_TAIL_MONTH_DISCOUNT = 0.8;
 
-/** T4B 绋冲畾淇濆簳灞傦細杩滄湀鍘?ghost锛涜繎绔?k鈮? 鏀惧淇濆畧绯绘暟骞舵姮搴曪紙缂撹В绯荤粺鎬т綆浼帮級 */
-export const V41_T4B_CONSERVATIVE_FACTOR = 0.6;
-export const V41_T4B_NEAR_CONSERVATIVE_FACTOR = 0.8;
+/** T4B 绋冲畾淇濆簳灞傦細杩滄湀鍘?ghost锛涜繎绔?k鈮? 鏀惧淇濆畧绯绘暟骞舵姮搴曪紙缂撹В绯荤粺鎬т綆浼帮紝鏂规 A 娓╁拰涔愯锛?*/
+export const V41_T4B_CONSERVATIVE_FACTOR = 0.75;
+export const V41_T4B_NEAR_CONSERVATIVE_FACTOR = 0.9;
 export const V41_T4B_FLOOR_MIN_DAILY = 0;
 export const V41_T4B_FLOOR_D6_RATIO = 0.08;
 export const V41_T4B_NEAR_BLEND_FLOOR = 0.7;
 export const V41_T4B_NEAR_D6_FLOOR = 0.75;
 export const V41_T4B_NEAR_RECENT90_FLOOR = 0.65;
 export const V41_T4B_FLEX_DECAY_FROM_K = 3;
 export const V41_T4B_FLEX_DECAY_FACTOR = 0.72;
 
 /** 璺ㄥ钩鍙拌繎绔姮搴曪細鏈钩鍙拌繃浣庢椂锛屼笉浣庝簬鍏朵粬骞冲彴杩戠鏃ュ潎鐨?伪 鍊?*/
 export const V41_PEER_PLATFORM_FLOOR_ALPHA = 0.2;
@@ -200,22 +200,22 @@ export const V41_MID_NEAR_UPPER_BIAS = 0.05;
 export const V41_MID_FLEX_UPPER_BIAS = 0.04;
 export const V41_CORE_NEAR_UPPER_BIAS = 0.1;
 export const V41_CORE_FLEX_UPPER_BIAS = 0.08;
 
 /** T4A 涓婄晫鐩稿 recent/anchor 鐨勮创鍚堢郴鏁?*/
 export const V41_T4A_ANCHOR_CAP = 0.95;
 export const V41_T4A_RECENT90_CAP = 0.85;
 export const V41_T4A_RECENT30_CAP = 0.8;
 export const V41_T4A_D6_CAP = 0.9;
 export const V41_T4B_ANCHOR_CAP = 1.0;
-export const V41_T4B_RECENT90_CAP = 0.9;
-export const V41_T4B_RECENT30_CAP = 0.85;
+export const V41_T4B_RECENT90_CAP = 1.0;
+export const V41_T4B_RECENT30_CAP = 0.95;
 export const V41_T4B_D6_CAP = 0.95;
 
 function nonNegative(value: number | undefined | null): number {
   if (value == null || !Number.isFinite(value)) return 0;
   return Math.max(0, value);
 }
 
 /** 鏈€杩戜竴涓嚜鐒舵湀鎶樼畻鏃ュ潎锛堣蛋姝ユ湀琛ㄥ彛寰勶紝绾︾瓑浜庤繎 30 澶╋級 */
 export function resolveRecentMonthDailyAvg(metrics: Pick<AllCatV41Metrics, 'q1'>): number {
   return metrics.q1 > 0 ? metrics.q1 / 30 : 0;
