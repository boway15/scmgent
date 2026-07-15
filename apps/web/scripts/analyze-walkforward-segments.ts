/**
 * 走步 CSV：12 子档 × 3 决策窗口 WMAPE 矩阵（与 API bySegment 对齐）
 *
 * Usage:
 *   pnpm --filter @scm/web exec tsx scripts/analyze-walkforward-segments.ts
 *   pnpm --filter @scm/web exec tsx scripts/analyze-walkforward-segments.ts -- --csv apps/web/docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v3.csv --as-of 2026-01-01 --common-with baseline.csv
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  horizonBandFromIndex,
  horizonMonthIndex,
  summarizeAccuracyMatrix,
} from '../server/lib/forecast-horizon-band.js';
import { SEGMENT_MATRIX_ROWS, type ProfileSegment } from '../server/lib/forecast-profile-class.js';
import { formatKpiTargetPct } from '../server/lib/forecast-kpi-targets.js';
import type { AccuracyRowInput } from '../server/lib/forecast-accuracy-tier.js';

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
      actualDaily: Number(parts[5]),
      forecastDaily: Number(parts[4]),
      biasRate: parts[6] === '' ? null : Number(parts[6]),
      mape: parts[7] === '' ? null : Number(parts[7]),
      forecastYear,
      month,
      profileSegment: parts[8] || undefined,
      forecastDailyP10: parts[11] === '' ? null : Number(parts[11]),
      forecastDailyP90: parts[12] === '' ? null : Number(parts[12]),
      classificationEstimated: (parts[16] ?? 'persisted') === 'estimated',
    };
  });
}

function filterCommonSkus(rows: AccuracyRowInput[], commonWith?: string): AccuracyRowInput[] {
  if (!commonWith) return rows;
  const baseline = parseCsv(commonWith);
  const keys = new Set(baseline.map((r) => `${r.skuCode}|${r.forecastYear}|${r.month}`));
  return rows.filter((r) => keys.has(`${r.skuCode}|${r.forecastYear}|${r.month}`));
}

function fmtPct(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function main() {
  const csv =
    readArg('--csv') ??
    resolve('apps/web/docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v3.csv');
  const asOfStr = readArg('--as-of') ?? '2026-01-01';
  const commonWith = readArg('--common-with');
  const asOf = new Date(`${asOfStr}T00:00:00.000Z`);

  let rows = parseCsv(csv);
  rows = filterCommonSkus(rows, commonWith);

  const segmentBySku = new Map<string, ProfileSegment>();
  for (const row of rows) {
    if (row.profileSegment) {
      segmentBySku.set(row.skuCode, row.profileSegment as ProfileSegment);
    }
  }

  const matrix = summarizeAccuracyMatrix(rows, {
    asOf,
    segmentBySku: segmentBySku.size > 0 ? segmentBySku : undefined,
  });

  const persisted = rows.filter((r) => !r.classificationEstimated).length;
  const source =
    persisted === rows.length ? 'persisted' : persisted > 0 ? 'mixed' : 'estimated';

  console.log(
    `走步子档矩阵 · ${csv} · asOf=${asOfStr} · ${rows.length} 行 · 分类=${source}`,
  );
  if (commonWith) console.log(`共同 SKU 集：${commonWith}`);
  console.log(
    ['子档', '1–3月 WMAPE', 'KPI', '3–6月 WMAPE', 'KPI', '6–12月 WMAPE', 'KPI', 'B覆盖率'].join('\t'),
  );

  for (const segment of SEGMENT_MATRIX_ROWS) {
    const seg = matrix.bySegment.find((s) => s.segment === segment);
    if (!seg) continue;
    const p = seg.bands.precision;
    const f = seg.bands.flex;
    const s = seg.bands.strategic;
    const bCell = matrix.cells.find((c) => c.segment === segment && c.band === 'precision');
    console.log(
      [
        seg.segmentLabel,
        fmtPct(p.wmape),
        formatKpiTargetPct(p.kpiTarget),
        fmtPct(f.wmape),
        formatKpiTargetPct(f.kpiTarget),
        fmtPct(s.wmape),
        formatKpiTargetPct(s.kpiTarget),
        bCell?.intervalCoverage != null ? fmtPct(bCell.intervalCoverage) : '—',
      ].join('\t'),
    );
  }

  const aCore = matrix.cells.find((c) => c.segment === 'A:core' && c.band === 'precision');
  if (aCore?.wmape != null) {
    console.log(`\nA:core precision WMAPE = ${fmtPct(aCore.wmape)} (目标 ≤15%)`);
  }
}

main();
