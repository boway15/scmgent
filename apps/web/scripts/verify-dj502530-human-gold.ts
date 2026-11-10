/**
 * DJ502530_2 人工金标对照：对最新 draft 版本的全渠道日均 vs 人工点估/区间。
 * pnpm --filter @scm/web exec tsx scripts/verify-dj502530-human-gold.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions, skus } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

/** 人工判断点估 + 合理区间（月销量） */
const GOLD: Record<
  string,
  { pointQty: number; lowQty: number; highQty: number; pointDaily: number }
> = {
  '2026-11': { pointQty: 2200, lowQty: 1900, highQty: 2500, pointDaily: 73.33 },
  '2026-12': { pointQty: 2550, lowQty: 2200, highQty: 3000, pointDaily: 82.26 },
  '2027-01': { pointQty: 1900, lowQty: 1650, highQty: 2200, pointDaily: 61.29 },
  '2027-02': { pointQty: 1750, lowQty: 1500, highQty: 2000, pointDaily: 62.5 },
  '2027-03': { pointQty: 1950, lowQty: 1700, highQty: 2200, pointDaily: 62.9 },
  '2027-04': { pointQty: 1550, lowQty: 1300, highQty: 1800, pointDaily: 51.67 },
};

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

const [sku] = await db.select({ id: skus.id, code: skus.code }).from(skus).where(eq(skus.code, 'DJ502530_2')).limit(1);
if (!sku) throw new Error('SKU DJ502530_2 not found');

const [ver] = await db
  .select({
    id: salesForecastVersions.id,
    versionNo: salesForecastVersions.versionNo,
    status: salesForecastVersions.status,
  })
  .from(salesForecastVersions)
  .where(eq(salesForecastVersions.status, 'draft'))
  .orderBy(desc(salesForecastVersions.createdAt))
  .limit(1);

if (!ver) {
  console.log(JSON.stringify({ ok: false, reason: 'no draft version', sku: sku.code }, null, 2));
  process.exit(0);
}

const byMonth = rowsOf(
  await db.execute(sql`
    SELECT forecast_year, month,
      ROUND(SUM(forecast_daily_avg::numeric), 2) AS sum_daily,
      ROUND(SUM(COALESCE(manual_daily_avg, forecast_daily_avg)::numeric), 2) AS sum_effective,
      ROUND(SUM(COALESCE(forecast_daily_p10, 0)::numeric), 2) AS sum_p10,
      ROUND(SUM(COALESCE(forecast_daily_p90, 0)::numeric), 2) AS sum_p90
    FROM sales_forecast_monthly
    WHERE version_id = ${ver.id}
      AND sku_id = ${sku.id}
      AND platform <> 'ALL'
    GROUP BY 1, 2
    ORDER BY 1, 2
  `),
);

const walmart = await db
  .select({
    year: salesForecastMonthly.forecastYear,
    month: salesForecastMonthly.month,
    daily: salesForecastMonthly.forecastDailyAvg,
  })
  .from(salesForecastMonthly)
  .where(
    and(
      eq(salesForecastMonthly.versionId, ver.id),
      eq(salesForecastMonthly.skuId, sku.id),
      eq(salesForecastMonthly.platform, 'WALMART'),
    ),
  );

const comparisons = byMonth
  .map((row) => {
    const year = Number(row.forecast_year);
    const month = Number(row.month);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const gold = GOLD[key];
    if (!gold) return null;
    const daily = Number(row.sum_effective);
    const qty = Math.round(daily * daysInMonth(year, month));
    const inRange = qty >= gold.lowQty && qty <= gold.highQty;
    const pctVsPoint = gold.pointQty > 0 ? Math.round(((qty - gold.pointQty) / gold.pointQty) * 1000) / 10 : null;
    return {
      key,
      systemDaily: daily,
      systemQty: qty,
      goldPointQty: gold.pointQty,
      goldRange: [gold.lowQty, gold.highQty],
      inRange,
      pctVsPoint,
      p10: Number(row.sum_p10) || null,
      p90: Number(row.sum_p90) || null,
    };
  })
  .filter(Boolean);

const walmartNov = walmart.find((r) => r.year === 2026 && r.month === 11);
const allInRange = comparisons.every((c) => c && c.inRange);

console.log(
  JSON.stringify(
    {
      versionNo: ver.versionNo,
      sku: sku.code,
      allInRange,
      walmartNovDaily: walmartNov ? Number(walmartNov.daily) : null,
      walmartNovOk: walmartNov ? Number(walmartNov.daily) <= 5 : null,
      comparisons,
    },
    null,
    2,
  ),
);
process.exit(allInRange ? 0 : 2);
