import { momPct, sumSeries, yoyPct } from './sales-analytics-metrics.js';
import type { SalesAnalyticsEntity, SalesAnalyticsGranularity } from './sales-analytics-types.js';

export type MatrixMode = 'b' | 's' | 'sb' | 'sc' | 'sp' | 'bc' | 'bp';

export type MatrixDimKey = 's' | 'b' | 'c' | 'p';

export const MATRIX_DIMS: Record<MatrixMode, MatrixDimKey[]> = {
  b: ['b'],
  s: ['s'],
  sb: ['s', 'b'],
  sc: ['s', 'c'],
  sp: ['s', 'p'],
  bc: ['b', 'c'],
  bp: ['b', 'p'],
};

export const MATRIX_MODE_OPTIONS: Array<{ value: MatrixMode; label: string }> = [
  { value: 'b', label: '项目组' },
  { value: 's', label: '站点' },
  { value: 'sb', label: '站点 × 项目组' },
  { value: 'sc', label: '站点 × 品类' },
  { value: 'sp', label: '站点 × 平台' },
  { value: 'bc', label: '项目组 × 品类' },
  { value: 'bp', label: '项目组 × 平台' },
];

export const DIM_NAME: Record<MatrixDimKey, string> = {
  s: '站点',
  b: '项目组',
  c: '品类',
  p: '平台',
};

export type MatrixRow = {
  key: string;
  hist: number[];
  cum: number;
  mom: number | null;
  yoy: number | null;
  peak: { period: string; qty: number };
  trough: { period: string; qty: number };
  series: number[];
};

export function breakdownKey(e: SalesAnalyticsEntity, dims: MatrixDimKey[]): string {
  return dims.map((d) => e[d]).join(' / ');
}

export function downloadMatrixCsv(filename: string, headers: string[], rows: string[][]) {
  const lines = [headers, ...rows].map((r) =>
    r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','),
  );
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function buildMatrixRows(args: {
  entities: SalesAnalyticsEntity[];
  mode: MatrixMode;
  periods: string[];
  gran: SalesAnalyticsGranularity;
  rangeStart: number;
  rangeEnd: number;
}): MatrixRow[] {
  const { entities, mode, periods, gran, rangeStart, rangeEnd } = args;
  const dims = MATRIX_DIMS[mode];
  const groups = new Map<string, SalesAnalyticsEntity[]>();
  for (const e of entities) {
    const k = breakdownKey(e, dims);
    const list = groups.get(k);
    if (list) list.push(e);
    else groups.set(k, [e]);
  }

  const windowPeriods = periods.slice(rangeStart, rangeEnd + 1);

  const rows: MatrixRow[] = [];
  for (const [key, es] of groups) {
    const series = sumSeries(es, gran);
    const hist = series.slice(rangeStart, rangeEnd + 1);
    let peakI = 0;
    let peakV = -Infinity;
    let troughI = 0;
    let troughV = Infinity;
    hist.forEach((x, i) => {
      if (x > peakV) {
        peakV = x;
        peakI = i;
      }
      if (x < troughV) {
        troughV = x;
        troughI = i;
      }
    });

    rows.push({
      key,
      hist,
      cum: hist.reduce((a, b) => a + b, 0),
      mom: momPct(series, rangeEnd),
      yoy: yoyPct(series, periods, rangeEnd),
      peak: { period: windowPeriods[peakI] ?? '—', qty: Number.isFinite(peakV) ? peakV : 0 },
      trough: {
        period: windowPeriods[troughI] ?? '—',
        qty: Number.isFinite(troughV) ? troughV : 0,
      },
      series,
    });
  }

  return rows.sort((a, b) => b.cum - a.cum);
}
