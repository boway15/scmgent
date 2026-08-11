import {
  MODEL_NAME,
  chooseModel,
  modelForecast,
  modelReason,
  nextPeriodLabel,
} from './sales-analytics-forecast.js';
import { momPct, sumSeries, yoyPct } from './sales-analytics-metrics.js';
import type {
  ChosenModel,
  ForecastPoint,
  SalesAnalyticsEntity,
  SalesAnalyticsGranularity,
} from './sales-analytics-types.js';

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
  { value: 'b', label: '组别' },
  { value: 's', label: '站点' },
  { value: 'sb', label: '站点 × 组别' },
  { value: 'sc', label: '站点 × 品类' },
  { value: 'sp', label: '站点 × 平台' },
  { value: 'bc', label: '组别 × 品类' },
  { value: 'bp', label: '组别 × 平台' },
];

export const DIM_NAME: Record<MatrixDimKey, string> = {
  s: '站点',
  b: '组别',
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
  model: ChosenModel;
  modelLabel: string;
  reason: string;
  fc: ForecastPoint[];
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
  horizon: number;
}): MatrixRow[] {
  const { entities, mode, periods, gran, rangeStart, rangeEnd, horizon } = args;
  const dims = MATRIX_DIMS[mode];
  const isWeek = gran === 'week';
  const groups = new Map<string, SalesAnalyticsEntity[]>();
  for (const e of entities) {
    const k = breakdownKey(e, dims);
    const list = groups.get(k);
    if (list) list.push(e);
    else groups.set(k, [e]);
  }

  const lastLbl = periods[periods.length - 1] ?? '';
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
    // Fit on full series with full period labels (current gran) so seasonal indices align.
    const model = chooseModel(series, isWeek, periods);
    const fc = lastLbl
      ? modelForecast(model, series.length, horizon, lastLbl, isWeek)
      : Array.from({ length: horizon }, (_, i) => ({
          ym: nextPeriodLabel(lastLbl, i + 1, isWeek),
          val: 0,
        }));

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
      model,
      modelLabel: MODEL_NAME[model.type],
      reason: modelReason(model),
      fc,
      series,
    });
  }

  return rows.sort((a, b) => b.cum - a.cum);
}
