/**
 * 最新草稿版本 11–4 月全盘日均（platform<>ALL）
 * pnpm --filter @scm/web exec tsx scripts/inspect-portfolio-nov-apr-dailies.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { desc, sql } from 'drizzle-orm';
import { db, salesForecastVersions } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

const versions = await db
  .select({
    id: salesForecastVersions.id,
    versionNo: salesForecastVersions.versionNo,
    status: salesForecastVersions.status,
    createdAt: salesForecastVersions.createdAt,
  })
  .from(salesForecastVersions)
  .orderBy(desc(salesForecastVersions.createdAt))
  .limit(5);

const v = versions[0];
if (!v) throw new Error('no version');

const totals = rowsOf(
  await db.execute(sql`
    SELECT forecast_year, month,
      ROUND(SUM(forecast_daily_avg::numeric) FILTER (WHERE platform <> 'ALL'), 0) AS daily,
      ROUND(SUM(forecast_daily_p10::numeric) FILTER (WHERE platform <> 'ALL' AND forecast_daily_p10 IS NOT NULL), 0) AS p10,
      ROUND(SUM(forecast_daily_p90::numeric) FILTER (WHERE platform <> 'ALL' AND forecast_daily_p90 IS NOT NULL), 0) AS p90,
      COUNT(*) FILTER (
        WHERE platform <> 'ALL'
          AND forecast_daily_p90 IS NOT NULL
          AND forecast_daily_avg::numeric > forecast_daily_p90::numeric + 0.005
      ) AS above_p90_rows
    FROM sales_forecast_monthly
    WHERE version_id = ${v.id}
      AND (
        (forecast_year = 2026 AND month >= 11)
        OR (forecast_year = 2027 AND month <= 4)
      )
    GROUP BY 1, 2
    ORDER BY 1, 2
  `),
);

console.log(
  JSON.stringify(
    {
      versionNo: v.versionNo,
      versionId: v.id,
      status: v.status,
      recentVersions: versions.map((x) => ({ no: x.versionNo, status: x.status })),
      dailyByMonth: totals,
      priorFixedRef: [6843, 7084, 6079, 6481, 6668, 5644],
      note: '口径：SUM(forecast_daily_avg) WHERE platform <> ALL；本次 P10/P90 修复不改日均本身',
    },
    null,
    2,
  ),
);
process.exit(0);
