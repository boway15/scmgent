/**
 * 按 ABCD 大类分别输出走步回测 WMAPE（含子档 × 决策窗口）
 *
 * Usage:
 *   pnpm --filter @scm/web exec tsx scripts/analyze-walkforward-by-class.ts -- --class A
 *   pnpm --filter @scm/web exec tsx scripts/analyze-walkforward-by-class.ts -- --class B --csv path/to.csv --as-of 2026-01-01
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeWeightedMape, type AccuracyRowInput } from '../server/lib/forecast-accuracy-tier.js';
import {
  horizonBandFromIndex,
  horizonMonthIndex,
  summarizeAccuracyMatrix,
} from '../server/lib/forecast-horizon-band.js';
import {
  classifyForecastProfile,
  PROFILE_CLASS_META,
  PROFILE_SEGMENT_META,
  resolveSkuProfileSegment,
  type ProfileClass,
} from '../server/lib/forecast-profile-class.js';
import { formatKpiTargetPct, getKpiTarget, isKpiMet } from '../server/lib/forecast-kpi-targets.js';

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function parseCsv(path: string): AccuracyRowInput[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const [header, ...data] = lines;
  if (!header?.startsWith('sku_code')) throw new Error(`unexpected header: ${header}`);

  return data.map((line) => {
    const parts = line.split(',');
    const monthLabel = parts[3] ?? '';
    const match = /^(\d{4})-(\d{2})$/.exec(monthLabel);
    const forecastYear = match ? Number(match[1]) : 2026;
    const month = match ? Number(match[2]) : 1;
    return {
      skuCode: parts[0] ?? '',
      station: parts[1] ?? '',
      platform: parts[2] ?? '',
      actualDaily: Number(parts[5]),
      forecastDaily: Number(parts[4]),
      biasRate: parts[6] === '' ? null : Number(parts[6]),
      mape: parts[7] === '' ? null : Number(parts[7]),
      forecastYear,
      month,
    };
  });
}

function fmtPct(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function main() {
  const profileClass = (readArg('--class')?.toUpperCase() ?? 'A') as ProfileClass;
  if (!['A', 'B', 'C', 'D'].includes(profileClass)) {
    console.error('--class must be A, B, C, or D');
    process.exit(1);
  }

  const csv =
    readArg('--csv') ??
    resolve('apps/web/docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v4.csv');
  const asOfStr = readArg('--as-of') ?? '2026-01-01';
  const asOf = new Date(`${asOfStr}T00:00:00.000Z`);

  const stationFilter = readArg('--station')?.toUpperCase();
  const platformFilter = readArg('--platform')?.toUpperCase();

  const allRows = parseCsv(csv).filter((row) => {
    const extended = row as AccuracyRowInput & { station?: string; platform?: string };
    if (stationFilter && extended.station && extended.station.toUpperCase() !== stationFilter) {
      return false;
    }
    if (platformFilter && extended.platform && extended.platform.toUpperCase() !== platformFilter) {
      return false;
    }
    return true;
  });

  const bySku = new Map<string, AccuracyRowInput[]>();
  for (const row of allRows) {
    const list = bySku.get(row.skuCode) ?? [];
    list.push(row);
    bySku.set(row.skuCode, list);
  }

  const segmentBySku = new Map<string, ReturnType<typeof resolveSkuProfileSegment>['segment']>();
  const classBySku = new Map<string, ProfileClass>();
  for (const [skuCode, skuRows] of bySku) {
    const monthlyQty = skuRows.map((r) => r.actualDaily);
    const profile = resolveSkuProfileSegment({ monthlyQty });
    segmentBySku.set(skuCode, profile.segment);
    classBySku.set(skuCode, profile.profileClass);
  }

  const classSkus = new Set(
    [...classBySku.entries()].filter(([, c]) => c === profileClass).map(([s]) => s),
  );
  const rows = allRows.filter((r) => classSkus.has(r.skuCode));

  const meta = PROFILE_CLASS_META[profileClass];
  console.log(`\n=== ${meta.label}（${profileClass}）走步回测 ===`);
  console.log(`CSV: ${csv}`);
  console.log(`asOf: ${asOfStr} · 可比行 ${rows.filter((r) => r.actualDaily > 0).length} · SKU ${classSkus.size}`);

  const ghostRows = rows.filter((r) => r.actualDaily === 0 && r.forecastDaily > 0).length;
  const ghostPct = rows.length > 0 ? ((ghostRows / rows.length) * 100).toFixed(1) : '—';
  console.log(`ghost 行（零实际仍预测>0）: ${ghostRows} / ${rows.length} = ${ghostPct}%`);

  for (const [bandLabel, kFilter] of [
    ['1–3 月（precision）', (k: number) => k <= 2],
    ['3–6 月（flex）', (k: number) => k >= 3 && k <= 5],
    ['6–12 月（strategic）', (k: number) => k >= 6],
  ] as const) {
    const sub = rows.filter((r) => {
      const k = horizonMonthIndex(r.forecastYear!, r.month!, asOf);
      return kFilter(k);
    });
    const wmape = computeWeightedMape(sub);
    console.log(`\n【${bandLabel}】全类 WMAPE: ${fmtPct(wmape)} · 可比行 ${sub.filter((r) => r.actualDaily > 0).length}`);
  }

  const matrix = summarizeAccuracyMatrix(rows, { asOf });
  const segments = matrix.bySegment.filter((s) => s.parentClass === profileClass);

  console.log(`\n--- ${meta.label} 子档 × 窗口 ---`);
  console.log(['子档', '1–3月', 'KPI', '3–6月', 'KPI', '6–12月', 'KPI', '状态'].join('\t'));

  for (const seg of segments) {
    const p = seg.bands.precision;
    const f = seg.bands.flex;
    const s = seg.bands.strategic;
    const status = [p.kpiStatus, f.kpiStatus, s.kpiStatus].join('/');
    console.log(
      [
        seg.segmentLabel,
        fmtPct(p.wmape),
        formatKpiTargetPct(p.kpiTarget),
        fmtPct(f.wmape),
        formatKpiTargetPct(f.kpiTarget),
        fmtPct(s.wmape),
        formatKpiTargetPct(s.kpiTarget),
        status,
      ].join('\t'),
    );
  }

  if (profileClass === 'B') {
    console.log('\n--- B 类区间覆盖率（P10–P90，需 CSV 含 p10/p90 列时完整）---');
    for (const seg of segments) {
      if (!seg.measurable) continue;
      for (const band of ['precision', 'flex', 'strategic'] as const) {
        const cell = matrix.cells.find((c) => c.segment === seg.segment && c.band === band);
        if (cell?.intervalCoverage != null) {
          console.log(`${seg.segmentLabel} ${band}: ${fmtPct(cell.intervalCoverage)}`);
        }
      }
    }
  }

  console.log('');
}

main();
