/**
 * 全量重生成 2026-11 起 6 个月草稿（含影子落地），用于验收组合日均形状。
 * pnpm --filter @scm/web exec tsx scripts/regen-portfolio-nov2026-align.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '@scm/db';
import { generateBaselineForecastVersion } from '../server/lib/forecast-collaboration.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

const started = Date.now();
const result = await generateBaselineForecastVersion({
  startMonth: '2026-11',
  monthCount: 6,
  forceNewVersion: true,
  versionName: `PORTFOLIO-ALIGN-${Date.now()}`,
  excludeAccessories: true,
});

const totals = rowsOf(
  await db.execute(sql`
    SELECT forecast_year, month,
      ROUND(SUM(forecast_daily_avg::numeric) FILTER (WHERE platform <> 'ALL'), 0) AS daily
    FROM sales_forecast_monthly
    WHERE version_id = ${result.version.id}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `),
);

console.log(
  JSON.stringify(
    {
      versionNo: result.version.versionNo,
      versionId: result.version.id,
      forecastRows: result.forecastRows,
      elapsedSec: Math.round((Date.now() - started) / 1000),
      dailyByMonth: totals,
      priorBadShape: [6928, 7120, 6163, 8387, 9006, 7865],
      publishedRef: [7285, 7690, 6406, 6651, 6809, 5600],
    },
    null,
    2,
  ),
);
process.exit(0);
