import type {
  ChosenModel,
  ForecastModelType,
  ForecastPoint,
  LinearFit,
  SeasonalParams,
} from './sales-analytics-types.js';

export const MODEL_NAME: Record<ForecastModelType, string> = {
  trend: '线性趋势',
  seasonal: '趋势+季节',
  avg: '移动平均',
  naive: '朴素法',
};

function nextWeekLabel(lastLbl: string, k: number): string {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(lastLbl);
  if (!m) return lastLbl;
  let yr = +m[1]!;
  let wk = +m[2]! + k;
  while (wk > 52) {
    wk -= 52;
    yr++;
  }
  return `${yr}-W${String(wk).padStart(2, '0')}`;
}

export function nextPeriodLabel(label: string, k: number, isWeek: boolean): string {
  if (isWeek || /^(\d{4})-W(\d{1,2})$/.test(label)) return nextWeekLabel(label, k);
  const [y, m] = label.split('-').map(Number);
  let yy = y ?? 0;
  let mm = (m ?? 0) + k;
  while (mm > 12) {
    mm -= 12;
    yy++;
  }
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

function fitLinear(v: number[]): LinearFit {
  const n = v.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = v.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (v[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const b = den ? num / den : 0;
  const a = my - b * mx;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pr = a + b * xs[i]!;
    ssRes += (v[i]! - pr) ** 2;
    ssTot += (v[i]! - my) ** 2;
  }
  const r2 = ssTot ? 1 - ssRes / ssTot : 0;
  return { n, a, b, r2, my };
}

function seasonalFactors(v: number[], fit: LinearFit, periods: string[]): SeasonalParams {
  const sIdx: Record<number, number> = {};
  let peakM = 1;
  let troughM = 1;
  const season: Record<number, number[]> = {};
  for (let i = 0; i < v.length; i++) {
    const mm = +(periods[i] ?? '').split('-')[1]!;
    if (!mm) continue;
    const trend = fit.a + fit.b * i;
    if (trend > 0) (season[mm] ??= []).push(v[i]! / trend);
  }
  let ssum = 0;
  let scnt = 0;
  for (let m = 1; m <= 12; m++) {
    const arr = season[m];
    if (arr?.length) {
      const avg = arr.reduce((x, y) => x + y, 0) / arr.length;
      sIdx[m] = avg;
      ssum += avg;
      scnt++;
    } else {
      sIdx[m] = 1;
    }
  }
  const mean = scnt ? ssum / scnt : 1;
  for (let m = 1; m <= 12; m++) sIdx[m]! /= mean;
  for (let m = 1; m <= 12; m++) {
    if (sIdx[m]! > sIdx[peakM]!) peakM = m;
    if (sIdx[m]! < sIdx[troughM]!) troughM = m;
  }
  let smax = sIdx[1]!;
  let smin = sIdx[1]!;
  for (let m = 1; m <= 12; m++) {
    if (sIdx[m]! > smax) smax = sIdx[m]!;
    if (sIdx[m]! < smin) smin = sIdx[m]!;
  }
  return { sIdx, peakM, troughM, strength: mean ? (smax - smin) / mean : 0 };
}

/**
 * Auto-select lightweight forecast model.
 * Month: r2>=0.55 && trendRel>0.02 → trend/seasonal; r2>=0.35 → avg; else naive.
 * Week: no seasonal; slightly looser trend/avg thresholds (prototype).
 * Pass `periods` (month labels) to allow seasonal selection.
 */
export function chooseModel(v: number[], isWeek: boolean, periods?: string[]): ChosenModel {
  const fit = fitLinear(v);
  const meanV = fit.my || 1;
  const trendRel = Math.abs(fit.b) / meanV;
  const last = v[v.length - 1] ?? 0;
  let type: ForecastModelType;
  let params: ChosenModel['params'] = {};

  if (isWeek) {
    const W = Math.min(8, v.length);
    const tail = v.slice(-W);
    const base = tail.reduce((a, b) => a + b, 0) / tail.length;
    if (fit.r2 >= 0.5 && trendRel > 0.015) type = 'trend';
    else if (fit.r2 >= 0.3) {
      type = 'avg';
      params = { W, base };
    } else type = 'naive';
  } else {
    if (fit.r2 >= 0.55 && trendRel > 0.02) {
      if (periods?.length) {
        const sf = seasonalFactors(v, fit, periods);
        if (sf.strength > 0.12) {
          type = 'seasonal';
          params = sf;
        } else type = 'trend';
      } else type = 'trend';
    } else if (fit.r2 >= 0.35) {
      const W = Math.min(6, v.length);
      const tail = v.slice(-W);
      const base = tail.reduce((a, b) => a + b, 0) / tail.length;
      type = 'avg';
      params = { W, base };
    } else type = 'naive';
  }

  return { type, fit, params, last };
}

export function modelForecast(
  m: ChosenModel,
  n: number,
  H: number,
  lastLbl: string,
  isWeek: boolean,
): ForecastPoint[] {
  const { type, fit, params, last } = m;
  const fc: ForecastPoint[] = [];
  if (type === 'trend' || type === 'seasonal') {
    for (let k = 1; k <= H; k++) {
      const t = n - 1 + k;
      let val = fit.a + fit.b * t;
      if (type === 'seasonal' && params.sIdx) {
        let mm = +lastLbl.split('-')[1]! + k;
        while (mm > 12) mm -= 12;
        val *= params.sIdx[mm] ?? 1;
      }
      if (val < 0) val = 0;
      fc.push({ ym: nextPeriodLabel(lastLbl, k, isWeek), val: Math.round(val) });
    }
  } else if (type === 'avg') {
    for (let k = 1; k <= H; k++) {
      fc.push({ ym: nextPeriodLabel(lastLbl, k, isWeek), val: Math.round(params.base ?? 0) });
    }
  } else {
    for (let k = 1; k <= H; k++) {
      fc.push({ ym: nextPeriodLabel(lastLbl, k, isWeek), val: Math.round(last) });
    }
  }
  return fc;
}
