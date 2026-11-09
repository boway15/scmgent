import { config } from "dotenv";
import { resolve } from "node:path";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, salesForecastMonthly, salesForecastVersions, skus } from "@scm/db";

const ROOT = resolve(import.meta.dirname, "../../..");
config({ path: resolve(ROOT, ".env") });

const VERSION_PREFIX = process.env.VERSION_NO || "DRAFT-179428881239";
const CODES = ["DJ502530_2", "DJ502952_1", "DJ502512_2", "DJ502530_1", "DJ502890_3", "DJ503441_2"];

function rowsOf(r: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(r)) return r as Array<Record<string, unknown>>;
  return (r as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

const candidates = await db
  .select({
    id: salesForecastVersions.id,
    versionNo: salesForecastVersions.versionNo,
    status: salesForecastVersions.status,
    startMonth: salesForecastVersions.startMonth,
    versionName: salesForecastVersions.versionName,
  })
  .from(salesForecastVersions)
  .where(sql`${salesForecastVersions.versionNo} LIKE ${VERSION_PREFIX + "%"}`)
  .orderBy(sql`${salesForecastVersions.createdAt} DESC`)
  .limit(5);
const v = candidates[0];
if (!v) {
  const latest = await db
    .select({
      versionNo: salesForecastVersions.versionNo,
      status: salesForecastVersions.status,
      createdAt: salesForecastVersions.createdAt,
    })
    .from(salesForecastVersions)
    .orderBy(sql`${salesForecastVersions.createdAt} DESC`)
    .limit(8);
  console.log(JSON.stringify({ error: "version missing", prefix: VERSION_PREFIX, latest }, null, 2));
  process.exit(1);
}
const VERSION_NO = v.versionNo;

const shape = rowsOf(
  await db.execute(sql`
    SELECT forecast_year || '-' || LPAD(month::text, 2, '0') AS mk,
      ROUND(SUM(forecast_daily_avg::numeric), 2) AS total,
      ROUND(SUM(CASE WHEN UPPER(platform)='AMAZON' THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS amz,
      COUNT(*) FILTER (WHERE horizon_factors::text LIKE '%postLandingOptimismCap%')::int AS capped
    FROM sales_forecast_monthly
    WHERE version_id = ${v.id} AND platform <> 'ALL'
    GROUP BY forecast_year, month
    ORDER BY 1
  `),
);

const spot: Array<Record<string, unknown>> = [];
for (const code of CODES) {
  const [sku] = await db.select({ id: skus.id }).from(skus).where(eq(skus.code, code)).limit(1);
  if (!sku) continue;
  const months = rowsOf(
    await db.execute(sql`
      SELECT forecast_year || '-' || LPAD(month::text, 2, '0') AS mk,
        ROUND(SUM(forecast_daily_avg::numeric), 2) AS total,
        ROUND(SUM(CASE WHEN UPPER(platform)='AMAZON' THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS amz,
        ROUND(SUM(CASE WHEN UPPER(platform)='WALMART' THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS walmart
      FROM sales_forecast_monthly
      WHERE version_id = ${v.id} AND sku_id = ${sku.id} AND platform <> 'ALL'
      GROUP BY forecast_year, month
      ORDER BY 1
    `),
  );
  const [mtd] = rowsOf(
    await db.execute(sql`
      SELECT ROUND(SUM(qty_sold)::numeric / NULLIF(COUNT(DISTINCT sale_date),0), 2) AS nov_mtd
      FROM sales_history
      WHERE sku_id = ${sku.id}
        AND sale_date >= DATE '2026-11-01' AND sale_date < DATE '2026-12-01'
    `),
  );
  const [oct] = rowsOf(
    await db.execute(sql`
      SELECT ROUND(SUM(qty_sold)::numeric / NULLIF(COUNT(DISTINCT sale_date),0), 2) AS oct_daily
      FROM sales_history
      WHERE sku_id = ${sku.id}
        AND sale_date >= DATE '2026-10-01' AND sale_date < DATE '2026-11-01'
    `),
  );
  const byMk = Object.fromEntries(months.map((m) => [String(m.mk), m]));
  const nov = Number(byMk["2026-11"]?.total ?? 0);
  const dec = Number(byMk["2026-12"]?.total ?? 0);
  const jan = Number(byMk["2027-01"]?.total ?? 0);
  const feb = Number(byMk["2027-02"]?.total ?? 0);
  const novMtd = mtd?.nov_mtd == null ? null : Number(mtd.nov_mtd);
  spot.push({
    code,
    oct: oct?.oct_daily == null ? null : Number(oct.oct_daily),
    novMtd,
    nov,
    dec,
    jan,
    feb,
    vsMtdNov: novMtd && novMtd > 0 ? `${(((nov - novMtd) / novMtd) * 100).toFixed(1)}%` : null,
    janVsDec: dec > 0 ? `${(((jan - dec) / dec) * 100).toFixed(1)}%` : null,
    janVsFeb: feb > 0 ? `${(((jan - feb) / feb) * 100).toFixed(1)}%` : null,
    walmartJan: Number(byMk["2027-01"]?.walmart ?? 0),
    walmartNov: Number(byMk["2026-11"]?.walmart ?? 0),
  });
}

const nov = Number(shape.find((x) => x.mk === "2026-11")?.total ?? 0);
const dec = Number(shape.find((x) => x.mk === "2026-12")?.total ?? 0);
const jan = Number(shape.find((x) => x.mk === "2027-01")?.total ?? 0);
const feb = Number(shape.find((x) => x.mk === "2027-02")?.total ?? 0);

console.log(
  JSON.stringify(
    {
      version: v,
      portfolio: shape,
      shapeChecks: {
        peakOverFeb: nov > feb && dec > feb,
        janVsDecPct: dec > 0 ? Number((((jan - dec) / dec) * 100).toFixed(1)) : null,
        janBetweenNovDec: jan <= Math.max(nov, dec) * 1.05 && jan >= Math.min(nov, dec) * 0.85,
      },
      spot,
    },
    null,
    2,
  ),
);
process.exit(0);
