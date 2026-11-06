/**
 * 对比走步版本里的旧预测与 horizonFactors.seasonalIndex.shadowDaily。
 *
 * pnpm --filter @scm/web exec tsx scripts/analyze-walkforward-seasonal-index.ts --version-id <uuid>
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, forecastAccuracyMonthly, salesForecastMonthly, skus } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function unwrapFactors(value: unknown): Record<string, unknown> | null {
  let current = value;
  if (typeof current === 'string') {
    try {
      current = JSON.parse(current) as unknown;
    } catch {
      return null;
    }
  }
  if (!current || typeof current !== 'object') return null;
  return current as Record<string, unknown>;
}

function shadowDaily(factors: Record<string, unknown> | null): number | null {
  const seasonal = factors?.seasonalIndex;
  if (!seasonal || typeof seasonal !== 'object') return null;
  const daily = (seasonal as { shadowDaily?: unknown }).shadowDaily;
  return typeof daily === 'number' && Number.isFinite(daily) ? daily : null;
}

type Bucket = {
  forecast: number;
  shadow: number;
  actual: number;
  absForecast: number;
  absShadow: number;
  rows: number;
};

function emptyBucket(): Bucket {
  return { forecast: 0, shadow: 0, actual: 0, absForecast: 0, absShadow: 0, rows: 0 };
}

function add(bucket: Bucket, forecast: number, shadow: number, actual: number) {
  bucket.forecast += forecast;
  bucket.shadow += shadow;
  bucket.actual += actual;
  bucket.absForecast += Math.abs(forecast - actual);
  bucket.absShadow += Math.abs(shadow - actual);
  bucket.rows += 1;
}

function line(label: string, bucket: Bucket): string {
  const bias = (value: number) =>
    bucket.actual > 0 ? `${(((value - bucket.actual) / bucket.actual) * 100).toFixed(1)}%` : '—';
  const wmape = (value: number) =>
    bucket.actual > 0 ? `${((value / bucket.actual) * 100).toFixed(1)}%` : '—';
  const suggested = bucket.forecast > 0 ? (bucket.actual / bucket.forecast).toFixed(2) : '—';
  return `| ${label} | ${bucket.rows} | ${Math.round(bucket.actual)} | ${bias(bucket.forecast)} | ${bias(bucket.shadow)} | ${wmape(bucket.absForecast)} | ${wmape(bucket.absShadow)} | ${suggested} |`;
}

async function main() {
  const versionId = readArg('--version-id');
  if (!versionId) {
    console.error('需要 --version-id');
    process.exit(1);
  }

  const [forecastRows, accuracyRows] = await Promise.all([
    db
      .select({
        skuId: salesForecastMonthly.skuId,
        platform: salesForecastMonthly.platform,
        year: salesForecastMonthly.forecastYear,
        month: salesForecastMonthly.month,
        forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
        horizonFactors: salesForecastMonthly.horizonFactors,
        tier: salesForecastMonthly.profileSegment,
        projectGroup: skus.projectGroup,
      })
      .from(salesForecastMonthly)
      .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
      .where(eq(salesForecastMonthly.versionId, versionId)),
    db
      .select({
        skuId: forecastAccuracyMonthly.skuId,
        platform: forecastAccuracyMonthly.platform,
        year: forecastAccuracyMonthly.forecastYear,
        month: forecastAccuracyMonthly.month,
        actualDailyAvg: forecastAccuracyMonthly.actualDailyAvg,
      })
      .from(forecastAccuracyMonthly)
      .where(eq(forecastAccuracyMonthly.versionId, versionId)),
  ]);

  const actualByKey = new Map(
    accuracyRows.map((row) => [
      `${row.skuId}|${row.platform}|${row.year}|${row.month}`,
      Number(row.actualDailyAvg),
    ]),
  );

  const byMonth = new Map<string, Bucket>();
  const byTier = new Map<string, Bucket>();
  const byGroup = new Map<string, Bucket>();
  const peak = emptyBucket();
  const overall = emptyBucket();

  for (const row of forecastRows) {
    const actual = actualByKey.get(`${row.skuId}|${row.platform}|${row.year}|${row.month}`);
    const shadow = shadowDaily(unwrapFactors(row.horizonFactors));
    if (actual == null || shadow == null || actual < 0) continue;
    const days = new Date(Date.UTC(row.year, row.month, 0)).getUTCDate();
    const forecast = Number(row.forecastDailyAvg) * days;
    const shadowQty = shadow * days;
    const actualQty = actual * days;
    const monthKey = `${row.year}-${String(row.month).padStart(2, '0')}`;
    const groupKey = `${row.projectGroup ?? '未分组'} ${monthKey}`;
    const monthBucket = byMonth.get(monthKey) ?? emptyBucket();
    const tierBucket = byTier.get(row.tier ?? 'unknown') ?? emptyBucket();
    const groupBucket = byGroup.get(groupKey) ?? emptyBucket();
    add(monthBucket, forecast, shadowQty, actualQty);
    add(tierBucket, forecast, shadowQty, actualQty);
    add(groupBucket, forecast, shadowQty, actualQty);
    add(overall, forecast, shadowQty, actualQty);
    if (row.month === 11 || row.month === 12) add(peak, forecast, shadowQty, actualQty);
    byMonth.set(monthKey, monthBucket);
    byTier.set(row.tier ?? 'unknown', tierBucket);
    byGroup.set(groupKey, groupBucket);
  }

  const header =
    '| 分组 | 行数 | 实际月量合计 | 旧算法偏差 | 季节指数偏差 | 旧WMAPE | 新WMAPE | 建议保守系数(实际/旧预测) |';
  const split = '|---|---:|---:|---:|---:|---:|---:|---:|';
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  const tiers = [...byTier.entries()].sort((a, b) => b[1].actual - a[1].actual);
  const groups = [...byGroup.entries()]
    .filter(([, bucket]) => bucket.actual >= 3000)
    .sort((a, b) => b[1].actual - a[1].actual)
    .slice(0, 40);
  const report = [
    `# 季节指数走步对比 ${versionId}`,
    '',
    header,
    split,
    line('全部', overall),
    line('11–12月', peak),
    ...months.map(([label, bucket]) => line(label, bucket)),
    ...tiers.map(([label, bucket]) => line(label, bucket)),
    ...groups.map(([label, bucket]) => line(label, bucket)),
    '',
  ].join('\n');

  const outDir = resolve(ROOT, 'docs/samples/forecast-backtest');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `seasonal-index-${versionId}.md`);
  writeFileSync(outPath, report, 'utf8');
  console.log(report);
  console.log(`已写入 ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
