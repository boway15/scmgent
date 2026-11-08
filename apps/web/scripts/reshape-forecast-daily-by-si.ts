/**
 * 按站点季节指数重塑已发布/草稿版本的系统日均形状（薄封装，逻辑在 forecast-si-reshape）。
 *
 * pnpm --filter @scm/web exec tsx scripts/reshape-forecast-daily-by-si.ts --version-id <uuid> [--as-of YYYY-MM] --commit
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions } from '@scm/db';
import { loadAggregateGuardIssues } from '../server/lib/forecast-aggregate-guard.js';
import { applyStationSiPortfolioReshape } from '../server/lib/forecast-si-reshape.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

async function main() {
  const versionId = readArg('--version-id');
  if (!versionId) {
    console.error('需要 --version-id');
    process.exit(1);
  }
  const commit = process.argv.includes('--commit');
  const asOf = readArg('--as-of');

  const [version] = await db
    .select({
      versionNo: salesForecastVersions.versionNo,
      status: salesForecastVersions.status,
      startMonth: salesForecastVersions.startMonth,
    })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, versionId))
    .limit(1);
  if (!version) throw new Error('版本不存在');

  const result = await applyStationSiPortfolioReshape({
    versionId,
    asOfMonth: asOf,
    startMonth: version.startMonth,
    dryRun: !commit,
  });

  console.log(
    `版本 ${version.versionNo} (${version.status}) asOf=${result.asOfMonth} groups=${result.groupsTouched} rows=${result.changedRows}${commit ? ' 已写入' : ' 预览（加 --commit 写入）'}`,
  );

  if (!commit) return;

  const amazon = await db
    .select({
      year: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      sumDaily: sql<string>`sum(${salesForecastMonthly.forecastDailyAvg}::numeric)`,
    })
    .from(salesForecastMonthly)
    .where(
      and(
        eq(salesForecastMonthly.versionId, versionId),
        eq(salesForecastMonthly.platform, 'AMAZON'),
      ),
    )
    .groupBy(salesForecastMonthly.forecastYear, salesForecastMonthly.month);

  const byMonth = Object.fromEntries(
    amazon
      .map((row) => [monthKey(row.year, row.month), Math.round(Number(row.sumDaily))])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
  console.log('AMAZON 日均合计', byMonth);

  const issues = await loadAggregateGuardIssues(versionId);
  const counts = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.level] = (acc[issue.level] ?? 0) + 1;
    return acc;
  }, {});
  console.log('护栏', JSON.stringify(counts));
  for (const issue of issues.filter((item) => item.level === 'error').slice(0, 15)) {
    console.log(issue.message);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
