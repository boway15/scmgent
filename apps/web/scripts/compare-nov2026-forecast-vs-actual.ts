/**
 * 对比 2026-11 预测日均 vs 当月已发生实际日均（部分月需外推谨慎解读）
 * pnpm --filter @scm/web exec tsx scripts/compare-nov2026-forecast-vs-actual.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db, salesForecastVersions } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const maybe = result as { rows?: Array<Record<string, unknown>> };
  return maybe.rows ?? [];
}

async function main() {
  const y = 2026;
  const m = 11;
  const dim = 30;

  const maxDay = rowsOf(
    await db.execute(sql`
      SELECT MAX(sale_date)::text AS max_day,
        COUNT(DISTINCT sale_date)::int AS days_with_sales,
        ROUND(SUM(qty_sold)::numeric, 0) AS qty_mtd
      FROM sales_history
      WHERE sale_date >= DATE '2026-11-01'
        AND sale_date < DATE '2026-12-01'
    `),
  )[0];

  const daysSoFar = Number(maxDay?.days_with_sales ?? 0);

  const actualTotal = rowsOf(
    await db.execute(sql`
      SELECT COUNT(DISTINCT sale_date)::int AS days,
        ROUND(SUM(qty_sold)::numeric, 0) AS qty_mtd,
        ROUND(SUM(qty_sold)::numeric / NULLIF(COUNT(DISTINCT sale_date), 0), 1) AS actual_daily
      FROM sales_history
      WHERE sale_date >= DATE '2026-11-01'
        AND sale_date < DATE '2026-12-01'
    `),
  )[0];

  const hist2025 = rowsOf(
    await db.execute(sql`
      SELECT COUNT(DISTINCT sale_date)::int AS days,
        ROUND(SUM(qty_sold)::numeric, 0) AS qty,
        ROUND(SUM(qty_sold)::numeric / NULLIF(COUNT(DISTINCT sale_date), 0), 1) AS daily
      FROM sales_history
      WHERE sale_date >= DATE '2025-11-01'
        AND sale_date < DATE '2025-12-01'
    `),
  )[0];

  const histSameWindow = rowsOf(
    await db.execute(sql`
      SELECT COUNT(DISTINCT sale_date)::int AS days,
        ROUND(SUM(qty_sold)::numeric, 0) AS qty,
        ROUND(SUM(qty_sold)::numeric / NULLIF(COUNT(DISTINCT sale_date), 0), 1) AS daily
      FROM sales_history
      WHERE sale_date >= DATE '2025-11-01'
        AND sale_date < (DATE '2025-11-01' + (${Math.max(daysSoFar, 1)}::int || ' days')::interval)
    `),
  )[0];

  // 2026-10 全日日均（最近完整月）
  const oct2026 = rowsOf(
    await db.execute(sql`
      SELECT COUNT(DISTINCT sale_date)::int AS days,
        ROUND(SUM(qty_sold)::numeric, 0) AS qty,
        ROUND(SUM(qty_sold)::numeric / NULLIF(COUNT(DISTINCT sale_date), 0), 1) AS daily
      FROM sales_history
      WHERE sale_date >= DATE '2026-10-01'
        AND sale_date < DATE '2026-11-01'
    `),
  )[0];

  const actualByChannel = rowsOf(
    await db.execute(sql`
      SELECT COALESCE(UPPER(channel), 'UNKNOWN') AS channel,
        COUNT(DISTINCT sale_date)::int AS days,
        ROUND(SUM(qty_sold)::numeric, 0) AS qty_mtd,
        ROUND(SUM(qty_sold)::numeric / NULLIF(COUNT(DISTINCT sale_date), 0), 1) AS actual_daily
      FROM sales_history
      WHERE sale_date >= DATE '2026-11-01'
        AND sale_date < DATE '2026-12-01'
      GROUP BY 1
      ORDER BY qty_mtd DESC NULLS LAST
      LIMIT 15
    `),
  );

  const versions = [
    { no: 'DRAFT-1793959940865', label: '已发布(影子+重塑)' },
    { no: 'DRAFT-1794193608198', label: '新草稿(未落地影子)' },
  ];

  const forecastBlocks: Array<Record<string, unknown>> = [];
  for (const v of versions) {
    const [ver] = await db
      .select({ id: salesForecastVersions.id, status: salesForecastVersions.status })
      .from(salesForecastVersions)
      .where(eq(salesForecastVersions.versionNo, v.no))
      .limit(1);
    if (!ver) continue;
    const fc = rowsOf(
      await db.execute(sql`
        SELECT ROUND(SUM(forecast_daily_avg::numeric), 1) AS forecast_daily_sum,
          COUNT(*)::int AS rows,
          COUNT(DISTINCT sku_id)::int AS skus
        FROM sales_forecast_monthly
        WHERE version_id = ${ver.id}
          AND forecast_year = ${y}
          AND month = ${m}
          AND platform <> 'ALL'
      `),
    )[0];
    forecastBlocks.push({
      label: v.label,
      versionNo: v.no,
      status: ver.status,
      forecastDailySum: Number(fc?.forecast_daily_sum ?? 0),
      impliedMonthQty: Math.round(Number(fc?.forecast_daily_sum ?? 0) * dim),
      rows: fc?.rows,
      skus: fc?.skus,
    });
  }

  const actualDaily = Number(actualTotal?.actual_daily ?? 0);
  const histFullDaily = Number(hist2025?.daily ?? 0);
  const histWinDaily = Number(histSameWindow?.daily ?? 0);
  const octDaily = Number(oct2026?.daily ?? 0);

  const optimism = forecastBlocks.map((fc) => {
    const pred = Number(fc.forecastDailySum ?? 0);
    const pct = (base: number) =>
      base > 0 ? `${(((pred - base) / base) * 100).toFixed(1)}%` : '—';
    return {
      label: fc.label,
      forecastDaily: pred,
      vsNov2026MtdDaily: pct(actualDaily),
      vs2025NovFullDaily: pct(histFullDaily),
      vs2025NovSameWindowDaily: pct(histWinDaily),
      vs2026OctFullDaily: pct(octDaily),
    };
  });

  console.log(
    JSON.stringify(
      {
        note: 'MTD 日均为已发生天数均值；月初偏高/偏低都不能直接当月全月结论',
        nov2026Actual: {
          maxDay: maxDay?.max_day,
          daysWithSales: daysSoFar,
          qtyMtd: maxDay?.qty_mtd,
          actualDaily,
          naiveFullMonthExtrapolate: Math.round(actualDaily * dim),
        },
        benchmarks: {
          hist2025NovFull: hist2025,
          hist2025NovSameWindow: histSameWindow,
          oct2026Full: oct2026,
        },
        forecasts: forecastBlocks,
        optimismChecks: optimism,
        actualByChannelTop: actualByChannel,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
