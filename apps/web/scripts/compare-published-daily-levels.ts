/**
 * 对比已发布版：系统当前日均 vs factors 中的影子/可还原基线，解释近远端升降。
 * pnpm --filter @scm/web exec tsx scripts/compare-published-daily-levels.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { and, eq, ne } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions } from '@scm/db';
import {
  blendShadowWithHorizonDecay,
  buildHorizonIndexByMonthKey,
  loadSeasonalDampenFromCalibration,
} from '../server/lib/forecast-seasonal-dampen.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const VERSION_ID = '46cbbcc0-1cba-4939-a6ed-6f2104a04743';

function unwrap(value: unknown): Record<string, unknown> | null {
  let current = value;
  if (typeof current === 'string') {
    try {
      current = JSON.parse(current) as unknown;
    } catch {
      return null;
    }
  }
  return current && typeof current === 'object' ? (current as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const [version] = await db
    .select({
      versionNo: salesForecastVersions.versionNo,
      startMonth: salesForecastVersions.startMonth,
      status: salesForecastVersions.status,
    })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, VERSION_ID))
    .limit(1);
  if (!version) throw new Error('version not found');

  const rows = await db
    .select({
      platform: salesForecastMonthly.platform,
      year: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      horizonFactors: salesForecastMonthly.horizonFactors,
    })
    .from(salesForecastMonthly)
    .where(and(eq(salesForecastMonthly.versionId, VERSION_ID), ne(salesForecastMonthly.platform, 'ALL')));

  const damp = loadSeasonalDampenFromCalibration();
  const horizonByMonth = buildHorizonIndexByMonthKey(
    rows.map((r) => ({ year: r.year, month: r.month })),
  );

  type Agg = {
    current: number;
    shadow: number;
    shadowN: number;
    baseBefore: number;
    baseBeforeN: number;
    optFromShadow: number;
    n: number;
  };
  const byMonth = new Map<string, Agg>();

  for (const row of rows) {
    const mk = `${row.year}-${String(row.month).padStart(2, '0')}`;
    const current = Number(row.forecastDailyAvg);
    if (!(current > 0)) continue;
    const factors = unwrap(row.horizonFactors);
    const seasonal =
      factors?.seasonalIndex && typeof factors.seasonalIndex === 'object'
        ? (factors.seasonalIndex as Record<string, unknown>)
        : null;
    const shadow = num(seasonal?.shadowDaily);
    const baseBefore = num(seasonal?.baseDailyBeforeShadow);
    const h = horizonByMonth.get(mk) ?? 0;

    const agg = byMonth.get(mk) ?? {
      current: 0,
      shadow: 0,
      shadowN: 0,
      baseBefore: 0,
      baseBeforeN: 0,
      optFromShadow: 0,
      n: 0,
    };
    agg.current += current;
    agg.n += 1;
    if (shadow != null && shadow > 0) {
      agg.shadow += shadow;
      agg.shadowN += 1;
      // 若无 baseBefore，用 current 近似不了 V4.1；有则用其做衰减对照
      const base = baseBefore != null && baseBefore > 0 ? baseBefore : current;
      agg.optFromShadow += blendShadowWithHorizonDecay(base, shadow, h, damp.shadowDecay, {
        calendarMonth: row.month,
      });
    } else {
      agg.optFromShadow += current;
    }
    if (baseBefore != null && baseBefore > 0) {
      agg.baseBefore += baseBefore;
      agg.baseBeforeN += 1;
    }
    byMonth.set(mk, agg);
  }

  console.log(`version=${VERSION_ID} ${version.versionNo} start=${version.startMonth} status=${version.status}`);
  console.log('month\trows\tcurrent\tshadowSum\tbaseBeforeSum\tdeltaCurrVsBase%\thorizon');
  for (const [mk, agg] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const base = agg.baseBeforeN > 0 ? agg.baseBefore : null;
    const delta =
      base != null && base > 0 ? (((agg.current - base) / base) * 100).toFixed(1) + '%' : 'n/a';
    console.log(
      [
        mk,
        agg.n,
        Math.round(agg.current),
        Math.round(agg.shadow),
        base != null ? Math.round(base) : 'n/a',
        delta,
        horizonByMonth.get(mk) ?? '',
      ].join('\t'),
    );
  }

  const feb = byMonth.get('2027-02');
  if (feb) {
    console.log('\n=== 2027-02 focus ===');
    console.log('current total daily:', Math.round(feb.current));
    console.log('shadow total daily:', Math.round(feb.shadow), `(rows with shadow ${feb.shadowN})`);
    console.log(
      'baseBefore total daily:',
      feb.baseBeforeN > 0 ? Math.round(feb.baseBefore) : 'n/a (未保存落地前基线)',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
