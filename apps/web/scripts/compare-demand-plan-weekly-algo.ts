/**
 * 离线对比周预测 v41_inline、near_blend 与 v41_w（同 SKU、同开始周、同近窗）。
 *
 * Usage（需 DATABASE_URL / .env）:
 *   pnpm demand-plan:compare-algo
 *   pnpm demand-plan:compare-algo -- --start-week 2026-W30 --max-skus 200
 *   pnpm demand-plan:compare-algo -- --sku-code DJ502530_2
 *   pnpm demand-plan:compare-algo -- --csv docs/samples/demand-plan-algo-compare.csv
 */
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, skus } from '@scm/db';
import { computeNearTermLevel, DEFAULT_SALES_HISTORY_LOOKBACK_DAYS } from '../server/lib/forecast-baseline.js';
import { FORECAST_HORIZON_MONTHS } from '../server/lib/forecast-limits.js';
import { forecastMonthKey } from '../server/lib/forecast-demand.js';
import { FORECAST_V41_PLATFORM_CODES } from '../server/lib/forecast-platform-scope.js';
import { resolveFlexBiasShadowEnabled } from '../server/lib/forecast-flex-bias-shadow.js';
import { computeDemandPlanInlineV41ForSku } from '../server/lib/demand-plan-inline-v41.js';
import { computeDemandPlanInlineV41WForSku } from '../server/lib/demand-plan-inline-v41-w.js';
import { blendInlineWeekDaily, resolveNearBlendLevel } from '../server/lib/demand-plan-near-blend.js';
import { weekWeightedForecastDaily } from '../server/lib/demand-plan-reconstruct.js';
import { calcEffectiveDailyDemand } from '../server/lib/effective-daily-demand.js';
import { buildDemandPlanWeekHorizon } from '../server/lib/demand-plan-start-week.js';
import {
  buildWeeklyActualFromDaily,
  DEMAND_PLAN_SKU_HISTORY_WEEKS,
} from '../server/lib/demand-plan-sku-detail.js';
import {
  DEMAND_PLAN_HORIZON_WEEKS,
  isoWeekKeyFromUtcDate,
  isoWeekMondayUtc,
  maxSaleDateKey,
  monthKeyFromUtcDate,
  planningRecentWindowEnd,
} from '../server/lib/planning-calendar.js';
import {
  loadDailySalesBySkuIdsInRange,
  loadFirstSaleDateBySkuIds,
  loadMonthlySalesBySkuIds,
} from '../server/lib/sales-history-query.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function horizonMonthKeysFromStartWeek(startWeek: string): string[] {
  const startMonth = monthKeyFromUtcDate(isoWeekMondayUtc(startWeek));
  const [year, month] = startMonth.split('-').map(Number);
  return Array.from({ length: FORECAST_HORIZON_MONTHS }, (_, i) => {
    const cursor = new Date(Date.UTC(year!, month! - 1 + i, 1));
    return forecastMonthKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1);
  });
}

type Acc = {
  absInline: number;
  absBlend: number;
  absW: number;
  actualSum: number;
  count: number;
};

function bump(acc: Acc, inlineF: number, blendF: number, wF: number, actual: number) {
  acc.absInline += Math.abs(inlineF - actual);
  acc.absBlend += Math.abs(blendF - actual);
  acc.absW += Math.abs(wF - actual);
  acc.actualSum += actual;
  acc.count += 1;
}

function wmape(acc: Acc): number | null {
  if (acc.actualSum <= 0 || acc.count === 0) return null;
  return Math.round((acc.absInline / acc.actualSum) * 10000) / 100;
}

function wmapeBlend(acc: Acc): number | null {
  if (acc.actualSum <= 0 || acc.count === 0) return null;
  return Math.round((acc.absBlend / acc.actualSum) * 10000) / 100;
}

function wmapeW(acc: Acc): number | null {
  if (acc.actualSum <= 0 || acc.count === 0) return null;
  return Math.round((acc.absW / acc.actualSum) * 10000) / 100;
}

