import type {
  SalesAnalyticsEntity,
  SalesAnalyticsGranularity,
  SalesAnalyticsSelection,
} from './sales-analytics-types.js';

function prevYearLabel(period: string): string {
  const w = /^(\d{4})-W(\d{1,2})$/.exec(period);
  if (w) return `${parseInt(w[1]!, 10) - 1}-W${w[2]}`;
  const [y, m] = period.split('-').map(Number);
  return `${(y ?? 0) - 1}-${String(m ?? 0).padStart(2, '0')}`;
}

export function momPct(v: number[], i: number): number | null {
  if (i === 0 || v[i - 1] === 0) return null;
  return ((v[i]! - v[i - 1]!) / v[i - 1]!) * 100;
}

export function yoyPct(v: number[], periods: string[], i: number): number | null {
  const py = prevYearLabel(periods[i] ?? '');
  const pi = periods.indexOf(py);
  if (pi < 0 || v[pi] === 0) return null;
  return ((v[i]! - v[pi]!) / v[pi]!) * 100;
}

export function filterEntities(
  data: SalesAnalyticsEntity[],
  sel: SalesAnalyticsSelection,
): SalesAnalyticsEntity[] {
  return data.filter((e) => {
    if (sel.s.size === 0 || sel.b.size === 0 || sel.c.size === 0 || sel.p.size === 0) return false;
    return sel.s.has(e.s) && sel.b.has(e.b) && sel.c.has(e.c) && sel.p.has(e.p);
  });
}

export function sumSeries(
  entities: SalesAnalyticsEntity[],
  gran: SalesAnalyticsGranularity,
): number[] {
  if (entities.length === 0) return [];
  const key = gran === 'week' ? 'vw' : 'v';
  const n = entities[0]![key].length;
  const out = new Array<number>(n).fill(0);
  for (const e of entities) {
    const series = e[key];
    for (let i = 0; i < n; i++) out[i]! += series[i] ?? 0;
  }
  return out;
}
