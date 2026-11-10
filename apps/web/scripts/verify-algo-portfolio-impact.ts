/**
 * 算法验收：新旧版本渠道结构对比 + 走步摘要依赖外部 CSV/版本。
 * pnpm --filter @scm/web exec tsx scripts/verify-algo-portfolio-impact.ts
 * 环境变量 VER_OLD / VER_NEW 指定版本号；缺省取「最新全量草稿」vs「上一个全量草稿」。
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { desc, eq, sql } from 'drizzle-orm';
import { db, salesForecastVersions } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

async function pickVersions(): Promise<{ oldNo: string; newNo: string }> {
  const envOld = process.env.VER_OLD?.trim();
  const envNew = process.env.VER_NEW?.trim();
  if (envOld && envNew) return { oldNo: envOld, newNo: envNew };

  const drafts = await db
    .select({
      id: salesForecastVersions.id,
      versionNo: salesForecastVersions.versionNo,
      versionName: salesForecastVersions.versionName,
      createdAt: salesForecastVersions.createdAt,
    })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.status, 'draft'))
    .orderBy(desc(salesForecastVersions.createdAt))
    .limit(30);

  const withRows = [];
  for (const d of drafts) {
    const row = rowsOf(
      await db.execute(sql`
        SELECT COUNT(*)::int AS n,
          COUNT(DISTINCT sku_id)::int AS skus
        FROM sales_forecast_monthly
        WHERE version_id = ${d.id} AND platform <> 'ALL'
      `),
    )[0];
    const n = Number(row?.n ?? 0);
    const skus = Number(row?.skus ?? 0);
    if (skus >= 200) {
      withRows.push({ ...d, n, skus });
    }
  }
  if (withRows.length < 2) {
    throw new Error(
      `需要至少 2 个全量级草稿（≥200 SKU）。找到 ${withRows.length} 个。请先跑全量生成，或设 VER_OLD/VER_NEW。`,
    );
  }
  return { newNo: withRows[0]!.versionNo, oldNo: withRows[1]!.versionNo };
}

async function versionMeta(versionNo: string) {
  const [v] = await db
    .select()
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.versionNo, versionNo))
    .limit(1);
  if (!v) throw new Error(`missing ${versionNo}`);
  return v;
}

async function channelBreakdown(versionId: string) {
  return rowsOf(
    await db.execute(sql`
      SELECT
        CASE
          WHEN UPPER(platform) IN ('AMAZON') THEN 'AMAZON'
          WHEN UPPER(platform) IN ('ALL','UNKNOWN') THEN 'OTHER_PRIMARY'
          ELSE 'SECONDARY'
        END AS bucket,
        UPPER(platform) AS platform,
        COUNT(*)::int AS rows,
        COUNT(DISTINCT sku_id)::int AS skus,
        ROUND(SUM(forecast_daily_avg::numeric), 2) AS sum_daily_all_months,
        ROUND(SUM(CASE WHEN forecast_year=2026 AND month=11 THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS nov_daily,
        ROUND(SUM(CASE WHEN forecast_year=2026 AND month=12 THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS dec_daily,
        ROUND(SUM(CASE WHEN forecast_year=2027 AND month=4 THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS apr_daily,
        ROUND(SUM(CASE WHEN forecast_year=2026 AND month=11 THEN forecast_daily_avg::numeric * 30 ELSE 0 END), 0) AS nov_qty,
        ROUND(AVG(forecast_daily_avg::numeric), 4) AS avg_daily
      FROM sales_forecast_monthly
      WHERE version_id = ${versionId} AND platform <> 'ALL'
      GROUP BY 1, 2
      ORDER BY 1, sum_daily_all_months DESC
    `),
  );
}

async function bucketTotals(versionId: string) {
  return rowsOf(
    await db.execute(sql`
      SELECT
        CASE WHEN UPPER(platform)='AMAZON' THEN 'AMAZON' ELSE 'NON_AMAZON' END AS bucket,
        ROUND(SUM(CASE WHEN forecast_year=2026 AND month=11 THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS nov_daily,
        ROUND(SUM(CASE WHEN forecast_year=2026 AND month=12 THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS dec_daily,
        ROUND(SUM(CASE WHEN forecast_year=2027 AND month=1 THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS jan_daily,
        ROUND(SUM(CASE WHEN forecast_year=2027 AND month=4 THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS apr_daily,
        ROUND(SUM(forecast_daily_avg::numeric), 2) AS horizon_sum_daily
      FROM sales_forecast_monthly
      WHERE version_id = ${versionId} AND platform <> 'ALL'
      GROUP BY 1
    `),
  );
}

async function pairedDelta(oldId: string, newId: string) {
  return rowsOf(
    await db.execute(sql`
      WITH o AS (
        SELECT sku_id, platform, forecast_year, month, forecast_daily_avg::numeric AS d
        FROM sales_forecast_monthly
        WHERE version_id = ${oldId} AND platform <> 'ALL'
      ),
      n AS (
        SELECT sku_id, platform, forecast_year, month, forecast_daily_avg::numeric AS d
        FROM sales_forecast_monthly
        WHERE version_id = ${newId} AND platform <> 'ALL'
      )
      SELECT
        CASE WHEN UPPER(o.platform)='AMAZON' THEN 'AMAZON' ELSE 'NON_AMAZON' END AS bucket,
        COUNT(*)::int AS paired,
        COUNT(*) FILTER (WHERE ABS(n.d - o.d) > 0.05)::int AS changed,
        COUNT(*) FILTER (WHERE n.d < o.d - 0.05)::int AS decreased,
        COUNT(*) FILTER (WHERE n.d > o.d + 0.05)::int AS increased,
        ROUND(AVG(n.d - o.d)::numeric, 4) AS avg_delta_daily,
        ROUND(SUM(n.d - o.d)::numeric, 2) AS sum_delta_daily,
        ROUND(SUM(CASE WHEN o.forecast_year=2026 AND o.month=11 THEN (n.d - o.d) ELSE 0 END)::numeric, 2) AS nov_delta_daily,
        ROUND(SUM(CASE WHEN o.forecast_year=2027 AND o.month=4 THEN (n.d - o.d) ELSE 0 END)::numeric, 2) AS apr_delta_daily
      FROM o
      JOIN n ON n.sku_id=o.sku_id AND n.platform=o.platform
        AND n.forecast_year=o.forecast_year AND n.month=o.month
      GROUP BY 1
      ORDER BY 1
    `),
  );
}

async function peerFloorStats(versionId: string) {
  return rowsOf(
    await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE horizon_factors::text LIKE '%peerPlatformFloor%')::int AS peer_floor_rows,
        COUNT(*) FILTER (
          WHERE UPPER(platform) NOT IN ('AMAZON','ALL','UNKNOWN')
            AND horizon_factors::text LIKE '%peerPlatformFloor%'
        )::int AS secondary_peer_floor_rows,
        COUNT(*) FILTER (
          WHERE UPPER(platform) NOT IN ('AMAZON','ALL','UNKNOWN')
            AND horizon_factors::text LIKE '%secondaryChannelCap%'
        )::int AS secondary_cap_rows,
        COUNT(*) FILTER (WHERE horizon_factors::text LIKE '%mtdBlend%')::int AS mtd_blend_rows,
        COUNT(*) FILTER (WHERE horizon_factors::text LIKE '%peakYoyRatio%')::int AS peak_yoy_rows
      FROM sales_forecast_monthly
      WHERE version_id = ${versionId} AND platform <> 'ALL'
    `),
  )[0];
}

async function replenishmentProxy(versionId: string) {
  // 6 个月预测量合计作补货需求代理（日均 × 当月天数）
  const rows = rowsOf(
    await db.execute(sql`
      SELECT
        CASE WHEN UPPER(platform)='AMAZON' THEN 'AMAZON' ELSE 'NON_AMAZON' END AS bucket,
        ROUND(SUM(
          forecast_daily_avg::numeric *
          (DATE_PART('days',
            DATE_TRUNC('month', MAKE_DATE(forecast_year, month, 1)) + INTERVAL '1 month - 1 day'
          ))
        )::numeric, 0) AS horizon_qty
      FROM sales_forecast_monthly
      WHERE version_id = ${versionId} AND platform <> 'ALL'
      GROUP BY 1
    `),
  );
  return rows;
}

const { oldNo, newNo } = await pickVersions();
const oldV = await versionMeta(oldNo);
const newV = await versionMeta(newNo);

const [oldBuckets, newBuckets, deltas, oldPeer, newPeer, oldRepl, newRepl, oldCh, newCh] =
  await Promise.all([
    bucketTotals(oldV.id),
    bucketTotals(newV.id),
    pairedDelta(oldV.id, newV.id),
    peerFloorStats(oldV.id),
    peerFloorStats(newV.id),
    replenishmentProxy(oldV.id),
    replenishmentProxy(newV.id),
    channelBreakdown(oldV.id),
    channelBreakdown(newV.id),
  ]);

function mapBuckets(rows: Array<Record<string, unknown>>) {
  return Object.fromEntries(rows.map((r) => [String(r.bucket), r]));
}

const oldB = mapBuckets(oldBuckets);
const newB = mapBuckets(newBuckets);
const oldR = mapBuckets(oldRepl);
const newR = mapBuckets(newRepl);

function pct(n: number, d: number): number | null {
  if (!(d > 0)) return null;
  return Math.round(((n - d) / d) * 1000) / 10;
}

const report = {
  versions: {
    old: { versionNo: oldV.versionNo, name: oldV.versionName, createdAt: oldV.createdAt },
    new: { versionNo: newV.versionNo, name: newV.versionName, createdAt: newV.createdAt },
  },
  bucketTotals: {
    old: oldB,
    new: newB,
    novAmazonPct: pct(Number(newB.AMAZON?.nov_daily), Number(oldB.AMAZON?.nov_daily)),
    novNonAmazonPct: pct(Number(newB.NON_AMAZON?.nov_daily), Number(oldB.NON_AMAZON?.nov_daily)),
    aprAmazonPct: pct(Number(newB.AMAZON?.apr_daily), Number(oldB.AMAZON?.apr_daily)),
    aprNonAmazonPct: pct(Number(newB.NON_AMAZON?.apr_daily), Number(oldB.NON_AMAZON?.apr_daily)),
    horizonAmazonPct: pct(
      Number(newB.AMAZON?.horizon_sum_daily),
      Number(oldB.AMAZON?.horizon_sum_daily),
    ),
    horizonNonAmazonPct: pct(
      Number(newB.NON_AMAZON?.horizon_sum_daily),
      Number(oldB.NON_AMAZON?.horizon_sum_daily),
    ),
  },
  pairedDeltas: deltas,
  mechanismFlags: { old: oldPeer, new: newPeer },
  replenishmentProxyQty: {
    old: oldR,
    new: newR,
    amazonPct: pct(Number(newR.AMAZON?.horizon_qty), Number(oldR.AMAZON?.horizon_qty)),
    nonAmazonPct: pct(Number(newR.NON_AMAZON?.horizon_qty), Number(oldR.NON_AMAZON?.horizon_qty)),
  },
  topSecondaryOld: oldCh.filter((r) => r.bucket === 'SECONDARY').slice(0, 8),
  topSecondaryNew: newCh.filter((r) => r.bucket === 'SECONDARY').slice(0, 8),
};

console.log(JSON.stringify(report, null, 2));
process.exit(0);
