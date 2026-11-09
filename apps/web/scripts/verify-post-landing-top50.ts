/**
 * 验证落地后再帽：Top50 桶计数 + 关键 SKU + 帽字段落库
 * pnpm --filter @scm/web exec tsx scripts/verify-post-landing-top50.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions, skus } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const PUB = process.env.TOP50_BASELINE_VERSION || 'DRAFT-1793959940865';
const NEW = process.env.TOP50_COMPARE_VERSION || 'DRAFT-1794197424316';
const SPOT = ['DJ502530_2', 'DJ503905_1', 'DJ504175_1', 'DJ505226_2', 'SKDJ502530_2'];

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

function verdict(vsMtd: number | null, vsOct: number | null): string {
  const a = vsMtd ?? 0;
  const b = vsOct ?? 0;
  if (a >= 30 || (a >= 20 && b >= 30)) return '偏乐观';
  if (a <= -20 || (a <= -15 && b <= -20)) return '偏保守';
  return '大致合理';
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

  const detail = rowsOf(
    await db.execute(sql`
      WITH top50 AS (
        SELECT sh.sku_id,
          SUM(sh.qty_sold)::numeric AS oct_qty,
          ROUND(SUM(sh.qty_sold)::numeric / NULLIF(COUNT(DISTINCT sh.sale_date), 0), 2) AS oct_daily,
          ROW_NUMBER() OVER (ORDER BY SUM(sh.qty_sold) DESC) AS rnk
        FROM sales_history sh
        WHERE sh.sale_date >= DATE '2026-10-01' AND sh.sale_date < DATE '2026-11-01'
        GROUP BY sh.sku_id
        ORDER BY oct_qty DESC
        LIMIT 50
      ),
      nov AS (
        SELECT sh.sku_id,
          ROUND(SUM(sh.qty_sold)::numeric / NULLIF(COUNT(DISTINCT sh.sale_date), 0), 2) AS nov_daily
        FROM sales_history sh
        JOIN top50 t ON t.sku_id = sh.sku_id
        WHERE sh.sale_date >= DATE '2026-11-01' AND sh.sale_date < DATE '2026-12-01'
        GROUP BY sh.sku_id
      ),
      fp AS (
        SELECT m.sku_id, ROUND(SUM(m.forecast_daily_avg::numeric), 2) AS d
        FROM sales_forecast_monthly m
        JOIN top50 t ON t.sku_id = m.sku_id
        WHERE m.version_id = ${pub.id} AND m.forecast_year = 2026 AND m.month = 11 AND m.platform <> 'ALL'
        GROUP BY m.sku_id
      ),
      fn AS (
        SELECT m.sku_id, ROUND(SUM(m.forecast_daily_avg::numeric), 2) AS d
        FROM sales_forecast_monthly m
        JOIN top50 t ON t.sku_id = m.sku_id
        WHERE m.version_id = ${neu.id} AND m.forecast_year = 2026 AND m.month = 11 AND m.platform <> 'ALL'
        GROUP BY m.sku_id
      )
      SELECT t.rnk, sk.code AS sku_code, t.oct_daily, n.nov_daily, fp.d AS pub_d, fn.d AS new_d
      FROM top50 t
      JOIN skus sk ON sk.id = t.sku_id
      LEFT JOIN nov n ON n.sku_id = t.sku_id
      LEFT JOIN fp ON fp.sku_id = t.sku_id
      LEFT JOIN fn ON fn.sku_id = t.sku_id
      ORDER BY t.rnk
    `),
  );

  const scored = detail.map((r) => {
    const oct = Number(r.oct_daily);
    const mtd = r.nov_daily == null ? null : Number(r.nov_daily);
    const pubD = r.pub_d == null ? null : Number(r.pub_d);
    const newD = r.new_d == null ? null : Number(r.new_d);
    const vsMtdPub = mtd && pubD != null ? ((pubD - mtd) / mtd) * 100 : null;
    const vsOctPub = oct > 0 && pubD != null ? ((pubD - oct) / oct) * 100 : null;
    const vsMtdNew = mtd && newD != null ? ((newD - mtd) / mtd) * 100 : null;
    const vsOctNew = oct > 0 && newD != null ? ((newD - oct) / oct) * 100 : null;
    return {
      rnk: Number(r.rnk),
      code: String(r.sku_code),
      oct,
      mtd,
      pubD,
      newD,
      verdictPub: verdict(vsMtdPub, vsOctPub),
      verdictNew: verdict(vsMtdNew, vsOctNew),
      vsMtdPub,
      vsMtdNew,
    };
  });

  const count = (key: 'verdictPub' | 'verdictNew', label: string) =>
    scored.filter((x) => x[key] === label).length;

  const summary = {
    pub: {
      optimistic: count('verdictPub', '偏乐观'),
      ok: count('verdictPub', '大致合理'),
      conservative: count('verdictPub', '偏保守'),
    },
    neu: {
      optimistic: count('verdictNew', '偏乐观'),
      ok: count('verdictNew', '大致合理'),
      conservative: count('verdictNew', '偏保守'),
    },
  };

  const avg = (vals: number[]) =>
    vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  const avgPub = avg(scored.map((x) => x.vsMtdPub).filter((v): v is number => v != null));
  const avgNew = avg(scored.map((x) => x.vsMtdNew).filter((v): v is number => v != null));
  const lowered = scored.filter(
    (x) => x.pubD != null && x.newD != null && x.newD < x.pubD - 0.05,
  ).length;

  // horizon_factors 可能被双重编码成 jsonb 字符串，用 text 命中更稳
  const [capStats] = rowsOf(
    await db.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE horizon_factors::text LIKE '%postLandingOptimismCap%'
        ) AS capped_rows,
        COUNT(*) FILTER (
          WHERE forecast_year = 2026
            AND month = 11
            AND horizon_factors::text LIKE '%postLandingOptimismCap%'
        ) AS nov_capped_rows
      FROM sales_forecast_monthly
      WHERE version_id = ${neu.id}
    `),
  );

  const stillOptimistic = scored
    .filter((x) => x.verdictNew === '偏乐观')
    .map((x) => ({
      rnk: x.rnk,
      code: x.code,
      pub: x.pubD,
      neu: x.newD,
      vsMtdNew: x.vsMtdNew != null ? `${x.vsMtdNew.toFixed(1)}%` : null,
    }));

  const spot: Array<Record<string, unknown>> = [];
  for (const code of SPOT) {
    const [sku] = await db.select({ id: skus.id }).from(skus).where(eq(skus.code, code)).limit(1);
    if (!sku) continue;
    const row = scored.find((x) => x.code === code);
    const [amz] = await db
      .select({
        d: salesForecastMonthly.forecastDailyAvg,
        hf: salesForecastMonthly.horizonFactors,
      })
      .from(salesForecastMonthly)
      .where(
        and(
          eq(salesForecastMonthly.versionId, neu.id),
          eq(salesForecastMonthly.skuId, sku.id),
          eq(salesForecastMonthly.forecastYear, 2026),
          eq(salesForecastMonthly.month, 11),
          eq(salesForecastMonthly.platform, 'AMAZON'),
        ),
      )
      .limit(1);
    const hf = (amz?.hf ?? {}) as Record<string, unknown>;
    const post = hf.postLandingOptimismCap as Record<string, unknown> | undefined;
    spot.push({
      code,
      top50: row
        ? {
            pub: row.pubD,
            neu: row.newD,
            vsMtdPub: row.vsMtdPub != null ? `${row.vsMtdPub.toFixed(1)}%` : null,
            vsMtdNew: row.vsMtdNew != null ? `${row.vsMtdNew.toFixed(1)}%` : null,
            verdictPub: row.verdictPub,
            verdictNew: row.verdictNew,
          }
        : null,
      amazonNov: {
        daily: amz?.d ?? null,
        recent30: hf.recent30DailyAvg ?? null,
        d6: hf.d6 ?? null,
        postLanding: post ?? null,
      },
    });
  }

  const dj = scored.find((x) => x.code === 'DJ502530_2');
  const checks = {
    optimisticDroppedToAtMost20: summary.neu.optimistic <= 20,
    optimisticBelowPublished: summary.neu.optimistic < summary.pub.optimistic,
    avgBiasImproved: avgNew != null && avgPub != null && avgNew < avgPub - 20,
    postLandingFieldPresent: Number(capStats?.capped_rows ?? 0) > 0,
    dj502530MilderOrOk: dj != null && (dj.verdictNew !== '偏乐观' || (dj.vsMtdNew ?? 99) < 20),
  };

  console.log(
    JSON.stringify(
      {
        versions: { pub: PUB, neu: NEW },
        summary,
        avgVsMtdPct: { pub: avgPub, neu: avgNew },
        loweredCount: lowered,
        capStats,
        stillOptimistic,
        spot,
        checks,
        allPass: Object.values(checks).every(Boolean),
      },
      null,
      2,
    ),
  );

  if (!Object.values(checks).every(Boolean)) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
