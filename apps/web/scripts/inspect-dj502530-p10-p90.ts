/**
 * 核对 DJ502530_2 系统日均 vs P10/P90 是否同源。
 * pnpm --filter @scm/web exec tsx scripts/inspect-dj502530-p10-p90.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions, skus } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const [sku] = await db.select({ id: skus.id }).from(skus).where(eq(skus.code, 'DJ502530_2')).limit(1);
if (!sku) throw new Error('sku missing');

const [version] = await db
  .select({ id: salesForecastVersions.id, versionNo: salesForecastVersions.versionNo })
  .from(salesForecastVersions)
  .orderBy(desc(salesForecastVersions.createdAt))
  .limit(1);
if (!version) throw new Error('version missing');

const rows = await db
  .select({
    platform: salesForecastMonthly.platform,
    year: salesForecastMonthly.forecastYear,
    month: salesForecastMonthly.month,
    daily: salesForecastMonthly.forecastDailyAvg,
    p10: salesForecastMonthly.forecastDailyP10,
    p90: salesForecastMonthly.forecastDailyP90,
    hf: salesForecastMonthly.horizonFactors,
  })
  .from(salesForecastMonthly)
  .where(
    and(
      eq(salesForecastMonthly.versionId, version.id),
      eq(salesForecastMonthly.skuId, sku.id),
      or(
        and(eq(salesForecastMonthly.forecastYear, 2026), sql`${salesForecastMonthly.month} in (11, 12)`),
        and(eq(salesForecastMonthly.forecastYear, 2027), eq(salesForecastMonthly.month, 1)),
      ),
    ),
  );

type Slim = {
  mk: string;
  platform: string;
  daily: number;
  p10: number;
  p90: number;
  ratio: number | null;
  above: boolean;
  post: { before?: unknown; after?: unknown; mode?: unknown } | null;
  shadow: unknown;
};

const slim: Slim[] = rows
  .map((r) => {
    const daily = Number(r.daily);
    const p10 = Number(r.p10);
    const p90 = Number(r.p90);
    let post: Slim['post'] = null;
    let shadow: unknown = null;
    try {
      const hf = (typeof r.hf === 'string' ? JSON.parse(r.hf) : r.hf) as Record<string, unknown> | null;
      const rawPost = hf?.postLandingOptimismCap as Record<string, unknown> | undefined;
      post = rawPost
        ? { before: rawPost.beforeDaily, after: rawPost.afterDaily, mode: rawPost.capMode }
        : null;
      const seasonal = hf?.seasonalIndex as Record<string, unknown> | undefined;
      shadow = seasonal?.shadowDaily ?? null;
    } catch {
      /* ignore */
    }
    return {
      mk: `${r.year}-${String(r.month).padStart(2, '0')}`,
      platform: String(r.platform),
      daily,
      p10,
      p90,
      ratio: daily > 0 && Number.isFinite(p90) ? Math.round((p90 / daily) * 1000) / 1000 : null,
      above: Number.isFinite(daily) && Number.isFinite(p90) && daily > p90 + 0.005,
      post,
      shadow,
    };
  })
  .sort((a, b) => a.mk.localeCompare(b.mk) || a.platform.localeCompare(b.platform));

const agg = ['2026-11', '2026-12', '2027-01'].map((mk) => {
  const list = slim.filter((r) => r.mk === mk && r.platform !== 'ALL');
  const daily = Math.round(list.reduce((s, r) => s + (r.daily || 0), 0) * 100) / 100;
  const p10 = Math.round(list.reduce((s, r) => s + (r.p10 || 0), 0) * 100) / 100;
  const p90 = Math.round(list.reduce((s, r) => s + (r.p90 || 0), 0) * 100) / 100;
  return {
    mk,
    daily,
    p10,
    p90,
    above: daily > p90 + 0.005,
    impliedP50FromP90T1: Math.round((p90 / 1.18) * 100) / 100,
    platforms: list,
  };
});

console.log(JSON.stringify({ versionNo: version.versionNo, versionId: version.id, agg }, null, 2));
process.exit(0);