async function main() {
  const startWeek =
    readArg('--start-week') ??
    isoWeekKeyFromUtcDate(
      new Date(Date.now() - DEMAND_PLAN_SKU_HISTORY_WEEKS * 7 * 86400000),
    );
  const maxSkus = Math.min(Math.max(1, Number(readArg('--max-skus') ?? '150')), 2000);
  const skuCodeFilter = readArg('--sku-code');
  const csvPath = readArg('--csv');
  const nearWeeks = Math.min(26, Math.max(1, Number(readArg('--near-weeks') ?? '4')));

  const weekKeys = buildDemandPlanWeekHorizon(startWeek, DEMAND_PLAN_HORIZON_WEEKS);
  const horizonMonthKeys = horizonMonthKeysFromStartWeek(startWeek);
  const genAsOf = isoWeekMondayUtc(startWeek);
  const yoyLookbackDays = DEFAULT_SALES_HISTORY_LOOKBACK_DAYS + 35;
  const loadStart = new Date(genAsOf.getTime());
  loadStart.setUTCDate(loadStart.getUTCDate() - (yoyLookbackDays - 1));
  const loadStartKey = loadStart.toISOString().slice(0, 10);
  const monthlyFrom = new Date(Date.UTC(genAsOf.getUTCFullYear(), genAsOf.getUTCMonth() - 17, 1));

  const skuRows = skuCodeFilter
    ? await db
        .select({
          skuId: skus.id,
          skuCode: skus.code,
          productCategory: skus.productCategory,
          category: skus.category,
          forceForecast: skus.forceForecast,
        })
        .from(skus)
        .where(and(eq(skus.isActive, true), eq(skus.code, skuCodeFilter)))
    : await db
        .select({
          skuId: skus.id,
          skuCode: skus.code,
          productCategory: skus.productCategory,
          category: skus.category,
          forceForecast: skus.forceForecast,
        })
        .from(skus)
        .where(eq(skus.isActive, true))
        .limit(maxSkus);

  if (skuRows.length === 0) {
    console.error('无匹配 SKU');
    process.exit(1);
  }

  const skuIds = skuRows.map((r) => r.skuId);
  const v41Platforms = [...FORECAST_V41_PLATFORM_CODES];
  const flexBiasShadow = resolveFlexBiasShadowEnabled();

  const [dailyAllBySku, firstSaleBySku, dailySets, monthlySets] = await Promise.all([
    loadDailySalesBySkuIdsInRange({
      skuIds,
      fromDate: loadStartKey,
      toDate: new Date().toISOString().slice(0, 10),
      platform: 'ALL',
    }),
    loadFirstSaleDateBySkuIds({ skuIds, platform: 'ALL' }),
    Promise.all(
      v41Platforms.map((platform) =>
        loadDailySalesBySkuIdsInRange({
          skuIds,
          fromDate: loadStartKey,
          toDate: new Date().toISOString().slice(0, 10),
          platform,
        }),
      ),
    ),
    Promise.all(
      v41Platforms.map((platform) =>
        loadMonthlySalesBySkuIds({
          skuIds,
          platform,
          minYear: monthlyFrom.getUTCFullYear(),
          minMonth: monthlyFrom.getUTCMonth() + 1,
          maxYear: genAsOf.getUTCFullYear(),
          maxMonth: genAsOf.getUTCMonth() + 1,
        }),
      ),
    ),
  ]);

  const allNear: Acc = { absInline: 0, absBlend: 0, absW: 0, actualSum: 0, count: 0 };
  const allFull: Acc = { absInline: 0, absBlend: 0, absW: 0, actualSum: 0, count: 0 };
  const skuLines: string[] = [];

  for (const sku of skuRows) {
    const dailyAll = dailyAllBySku.get(sku.skuId) ?? [];
    const dailyRows = dailyAll.map((r) => ({ saleDate: r.saleDate, qtySold: r.qtySold }));
    const maxSale = maxSaleDateKey(dailyRows);
    const windowEnd = planningRecentWindowEnd(genAsOf, { maxSaleDate: maxSale });
    const actualCutoffKey = new Date().toISOString().slice(0, 10);
    const clippedDaily = dailyRows.filter((r) => String(r.saleDate).slice(0, 10) <= actualCutoffKey);

    const dailyByPlatform = new Map<string, typeof dailyAll>();
    const monthlyByPlatform = new Map<
      string,
      Array<{ saleYear: number; month: number; qtySold: number }>
    >();
    v41Platforms.forEach((platform, index) => {
      dailyByPlatform.set(platform, dailySets[index]!.get(sku.skuId) ?? []);
      monthlyByPlatform.set(platform, monthlySets[index]!.get(sku.skuId) ?? []);
    });

    const skuInput = {
      productCategory: sku.productCategory,
      category: sku.category,
      forceForecast: sku.forceForecast,
    };

    const inline = computeDemandPlanInlineV41ForSku({
      sku: skuInput,
      windowEnd,
      horizonMonthKeys,
      dailyAllRows: dailyAll,
      dailyByPlatform,
      monthlyByPlatform,
      flexBiasShadow,
      firstSaleDate: firstSaleBySku.get(sku.skuId),
    });

    const inlineW = computeDemandPlanInlineV41WForSku({
      sku: skuInput,
      windowEnd,
      horizonWeekKeys: weekKeys,
      dailyAllRows: dailyAll,
      dailyByPlatform,
      monthlyByPlatform,
      flexBiasShadow,
      firstSaleDate: firstSaleBySku.get(sku.skuId),
    });

    if (inline.mergedMap.size === 0 && inlineW.weekMap.size === 0) continue;

    const actualRows = buildWeeklyActualFromDaily({
      weekKeys,
      dailyRows: clippedDaily,
      windowEnd: new Date(`${actualCutoffKey}T12:00:00.000Z`),
    });
    const actualByWeek = new Map(actualRows.map((r) => [r.weekKey, r]));

    const windowEndKey = windowEnd.toISOString().slice(0, 10);
    const historyDaily = dailyRows.filter((row) => String(row.saleDate).slice(0, 10) <= windowEndKey);
    const demandAsOf = new Date(windowEnd.getTime() + 86_400_000);
    const calendarDemand = (windowDays: number) =>
      calcEffectiveDailyDemand({
        sales: historyDaily,
        availability: [],
        windowDays,
        asOf: demandAsOf,
      }).avgDaily;
    const r14 = calendarDemand(14);
    const r30 = calendarDemand(30);
    const r90 = calendarDemand(90);
    const nearLevel = resolveNearBlendLevel({
      r14,
      unconstrainedRecentDaily: computeNearTermLevel({
        recent30DailyAvg: r30,
        recent90DailyAvg: r90,
      }),
      r90,
    });
    const anchorInlineDaily =
      inline.mergedMap.size > 0 ? weekWeightedForecastDaily(weekKeys[0]!, inline.mergedMap) : 0;

    const skuNear: Acc = { absInline: 0, absBlend: 0, absW: 0, actualSum: 0, count: 0 };
    const skuFull: Acc = { absInline: 0, absBlend: 0, absW: 0, actualSum: 0, count: 0 };

    weekKeys.forEach((weekKey, weekIndex) => {
      const actual = actualByWeek.get(weekKey);
      if (!actual || actual.inProgress || actual.actualDailyAvg == null || actual.actualDailyAvg <= 0) {
        return;
      }
      const inlineDaily =
        inline.mergedMap.size > 0 ? weekWeightedForecastDaily(weekKey, inline.mergedMap) : 0;
      const blendDaily =
        inline.mergedMap.size > 0
          ? blendInlineWeekDaily({
              weekIndex,
              inlineDaily,
              anchorInlineDaily,
              nearLevel,
            }).forecastDaily
          : 0;
      const wDaily = inlineW.weekMap.get(weekKey) ?? 0;
      if (inlineDaily <= 0 && wDaily <= 0) return;

      bump(skuFull, inlineDaily, blendDaily, wDaily, actual.actualDailyAvg);
      bump(allFull, inlineDaily, blendDaily, wDaily, actual.actualDailyAvg);
      if (weekIndex < nearWeeks) {
        bump(skuNear, inlineDaily, blendDaily, wDaily, actual.actualDailyAvg);
        bump(allNear, inlineDaily, blendDaily, wDaily, actual.actualDailyAvg);
      }
    });

    if (skuFull.count > 0) {
      skuLines.push(
        `${sku.skuCode},${skuFull.count},${wmape(skuNear)?.toFixed(2) ?? '-'},${wmapeBlend(skuNear)?.toFixed(2) ?? '-'},${wmapeW(skuNear)?.toFixed(2) ?? '-'},${wmape(skuFull)?.toFixed(2) ?? '-'},${wmapeBlend(skuFull)?.toFixed(2) ?? '-'},${wmapeW(skuFull)?.toFixed(2) ?? '-'}`,
      );
    }
  }

  const summary = [
    `# 周预测算法对比（v41_inline vs near_blend vs v41_w）`,
    ``,
    `- 开始周：${startWeek}`,
    `- 近窗截止：按开始周周一 + planningRecentWindowEnd 规则`,
    `- SKU 数：${skuRows.length}（有可比周 ${skuLines.length}）`,
    `- 近 ${nearWeeks} 周 WMAPE：inline ${wmape(allNear)?.toFixed(2) ?? '-'}% · near_blend ${wmapeBlend(allNear)?.toFixed(2) ?? '-'}% · v41_w ${wmapeW(allNear)?.toFixed(2) ?? '-'}%（${allNear.count} 周×SKU 点）`,
    `- 全可比周 WMAPE：inline ${wmape(allFull)?.toFixed(2) ?? '-'}% · near_blend ${wmapeBlend(allFull)?.toFixed(2) ?? '-'}% · v41_w ${wmapeW(allFull)?.toFixed(2) ?? '-'}%（${allFull.count} 点）`,
    ``,
    `说明：inline 为月 V4.1 mergedMap 经 ISO 周日权重拆周。near_blend 仅前 4 周向截止 windowEnd 的日历 r14/U 混合，无库存序列。`,
  ].join('\n');

  console.log(summary);

  if (csvPath) {
    const out = resolve(ROOT, csvPath);
    const header =
      'sku_code,compared_weeks,wmape_near_inline,wmape_near_blend,wmape_near_v41_w,wmape_all_inline,wmape_all_blend,wmape_all_v41_w';
    writeFileSync(out, [header, ...skuLines].join('\n'), 'utf8');
    console.log(`\n已写入 ${out}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
