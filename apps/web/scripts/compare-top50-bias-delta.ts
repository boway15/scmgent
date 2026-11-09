/**
 * Top50：发布版 vs 新草稿 相对 MTD 偏差变化
 * pnpm --filter @scm/web exec tsx scripts/compare-top50-bias-delta.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db, salesForecastVersions } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const PUB = process.env.TOP50_BASELINE_VERSION || 'DRAFT-1793959940865';
const NEW = process.env.TOP50_COMPARE_VERSION || 'DRAFT-1794197424316';

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

async function main() {
  const [pub] = await db
    .select({ id: salesForecastVersions.id })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.versionNo, PUB))
    .limit(1);
  const [neu] = await db
    .select({ id: salesForecastVersions.id })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.versionNo, NEW))
    .limit(1);
  if (!pub || !neu) throw new Error('versions not found');

  const rows = rowsOf(
    await db.execute(sql`
      WITH top50 AS (
        SELECT sku_id FROM (
          SELECT sh.sku_id, SUM(sh.qty_sold) q
          FROM sales_history sh
          WHERE sh.sale_date >= DATE '2026-10-01'
            AND sh.sale_date < DATE '2026-11-01'
          GROUP BY sh.sku_id
          ORDER BY q DESC
          LIMIT 50
        ) t
      ),
      nov AS (
        SELECT sh.sku_id,
          SUM(sh.qty_sold)::numeric / NULLIF(COUNT(DISTINCT sh.sale_date), 0) AS mtd
        FROM sales_history sh
        JOIN top50 t ON t.sku_id = sh.sku_id
        WHERE sh.sale_date >= DATE '2026-11-01'
          AND sh.sale_date < DATE '2026-12-01'
        GROUP BY sh.sku_id
      ),
      fp AS (
        SELECT m.sku_id, SUM(m.forecast_daily_avg::numeric) AS d
        FROM sales_forecast_monthly m
        JOIN top50 t ON t.sku_id = m.sku_id
        WHERE m.version_id = ${pub.id}
          AND m.forecast_year = 2026 AND m.month = 11
          AND m.platform <> 'ALL'
        GROUP BY m.sku_id
      ),
      fn AS (
        SELECT m.sku_id, SUM(m.forecast_daily_avg::numeric) AS d
        FROM sales_forecast_monthly m
        JOIN top50 t ON t.sku_id = m.sku_id
        WHERE m.version_id = ${neu.id}
          AND m.forecast_year = 2026 AND m.month = 11
          AND m.platform <> 'ALL'
        GROUP BY m.sku_id
      )
      SELECT
        COUNT(*) FILTER (WHERE fn.d < fp.d - 0.05) AS lowered,
        COUNT(*) FILTER (WHERE fn.d > fp.d + 0.05) AS raised,
        COUNT(*) FILTER (WHERE ABS(fn.d - fp.d) <= 0.05) AS flat,
        ROUND(AVG((fp.d - n.mtd) / NULLIF(n.mtd, 0) * 100)::numeric, 1) AS avg_vs_mtd_pub,
        ROUND(AVG((fn.d - n.mtd) / NULLIF(n.mtd, 0) * 100)::numeric, 1) AS avg_vs_mtd_new,
        ROUND(AVG((fn.d - fp.d) / NULLIF(n.mtd, 0) * 100)::numeric, 1) AS avg_pred_delta_pp
      FROM top50 t
      JOIN nov n ON n.sku_id = t.sku_id
      JOIN fp ON fp.sku_id = t.sku_id
      JOIN fn ON fn.sku_id = t.sku_id
    `),
  );

  console.log(JSON.stringify({ pub: PUB, neu: NEW, ...rows[0] }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
