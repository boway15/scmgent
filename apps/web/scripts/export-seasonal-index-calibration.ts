/**
 * 把草稿里的 seasonalIndex.shadowDaily 导出成校准宽表。
 * 只保留与系统预测相差超过 5% 的 SKU×平台。
 *
 * pnpm --filter @scm/web exec tsx scripts/export-seasonal-index-calibration.ts --version-id <uuid>
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions, skus } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });
const REASON = '类目季节指数校准 2026-11';

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

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function main() {
  const versionId = readArg('--version-id');
  if (!versionId) {
    console.error('需要 --version-id');
    process.exit(1);
  }
  const [version] = await db
    .select({ versionNo: salesForecastVersions.versionNo })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, versionId))
    .limit(1);
  if (!version) throw new Error('版本不存在');

  const rows = await db
    .select({
      sku: skus.code,
      platform: salesForecastMonthly.platform,
      year: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      horizonFactors: salesForecastMonthly.horizonFactors,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .where(eq(salesForecastMonthly.versionId, versionId));

  const bySku = new Map<string, { sku: string; platform: string; months: Map<string, number>; changed: boolean }>();
  for (const row of rows) {
    if (row.platform === 'ALL') continue;
    const shadow = shadowDaily(unwrapFactors(row.horizonFactors));
    if (shadow == null) continue;
    const current = Number(row.forecastDailyAvg);
    const monthKey = `${row.year}-${String(row.month).padStart(2, '0')}`;
    const key = `${row.sku}::${row.platform}`;
    const group = bySku.get(key) ?? {
      sku: row.sku,
      platform: row.platform,
      months: new Map<string, number>(),
      changed: false,
    };
    group.months.set(monthKey, Math.round(shadow * 100) / 100);
    if (current > 0 ? Math.abs(shadow - current) / current > 0.05 : shadow > 0) group.changed = true;
    bySku.set(key, group);
  }

  const changed = [...bySku.values()].filter((group) => group.changed);
  const monthLabels = [...new Set(changed.flatMap((group) => [...group.months.keys()]))].sort();
  const header = ['SKU', '平台', ...monthLabels, '调整原因'];
  const lines = [header.join(',')];
  for (const group of changed) {
    lines.push(
      [
        csvCell(group.sku),
        csvCell(group.platform),
        ...monthLabels.map((label) => csvCell(group.months.get(label) ?? '')),
        csvCell(REASON),
      ].join(','),
    );
  }

  const outDir = resolve(ROOT, 'docs/samples/forecast-backtest');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `seasonal-index-calibration-${version.versionNo}.csv`);
  writeFileSync(outPath, `\uFEFF${lines.join('\n')}`, 'utf8');
  console.log(`导出行 ${changed.length}，文件 ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
