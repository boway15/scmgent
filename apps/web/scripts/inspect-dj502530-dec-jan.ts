import { config } from 'dotenv';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions, skus } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

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

const VERSION_NO = process.env.VERSION_NO?.trim() || 'DRAFT-1794208891239';
const [v] = await db
  .select({ id: salesForecastVersions.id })
  .from(salesForecastVersions)
  .where(eq(salesForecastVersions.versionNo, VERSION_NO))
  .limit(1);
const [sku] = await db.select({ id: skus.id }).from(skus).where(eq(skus.code, 'DJ502530_2')).limit(1);
if (!v || !sku) throw new Error('missing');

const rows = await db
  .select({
    year: salesForecastMonthly.forecastYear,
    month: salesForecastMonthly.month,
    daily: salesForecastMonthly.forecastDailyAvg,
    hf: salesForecastMonthly.horizonFactors,
  })
  .from(salesForecastMonthly)
  .where(
    and(
      eq(salesForecastMonthly.versionId, v.id),
      eq(salesForecastMonthly.skuId, sku.id),
      eq(salesForecastMonthly.platform, 'AMAZON'),
    ),
  );

const out = rows
  .filter((r) => (r.year === 2026 && r.month === 12) || (r.year === 2027 && r.month === 1))
  .map((r) => {
    const hf = unwrap(r.hf) ?? {};
    const seasonal =
      hf.seasonalIndex && typeof hf.seasonalIndex === 'object'
        ? (hf.seasonalIndex as Record<string, unknown>)
        : {};
    const post = hf.postLandingOptimismCap as Record<string, unknown> | undefined;
    const recent30 = Number(hf.recent30DailyAvg);
    const d6 = Number(hf.d6);
    const shadow = Number(seasonal.shadowDaily);
    const absoluteCap = Math.max(recent30 || 0, d6 || 0) * 1.1;
    const shadowRelativeCap =
      Number.isFinite(shadow) && shadow > 0 ? Math.round(shadow * 1.1 * 100) / 100 : null;
    return {
      mk: `${r.year}-${String(r.month).padStart(2, '0')}`,
      systemDaily: Number(r.daily),
      recent30,
      d6,
      absoluteRunRateCap: Math.round(absoluteCap * 100) / 100,
      shadowRelativeCap,
      siTarget: seasonal.siTarget ?? null,
      shadowDaily: seasonal.shadowDaily ?? null,
      baseBeforeShadow: seasonal.baseDailyBeforeShadow ?? null,
      postLanding: post ?? null,
    };
  })
  .sort((a, b) => a.mk.localeCompare(b.mk));

const dec = out.find((r) => r.mk.endsWith('-12'));
const jan = out.find((r) => r.mk.endsWith('-01'));
const ratio =
  dec && jan && dec.systemDaily > 0
    ? `${Math.round((jan.systemDaily / dec.systemDaily) * 1000) / 10}%`
    : null;

console.log(
  JSON.stringify(
    {
      versionNo: VERSION_NO,
      sku: 'DJ502530_2',
      platform: 'AMAZON',
      historyYoY: {
        '2025-12': { monthly: 3795, daily: 122.42 },
        '2026-01': { monthly: 2156, daily: 69.55 },
        janAsPctOfDec: '56.8%',
      },
      forecastRows: out,
      forecastJanAsPctOfDec: ratio,
      explanation:
        '近端帽取 min(shadowDaily×1.16, run-rate×1.32)（无影子才回退 max(recent30,d6)×1.10），保留 Dec>Jan 季节落差。',
    },
    null,
    2,
  ),
);
process.exit(0);
