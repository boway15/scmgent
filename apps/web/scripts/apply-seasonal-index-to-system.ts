/**
 * 将影子季节指数写入系统预测（forecast_daily_avg），不写入人工校准。
 * 校准字段仅留给人工录入 / 导入校准。
 *
 * 可选：把历史误写入 manual_daily_avg、原因为「类目季节指数校准 …」的行提升为系统值并清空校准。
 *
 * pnpm --filter @scm/web exec tsx scripts/apply-seasonal-index-to-system.ts --version-id <uuid>
 * pnpm --filter @scm/web exec tsx scripts/apply-seasonal-index-to-system.ts --version-id <uuid> --promote-mistaken-calibration
 * pnpm --filter @scm/web exec tsx scripts/apply-seasonal-index-to-system.ts --version-id <uuid> --from-shadow --min-diff 0.05
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { and, eq, like, isNotNull, sql } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const SEASONAL_CALIBRATION_REASON_PREFIX = '类目季节指数校准';

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

function roundDaily(value: number): number {
  return Math.round(value * 100) / 100;
}

async function promoteMistakenCalibration(versionId: string): Promise<number> {
  const updated = await db
    .update(salesForecastMonthly)
    .set({
      forecastDailyAvg: sql`${salesForecastMonthly.manualDailyAvg}`,
      manualDailyAvg: null,
      adjustReason: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(salesForecastMonthly.versionId, versionId),
        isNotNull(salesForecastMonthly.manualDailyAvg),
        like(salesForecastMonthly.adjustReason, `${SEASONAL_CALIBRATION_REASON_PREFIX}%`),
      ),
    )
    .returning({ id: salesForecastMonthly.id });
  return updated.length;
}

async function applyFromShadow(versionId: string, minDiff: number): Promise<number> {
  const rows = await db
    .select({
      id: salesForecastMonthly.id,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      horizonFactors: salesForecastMonthly.horizonFactors,
    })
    .from(salesForecastMonthly)
    .where(eq(salesForecastMonthly.versionId, versionId));

  let changed = 0;
  for (const row of rows) {
    const shadow = shadowDaily(unwrapFactors(row.horizonFactors));
    if (shadow == null) continue;
    const current = Number(row.forecastDailyAvg);
    const next = roundDaily(shadow);
    const differs =
      current > 0 ? Math.abs(next - current) / current > minDiff : next > 0;
    if (!differs) continue;
    await db
      .update(salesForecastMonthly)
      .set({
        forecastDailyAvg: String(next),
        updatedAt: new Date(),
      })
      .where(eq(salesForecastMonthly.id, row.id));
    changed += 1;
  }
  return changed;
}

async function main() {
  const versionId = readArg('--version-id');
  if (!versionId) {
    console.error('需要 --version-id');
    process.exit(1);
  }
  const promoteOnly = process.argv.includes('--promote-mistaken-calibration');
  const fromShadow = process.argv.includes('--from-shadow') || !promoteOnly;
  const minDiff = Number(readArg('--min-diff') ?? '0.05');

  const [version] = await db
    .select({ versionNo: salesForecastVersions.versionNo, status: salesForecastVersions.status })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, versionId))
    .limit(1);
  if (!version) throw new Error('版本不存在');

  if (promoteOnly || process.argv.includes('--promote-mistaken-calibration')) {
    const promoted = await promoteMistakenCalibration(versionId);
    console.log(`已把季节指数误写入的校准提升为系统值：${promoted} 行（${version.versionNo}）`);
  }

  if (fromShadow && !promoteOnly) {
    const applied = await applyFromShadow(versionId, Number.isFinite(minDiff) ? minDiff : 0.05);
    console.log(`已按 shadowDaily 写入系统预测：${applied} 行（${version.versionNo}）`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
