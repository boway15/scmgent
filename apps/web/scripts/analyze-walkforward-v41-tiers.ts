/**
 * 走步回测 CSV：按 V4.1 画像分层（T1–T4B）统计可比 WMAPE/MAPE 与 Ghost 率。
 *
 * Usage:
 *   pnpm forecast:walkforward:v41-tiers
 *   pnpm forecast:walkforward:v41-tiers -- --csv docs/samples/forecast-backtest/walkforward-2026-01-01-6m.csv
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  computeSignedMapeVsActual,
  computeWeightedMape,
  type AccuracyRowInput,
} from '../server/lib/forecast-accuracy-tier.js';
import {
  formatAllCatV41TierLabel,
  isAllCatV41KpiComparableTier,
} from '../server/lib/forecast-allcat-v41.js';

type CsvRow = {
  skuCode: string;
  monthLabel: string;
  monthIndex: number;
  forecastDaily: number;
  actualDaily: number;
  profileSegment: string;
  horizonBand: string;
  ghostRow: number;
};

type HorizonBand = 'precision' | 'flex' | 'all';

const V41_TIERS = ['T1', 'T2', 'T3', 'T3P', 'T4A', 'T4B'] as const;
const HORIZON_MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'] as const;

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function parseCsv(path: string): CsvRow[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const [header, ...data] = lines;
  if (!header?.startsWith('sku_code')) throw new Error(`unexpected header: ${header}`);

  return data.map((line) => {
    const parts = line.split(',');
    const monthLabel = parts[3] ?? '';
    const monthIndex = HORIZON_MONTHS.indexOf(monthLabel as (typeof HORIZON_MONTHS)[number]);
    return {
      skuCode: parts[0] ?? '',
      monthLabel,
      monthIndex: monthIndex >= 0 ? monthIndex : -1,
      forecastDaily: Number(parts[4]),
      actualDaily: Number(parts[5]),
      profileSegment: parts[8] ?? '',
      horizonBand: parts[10] ?? '',
      ghostRow: Number(parts[16] ?? 0),
    };
  });
}

function filterBand(rows: CsvRow[], band: HorizonBand): CsvRow[] {
  if (band === 'all') return rows;
  if (band === 'precision') {
    return rows.filter((r) => r.horizonBand === 'precision' || (r.monthIndex >= 0 && r.monthIndex <= 2));
  }
  return rows.filter((r) => r.horizonBand === 'flex' || (r.monthIndex >= 3 && r.monthIndex <= 5));
}

function toAccuracyInputs(rows: CsvRow[]): AccuracyRowInput[] {
  return rows.map((r) => ({
    skuCode: r.skuCode,
    actualDaily: r.actualDaily,
    forecastDaily: r.forecastDaily,
    profileSegment: r.profileSegment,
  }));
}

function fmtPct(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtSignedPct(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  const pct = v * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—';
}

function summarizeTier(rows: CsvRow[], tier: string) {
  const tierRows = rows.filter((r) => r.profileSegment === tier);
  const forecastRows = tierRows.filter((r) => r.forecastDaily > 0);
  const ghostRows = tierRows.filter((r) => r.ghostRow === 1);
  const comparable = tierRows.filter(
    (r) => r.actualDaily > 0 && isAllCatV41KpiComparableTier(r.profileSegment),
  );
  const inputs = toAccuracyInputs(comparable);
  return {
    tier,
    label: formatAllCatV41TierLabel(tier),
    skuCount: new Set(tierRows.map((r) => r.skuCode)).size,
    forecastRows: forecastRows.length,
    comparableRows: comparable.length,
    ghostRows: ghostRows.length,
    ghostRate: forecastRows.length > 0 ? ghostRows.length / forecastRows.length : null,
    mape: computeSignedMapeVsActual(inputs),
    wmape: computeWeightedMape(inputs),
  };
}

function main() {
  const defaultCsv = resolve(
    'docs/samples/forecast-backtest/walkforward-2026-01-01-6m.csv',
  );
  const csvPath = resolve(readArg('--csv') ?? defaultCsv);
  const rows = parseCsv(csvPath);

  console.log(`V4.1 分层走步分析：${csvPath}`);
  console.log(`总行数：${rows.length}`);
  console.log('');

  for (const band of ['precision', 'flex', 'all'] as const) {
    const bandRows = filterBand(rows, band);
    const bandLabel =
      band === 'precision' ? '1–3 月（精准备货）' : band === 'flex' ? '3–6 月（生产柔性）' : '全窗口';
    console.log(`=== 决策窗口：${bandLabel} ===`);
    console.log(
      ['画像分层', 'SKU', '预测行', '可比行', 'Ghost', 'Ghost率', 'MAPE', 'WMAPE'].join('\t'),
    );
    for (const tier of V41_TIERS) {
      const s = summarizeTier(bandRows, tier);
      console.log(
        [
          s.label,
          s.skuCount,
          s.forecastRows,
          s.comparableRows,
          s.ghostRows,
          s.ghostRate != null ? pct(s.ghostRows, s.forecastRows) : '—',
          fmtSignedPct(s.mape),
          fmtPct(s.wmape),
        ].join('\t'),
      );
    }
    console.log('');
  }

  console.log('=== 分月分层（T1–T4A 可比，actual>0）===');
  for (const month of HORIZON_MONTHS) {
    const monthRows = rows.filter((r) => r.monthLabel === month);
    for (const tier of ['T1', 'T2', 'T3', 'T3P', 'T4A'] as const) {
      const sub = monthRows.filter(
        (r) => r.profileSegment === tier && r.actualDaily > 0,
      );
      if (!sub.length) continue;
      const inputs = toAccuracyInputs(sub);
      console.log(
        `${month}\t${formatAllCatV41TierLabel(tier)}\t可比 ${sub.length}\tMAPE ${fmtSignedPct(computeSignedMapeVsActual(inputs))}\tWMAPE ${fmtPct(computeWeightedMape(inputs))}`,
      );
    }
  }
}

main();
