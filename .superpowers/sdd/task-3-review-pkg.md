BASE a362a9b
HEAD 2874345

2874345 docs(forecast): sync T99 UI copy to 0.8 floor discount
 apps/web/src/components/ForecastStrategySection.tsx | 2 +-
 apps/web/src/pages/SalesForecastListPage.tsx        | 2 +-
 2 files changed, 2 insertions(+), 2 deletions(-)
diff --git a/apps/web/src/components/ForecastStrategySection.tsx b/apps/web/src/components/ForecastStrategySection.tsx
index 1708ed4..8d7cb98 100644
--- a/apps/web/src/components/ForecastStrategySection.tsx
+++ b/apps/web/src/components/ForecastStrategySection.tsx
@@ -34,21 +34,21 @@ type Props = {
   active: boolean;
 };
 
 const ALL_CATEGORY_V41_TIERS = [
   ['T1', '鏍稿績绋冲畾楂橀攢閲?, 'A/C: AMAZON d6鈮?0锛汢: AMAZON d6鈮?8锛涜繎6鏈堝叏鍔ㄩ攢銆佽繎2鏈堣繛缁姩閿€銆乧v6鈮?.65~0.70', '0.15*d2 + 0.55*d6 + 0.30*d12锛屽啀鍋氳秼鍔?鏈堜唤/淇濆畧绯绘暟涓庝笂涓嬮檺鎴柇', '鏍稿績 KPI锛歐MAPE鈮?0%锛孊ias卤10%'],
   ['T2', '鏍稿績楂橀攢閲?, 'A/U: d6闂ㄦ鏇撮珮锛汢/C: AMAZON d6鈮?~10锛沘ctive6鈮?銆乤ctive2=2銆乧v6鈮?.80~0.90', '0.25*d3 + 0.55*d6 + 0.20*d12锛屽啀鍋氳秼鍔?鏈堜唤/淇濆畧绯绘暟涓庝笂涓嬮檺鎴柇', '鏍稿績 KPI锛歐MAPE鈮?5%锛孊ias卤10%'],
   ['T3', '涓珮閿€閲忕ǔ瀹氬眰', 'A/B/C: AMAZON 涓瓑閿€閲忎笖杩炵画鍔ㄩ攢锛沜v6鈮?.95~1.05锛涚敤浜庢墿澶ц鐩栦絾涓嶇壓鐗叉牳蹇冨噯纭巼', '0.35*d3 + 0.50*d6 + 0.15*d12锛屽啀鍋氳秼鍔?鏈堜唤/淇濆畧绯绘暟涓庝笂涓嬮檺鎴柇', '涓婚娴?KPI锛歐MAPE鈮?5%锛孊ias卤15%'],
   ['T3P', '闈?AMAZON 浼樿川绋冲畾灞?, '浠?B/C 鐨?UNKNOWN/WALMART/TEMU/TIKTOK锛岃姹?d6鈮?~8銆乤ctive6=6銆乤ctive2=2銆乧v6鈮?.50~0.55', '0.45*d3 + 0.45*d6 + 0.10*d12锛岄潪鏍稿績娓犻亾鏇村亸杩?/6鏈?, '涓婚娴?KPI锛歐MAPE鈮?5%锛孊ias卤15%'],
   ['T4A', 'AMAZON 杈圭晫鍙娴嬪眰', 'A/B/C: 浠?AMAZON锛岄攢閲忚緝浣庝絾浠嶆湁杩炵画鎬э紱V4.1 瀵?B/C 瑕佹眰 active2=2锛汥 浠呮瀬灏戠ǔ瀹氬搧鍙繘 T4A', '0.50*d3 + 0.45*d6 + 0.05*d12锛屼綆缃俊骞惰缃洿瀹?P10/P90', '杈圭晫 KPI锛歐MAPE鈮?0%锛孊ias卤20%'],
   ['T4B', '绋冲畾杩炵画淇濆簳灞?, '鏈繘 T1鈥揟4A锛氶暱鍘嗗彶 active12鈮?锛涙柊鍝?鐭巻鍙茶繎2鏈堣繛缁湁閿€涓?active6鈮?', '闀垮巻鍙?0.35*d3+0.45*d6+0.20*d12锛涚煭鍘嗗彶 0.55*d3+0.45*d6', '淇濆簳 KPI锛歐MAPE鈮?0%锛屼笉璁″叆涓诲噯纭巼'],
-  ['T99', '寮傚父/浣庤寰嬩繚瀹堜繚搴曞眰', '杩炵画鎬т笉瓒炽€乧v 杩囬珮鎴栬繎绔急淇″彿锛涜繎30鈮? 鏃跺綊闆?, 'max(杩?0,杩?0)脳0.6锛岃繙鏈埫?.72锛涗笉杩涗富 KPI', '涓嶈鍏ヤ富鍑嗙‘鐜囩粺璁?],
+  ['T99', '寮傚父/浣庤寰嬩繚瀹堜繚搴曞眰', '杩炵画鎬т笉瓒炽€乧v 杩囬珮鎴栬繎绔急淇″彿锛涜繎30鈮? 鏃跺綊闆?, 'max(杩?0,杩?0)脳0.8锛岃繙鏈埫?.72锛涗笉杩涗富 KPI', '涓嶈鍏ヤ富鍑嗙‘鐜囩粺璁?],
 ] as const;
 
 function AllCategoryV41StrategySummary() {
   const { data: versions } = useQuery({
     queryKey: ['sales-forecast-versions', 'draft'],
     queryFn: () => api.getSalesForecastVersions({ status: 'draft' }),
   });
   const latestDraft = versions?.[0];
 
   return (
diff --git a/apps/web/src/pages/SalesForecastListPage.tsx b/apps/web/src/pages/SalesForecastListPage.tsx
index 71f3cc4..9359d23 100644
--- a/apps/web/src/pages/SalesForecastListPage.tsx
+++ b/apps/web/src/pages/SalesForecastListPage.tsx
@@ -322,21 +322,21 @@ export function SalesForecastListPage() {
                   <span className="text-text-main">鏈夐娴嬭</span>锛氳娓犻亾閫氳繃鍑嗗叆骞跺啓鍏ラ娴嬫槑缁嗭紙鍒楄〃銆孲KU / 琛屾暟銆嶄腑鐨?                   SKU 鏁颁负鏈夐娴嬭鐨勫幓閲嶅晢鍝佹暟锛夈€?                 </li>
                 <li>
                   <span className="text-text-main">浠呮湁澶嶆牳銆佹棤棰勬祴琛?/span>锛氫緥濡傝娓犻亾杩?90 澶╂棤閿€閲忎笖鍘嗗彶涓嶈冻锛岀郴缁熻烦杩囬娴嬨€佷粎鍦ㄥ悗鍙扮暀鐥曪紝鐣岄潰涓嶅啀鍗曠嫭灞曠ず澶嶆牳娓呭崟銆?                 </li>
                 <li>
                   <span className="text-text-main">鏈Е鍙?/span>锛氬悇娓犻亾鍧囨棤閿€閲忚褰曪紝鐢熸垚鏃剁洿鎺ヨ烦杩囷紝涓嶅啓棰勬祴涔熶笉鐣欏鏍搞€?                 </li>
                 <li>
-                  <span className="text-text-main">T99</span>锛氭湁杩戞湡鍔ㄩ攢鏃剁郴缁熷啓淇濆畧淇濆簳鏁帮紙max(杩?0,杩?0)脳0.6锛夛紱杩?0=0 褰掗浂锛涜繎30&gt;0.2 鏃朵紭鍏?T4B 淇濆簳锛屼笉杞绘槗褰掑叆 T99銆?+                  <span className="text-text-main">T99</span>锛氭湁杩戞湡鍔ㄩ攢鏃剁郴缁熷啓淇濆畧淇濆簳鏁帮紙max(杩?0,杩?0)脳0.8锛夛紱杩?0=0 褰掗浂锛涜繎30&gt;0.2 鏃朵紭鍏?T4B 淇濆簳锛屼笉杞绘槗褰掑叆 T99銆?                 </li>
               </ul>
               <p className="mt-2 text-xs text-text-sub">
                 鍗曟笭閬?/ 鍝佺被 / 鍗?SKU 鐢熸垚浼氬悇鑷骇鐢熺嫭绔嬪揩鐓э紙鎴栧崟 SKU 鍚堝苟杩涚洰鏍囪崏绋匡級锛屼究浜庡疄楠屽姣旓紱姝ｅ紡琛ヨ揣寤鸿鐢ㄣ€屽叏骞冲彴銆嶅叏閲忕敓鎴愩€?               </p>
             </CardHeader>
             <CardContent className="space-y-4">
               <div className="flex flex-wrap items-end gap-2">
                 <label className="space-y-1 text-sm">
                   <span className="text-text-sub">娓犻亾</span>
