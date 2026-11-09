import { config } from 'dotenv';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db, salesForecastVersions } from '@scm/db';
import { loadStationSeasonalIndexByMonth } from '../server/lib/forecast-si-reshape.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function rowsOf(r: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(r)) return r as Array<Record<string, unknown>>;
  return (r as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

const VERSION_NO = process.env.VERSION_NO || 'DRAFT-1794208891239';
const [v] = await db
  .select({ id: salesForecastVersions.id, startMonth: salesForecastVersions.startMonth })
  .from(salesForecastVersions)
  .where(eq(salesForecastVersions.versionNo, VERSION_NO))
  .limit(1);
if (!v) throw new Error('missing version');

const shape = rowsOf(
  await db.execute(sql`
    SELECT forecast_year || '-' || LPAD(month::text, 2, '0') AS mk,
      ROUND(SUM(forecast_daily_avg::numeric), 2) AS total,
      ROUND(SUM(CASE WHEN UPPER(platform)='AMAZON' THEN forecast_daily_avg::numeric ELSE 0 END), 2) AS amz
    FROM sales_forecast_monthly
    WHERE version_id = ${v.id} AND platform <> 'ALL'
    GROUP BY forecast_year, month
    ORDER BY 1
  `),
);

const si = await loadStationSeasonalIndexByMonth('2026-10');
const stations = ['US', 'EU', 'UK', 'CA', 'ALL'];
const siByStation: Record<string, Record<string, number>> = {};
for (const st of stations) {
  const row: Record<string, number> = {};
  for (const m of [11, 12, 1, 2, 3, 4]) {
    const val = si.get(`${st}|${m}`);
    if (val != null) row[String(m)] = Math.round(val * 1000) / 1000;
  }
  if (Object.keys(row).length) siByStation[st] = row;
}

const byMk = Object.fromEntries(shape.map((r) => [String(r.mk), Number(r.total)]));
const dec = byMk['2026-12']!;
const jan = byMk['2027-01']!;
const feb = byMk['2027-02']!;
const mar = byMk['2027-03']!;
const apr = byMk['2027-04']!;

console.log(
  JSON.stringify(
    {
      versionNo: VERSION_NO,
      portfolio: shape,
      ratios: {
        marVsFebPct: Number((((mar - feb) / feb) * 100).toFixed(1)),
        marVsJanPct: Number((((mar - jan) / jan) * 100).toFixed(1)),
        marVsDecPct: Number((((mar - dec) / dec) * 100).toFixed(1)),
        aprVsMarPct: Number((((apr - mar) / mar) * 100).toFixed(1)),
        marShareOfPeak: Number((mar / dec).toFixed(3)),
      },
      siByStation,
      verdictHints: {
        expectedPattern:
          'US 家具常见：Q4 旺 → 1月回落 → 2月偏弱 → 3月春季略回升 → 4月再落',
        marAboveFebBelowPeak: mar > feb && mar < dec,
      },
    },
    null,
    2,
  ),
);
process.exit(0);
