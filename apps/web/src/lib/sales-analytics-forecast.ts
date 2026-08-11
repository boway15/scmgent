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

const MONTH_NAME = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
];

function signed(x: number): string {
  return `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
}

function fmtPieces(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}

/**
 * Bottom-panel forecast (Workbuddy `forecast()`): always linear trend × monthly
 * seasonal factors for months; weeks use pure linear trend (no seasonal).
 * Unlike `chooseModel`, this does not fall back to naive/avg when R² is low.
 */
export function trendSeasonalForecast(
  series: number[],
  periods: string[],
  horizon: number,
  isWeek: boolean,
): {
  a: number;
  b: number;
  r2: number;
  sIdx: Record<number, number>;
  peakM: number;
  troughM: number;
  last: number;
  fc: ForecastPoint[];
} {
  const fit = fitLinear(series);
  const lastLbl = periods[periods.length - 1] ?? '';
  const last = series[series.length - 1] ?? 0;
  let sIdx: Record<number, number>;
  let peakM = 1;
  let troughM = 1;

  if (isWeek) {
    sIdx = {};
    for (let m = 1; m <= 12; m++) sIdx[m] = 1;
  } else {
    const sf = seasonalFactors(series, fit, periods);
    sIdx = sf.sIdx;
    peakM = sf.peakM;
    troughM = sf.troughM;
  }

  const n = series.length;
  const fc: ForecastPoint[] = [];
  for (let k = 1; k <= horizon; k++) {
    const t = n - 1 + k;
    let val = fit.a + fit.b * t;
    if (!isWeek) {
      let mm = +(lastLbl.split('-')[1] ?? 1) + k;
      while (mm > 12) mm -= 12;
      val *= sIdx[mm] ?? 1;
    }
    if (val < 0) val = 0;
    fc.push({ ym: nextPeriodLabel(lastLbl, k, isWeek), val: Math.round(val) });
  }

  return { a: fit.a, b: fit.b, r2: fit.r2, sIdx, peakM, troughM, last, fc };
}

export function trendSeasonalRowBasis(
  f: { b: number; sIdx: Record<number, number> },
  ym: string,
  isWeek: boolean,
): string {
  if (isWeek) {
    return `线性趋势外推（斜率 ${signed(f.b)} 件/期）`;
  }
  const mm = +(ym.split('-')[1] ?? 1);
  return `趋势 ${signed(f.b)} 件/期 × 季节因子 ${(f.sIdx[mm] ?? 1).toFixed(2)}`;
}

export function trendSeasonalPanelTag(isWeek: boolean): string {
  return isWeek ? '线性趋势外推（周度无季节性）' : '线性趋势 + 月度季节性（乘法）';
}

export type FitConfidence = '较高' | '中等' | '偏低';

export function fitConfidenceFromR2(r2: number): FitConfidence {
  if (r2 >= 0.55) return '较高';
  if (r2 >= 0.35) return '中等';
  return '偏低';
}

/** Matrix/panel shared label for the unified trend×seasonal path. */
export function trendSeasonalModelLabel(isWeek: boolean, r2: number): string {
  const base = isWeek ? '线性趋势' : '趋势+季节';
  const conf = fitConfidenceFromR2(r2);
  return conf === '较高' ? base : `${base}（可信度${conf}）`;
}

/** Hover/tooltip rationale for unified trend×seasonal matrix rows. */
export function trendSeasonalModelReason(
  f: {
    a: number;
    b: number;
    r2: number;
    sIdx: Record<number, number>;
    peakM: number;
    troughM: number;
    last: number;
  },
  isWeek: boolean,
  periodCount: number,
): string {
  const tw = f.b > 0 ? '整体上升' : f.b < 0 ? '整体下降' : '基本平稳';
  const conf = fitConfidenceFromR2(f.r2);
  if (isWeek) {
    return (
      `线性趋势外推（与底部预估同口径）：斜率 ${signed(f.b)} 件/期，R²=${f.r2.toFixed(2)}（可信度${conf}），趋势${tw}；` +
      `基于 ${periodCount} 周历史按 y = a + b·t 外推（周度不做月度季节分解）。看板粗估，非系统发布预测。`
    );
  }
  const peakF = f.sIdx[f.peakM] ?? 1;
  const troughF = f.sIdx[f.troughM] ?? 1;
  return (
    `趋势+季节(乘法)（与底部预估同口径）：斜率 ${signed(f.b)} 件/期，R²=${f.r2.toFixed(2)}（可信度${conf}），趋势${tw}；` +
    `峰值 ${MONTH_NAME[f.peakM - 1]}(因子${peakF.toFixed(2)})、谷值 ${MONTH_NAME[f.troughM - 1]}(因子${troughF.toFixed(2)})；` +
    `按 (a+b·t)×季节因子 外推。看板粗估，非系统发布预测。`
  );
}

/** Human-readable rationale for the auto-chosen lightweight model. */
export function modelReason(m: ChosenModel): string {
  const { type, fit, params, last } = m;
  const tw = fit.b > 0 ? '整体上升' : fit.b < 0 ? '整体下降' : '基本平稳';
  if (type === 'trend') {
    return `线性趋势模型：最小二乘斜率 ${signed(fit.b)} 件/期，拟合优度 R²=${fit.r2.toFixed(2)}，趋势${tw}；按 y = a + b·t 外推未来期。`;
  }
  if (type === 'seasonal') {
    const peakM = params.peakM ?? 1;
    const troughM = params.troughM ?? 1;
    const peakF = params.sIdx?.[peakM] ?? 1;
    const troughF = params.sIdx?.[troughM] ?? 1;
    return (
      `趋势+季节(乘法)模型：斜率 ${signed(fit.b)} 件/期(R²=${fit.r2.toFixed(2)})，叠加月度季节因子——峰值 ${MONTH_NAME[peakM - 1]}(因子${peakF.toFixed(2)})、` +
      `谷值 ${MONTH_NAME[troughM - 1]}(因子${troughF.toFixed(2)})；按 (a+b·t)×季节因子 外推。`
    );
  }
  if (type === 'avg') {
    return `移动平均模型：趋势弱/波动大(R²=${fit.r2.toFixed(2)})，取最近 ${params.W ?? 0} 期均值 ${fmtPieces(params.base ?? 0)} 件作平稳外推，不假设增长。`;
  }
  return `朴素法(最新值外推)：数据无明显趋势(R²=${fit.r2.toFixed(2)})，以最新期 ${fmtPieces(last)} 件直接外推未来期。`;
}
