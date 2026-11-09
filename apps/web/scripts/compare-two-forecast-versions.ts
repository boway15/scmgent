import { config } from "dotenv";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db, salesForecastVersions } from "@scm/db";

const ROOT = resolve(import.meta.dirname, "../../..");
config({ path: resolve(ROOT, ".env") });

const A = process.env.VER_A || "DRAFT-1794197424316";
const B = process.env.VER_B || "DRAFT-1794205351918";

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

async function meta(versionNo: string) {
  const [v] = await db
    .select()
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.versionNo, versionNo))
    .limit(1);
  if (!v) throw new Error("missing " + versionNo);
  const stats = rowsOf(
    await db.execute(sql`
      SELECT
        COUNT(*)::int AS rows,
        COUNT(*) FILTER (WHERE platform <> 'ALL')::int AS platform_rows,
        COUNT(*) FILTER (WHERE horizon_factors::text LIKE '%postLandingOptimismCap%')::int AS post_cap_rows,
        COUNT(*) FILTER (WHERE horizon_factors::text LIKE '%"shadowDaily"%')::int AS shadow_factor_rows,
        COUNT(*) FILTER (WHERE horizon_factors::text LIKE '%baseDailyBeforeShadow%')::int AS promoted_shadow_rows,
        ROUND(SUM(CASE WHEN platform <> 'ALL' AND forecast_year=2026 AND month=11 THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS nov_total,
        ROUND(SUM(CASE WHEN platform <> 'ALL' AND forecast_year=2026 AND month=12 THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS dec_total
      FROM sales_forecast_monthly
      WHERE version_id = ${v.id}
    `),
  )[0];
  return {
    versionNo: v.versionNo,
    id: v.id,
    status: v.status,
    startMonth: v.startMonth,
    versionName: v.versionName,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    publishedAt: v.publishedAt,
    ...stats,
  };
}

const a = await meta(A);
const b = await meta(B);
const diff = rowsOf(
  await db.execute(sql`
    WITH va AS (SELECT id FROM sales_forecast_versions WHERE version_no = ${A}),
    vb AS (SELECT id FROM sales_forecast_versions WHERE version_no = ${B}),
    fa AS (
      SELECT sku_id, platform, forecast_year, month, forecast_daily_avg::numeric AS d,
        horizon_factors::text LIKE '%postLandingOptimismCap%' AS has_post,
        horizon_factors::text LIKE '%baseDailyBeforeShadow%' AS has_promote
      FROM sales_forecast_monthly, va
      WHERE version_id = va.id AND platform <> 'ALL' AND forecast_year=2026 AND month=11
    ),
    fb AS (
      SELECT sku_id, platform, forecast_year, month, forecast_daily_avg::numeric AS d,
        horizon_factors::text LIKE '%postLandingOptimismCap%' AS has_post,
        horizon_factors::text LIKE '%baseDailyBeforeShadow%' AS has_promote
      FROM sales_forecast_monthly, vb
      WHERE version_id = vb.id AND platform <> 'ALL' AND forecast_year=2026 AND month=11
    )
    SELECT
      COUNT(*)::int AS paired,
      COUNT(*) FILTER (WHERE ABS(fa.d - fb.d) > 0.05)::int AS differ,
      COUNT(*) FILTER (WHERE fa.d > fb.d + 0.05)::int AS a_higher,
      COUNT(*) FILTER (WHERE fb.d > fa.d + 0.05)::int AS b_higher,
      COUNT(*) FILTER (WHERE fa.has_post)::int AS a_post,
      COUNT(*) FILTER (WHERE fb.has_post)::int AS b_post,
      COUNT(*) FILTER (WHERE fa.has_promote)::int AS a_promote,
      COUNT(*) FILTER (WHERE fb.has_promote)::int AS b_promote,
      ROUND(AVG(fa.d - fb.d)::numeric, 4) AS avg_a_minus_b
    FROM fa
    JOIN fb ON fb.sku_id = fa.sku_id AND fb.platform = fa.platform
  `),
)[0];

console.log(JSON.stringify({ a, b, novDiff: diff }, null, 2));
process.exit(0);
