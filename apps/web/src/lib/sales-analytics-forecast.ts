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

/** 与发布版预测季节限幅对齐（看板粗估） */
export const DASHBOARD_SEASONALITY_CLIP_MIN = 0.85;
export const DASHBOARD_SEASONALITY_CLIP_MAX = 1.15;
export const DASHBOARD_MIN_MONTHS_FOR_SEASONAL = 24;

export type DashboardForecastPath = 'seasonal' | 'trend' | 'avg' | 'naive';

export type TrendSeasonalForecastResult = {
  path: DashboardForecastPath;
  a: number;
  b: number;
  r2: number;
  sIdx: Record<number, number>;
  peakM: number;
  troughM: number;
  last: number;
  anchor: number;
  avgWindow?: number;
  fc: ForecastPoint[];
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

function seasonalShrinkWeight(sampleCount: number): number {
  if (sampleCount >= 3) return 1;
  if (sampleCount === 2) return 0.65;
  return 0.35;
}

export function clipDashboardSeasonality(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.max(
    DASHBOARD_SEASONALITY_CLIP_MIN,
    Math.min(DASHBOARD_SEASONALITY_CLIP_MAX, raw),
  );
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

/** 季节因子：按样本数向 1 收缩，并限幅到 [0.85, 1.15] */
function seasonalFactorsRobust(
  v: number[],
  fit: LinearFit,
  periods: string[],
): SeasonalParams {
  const season: Record<number, number[]> = {};
  for (let i = 0; i < v.length; i++) {
    const mm = +(periods[i] ?? '').split('-')[1]!;
    if (!mm) continue;
    const trend = fit.a + fit.b * i;
    if (trend > 0) (season[mm] ??= []).push(v[i]! / trend);
  }

  const rawIdx: Record<number, number> = {};
  let ssum = 0;
  let scnt = 0;
  for (let m = 1; m <= 12; m++) {
    const arr = season[m];
    if (arr?.length) {
      const avg = arr.reduce((x, y) => x + y, 0) / arr.length;
      rawIdx[m] = avg;
      ssum += avg;
      scnt++;
    } else {
      rawIdx[m] = 1;
    }
  }
  const mean = scnt ? ssum / scnt : 1;

  const sIdx: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    const normalized = mean ? rawIdx[m]! / mean : 1;
    const shrunk = 1 + (normalized - 1) * seasonalShrinkWeight(season[m]?.length ?? 0);
    sIdx[m] = clipDashboardSeasonality(shrunk);
  }

  let peakM = 1;
  let troughM = 1;
  for (let m = 1; m <= 12; m++) {
    if (sIdx[m]! > sIdx[peakM]!) peakM = m;
    if (sIdx[m]! < sIdx[troughM]!) troughM = m;
  }
  const smax = Math.max(...Object.values(sIdx));
  const smin = Math.min(...Object.values(sIdx));
  return { sIdx, peakM, troughM, strength: smax - smin };
}

function trimLeadingZeros(
  series: number[],
  periods: string[],
): { series: number[]; periods: string[] } {
  let start = 0;
  while (start < series.length && (series[start] ?? 0) <= 0) start++;
  if (start >= series.length) return { series: [], periods: [] };
  return { series: series.slice(start), periods: periods.slice(start) };
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function isCurrentMonthPeriod(period: string, now: Date): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return false;
  return +m[1]! === now.getFullYear() && +m[2]! === now.getMonth() + 1;
}

function prorateIncompletePeriod(
  value: number,
  period: string,
  isWeek: boolean,
  now: Date,
): number {
  if (value <= 0 || isWeek) return value;
  if (!isCurrentMonthPeriod(period, now)) return value;
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return value;
  const dim = daysInMonth(+m[1]!, +m[2]!);
  const day = now.getDate();
  if (day >= dim) return value;
  return value / (day / dim);
}

export function preprocessForecastSeries(
  series: number[],
  periods: string[],
  isWeek: boolean,
  now: Date = new Date(),
): { series: number[]; periods: string[] } {
  const trimmed = trimLeadingZeros(series, periods);
  if (trimmed.series.length === 0) return trimmed;
  const adjusted = [...trimmed.series];
  const lastIdx = adjusted.length - 1;
  adjusted[lastIdx] = prorateIncompletePeriod(
    adjusted[lastIdx]!,
    trimmed.periods[lastIdx]!,
    isWeek,
    now,
  );
  return { series: adjusted, periods: trimmed.periods };
}

function computeAnchor(v: number[], isWeek: boolean): number {
  const W = isWeek ? Math.min(8, v.length) : Math.min(6, v.length);
  if (W <= 0) return 0;
  const tail = v.slice(-W);
  return tail.reduce((a, b) => a + b, 0) / W;
}

function dampedTrendFactor(b: number, anchor: number, k: number, isWeek: boolean): number {
  if (anchor <= 0) return 1;
  const trendRel = b / anchor;
  const halfLife = isWeek ? 16 : 8;
  const decay = Math.max(0, 1 - k / halfLife);
  const raw = 1 + trendRel * k * decay;
  return Math.max(0.7, Math.min(1.3, raw));
}

function forecastMonth(lastLbl: string, k: number): number {
  let mm = +(lastLbl.split('-')[1] ?? 1) + k;
  while (mm > 12) mm -= 12;
  return mm;
}

function buildAvgModel(v: number[], isWeek: boolean): ChosenModel {
  const fit = fitLinear(v);
  const W = isWeek ? Math.min(8, v.length) : Math.min(6, v.length);
  const tail = v.slice(-W);
  const base = tail.reduce((a, b) => a + b, 0) / (W || 1);
  return {
    type: 'avg',
    fit,
    params: { W, base },
    last: v[v.length - 1] ?? 0,
  };
}

function emptyForecastResult(last: number): TrendSeasonalForecastResult {
  const sIdx: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) sIdx[m] = 1;
  return {
    path: 'naive',
    a: 0,
    b: 0,
    r2: 0,
    sIdx,
    peakM: 1,
    troughM: 1,
    last,
    anchor: last,
    fc: [],
  };
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
 * 看板统一粗估：预处理 → 弱信号退回均线/朴素 → 否则近端锚定 + 衰减趋势 × 限幅季节。
 */
export function trendSeasonalForecast(
  series: number[],
  periods: string[],
  horizon: number,
  isWeek: boolean,
  now: Date = new Date(),
): TrendSeasonalForecastResult {
  const last = series[series.length - 1] ?? 0;
  const lastLbl = periods[periods.length - 1] ?? '';

  if (series.length < 2 || !lastLbl) {
    return emptyForecastResult(last);
  }

  const { series: clean, periods: cleanPeriods } = preprocessForecastSeries(
    series,
    periods,
    isWeek,
    now,
  );
  if (clean.length < 2) {
    return {
      ...emptyForecastResult(last),
      fc: Array.from({ length: horizon }, (_, i) => ({
        ym: nextPeriodLabel(lastLbl, i + 1, isWeek),
        val: 0,
      })),
    };
  }

  const fit = fitLinear(clean);
  const anchor = computeAnchor(clean, isWeek);
  let auto = chooseModel(clean, isWeek, cleanPeriods);

  const insufficientSeasonalHistory =
    !isWeek && clean.length < DASHBOARD_MIN_MONTHS_FOR_SEASONAL;
  if (insufficientSeasonalHistory && auto.type === 'seasonal') {
    auto = buildAvgModel(clean, isWeek);
  }

  const minAvgHistory = isWeek ? 8 : 6;
  if (auto.type === 'naive' && clean.length >= minAvgHistory) {
    auto = buildAvgModel(clean, isWeek);
  }

  if (auto.type === 'naive' || auto.type === 'avg') {
    const fc = modelForecast(auto, clean.length, horizon, lastLbl, isWeek);
    return {
      path: auto.type,
      a: fit.a,
      b: fit.b,
      r2: fit.r2,
      sIdx: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 1])),
      peakM: 1,
      troughM: 1,
      last,
      anchor: auto.type === 'avg' ? (auto.params.base ?? anchor) : last,
      avgWindow: auto.params.W,
      fc,
    };
  }

  const sf = isWeek ? null : seasonalFactorsRobust(clean, fit, cleanPeriods);
  const useSeasonal =
    !isWeek && auto.type === 'seasonal' && (sf?.strength ?? 0) > 0.05;
  const path: DashboardForecastPath = useSeasonal ? 'seasonal' : 'trend';
  const sIdx = sf?.sIdx ?? Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 1]));
  const peakM = sf?.peakM ?? 1;
  const troughM = sf?.troughM ?? 1;

  const fc: ForecastPoint[] = [];
  for (let k = 1; k <= horizon; k++) {
    let val = anchor * dampedTrendFactor(fit.b, anchor, k, isWeek);
    if (useSeasonal) {
      val *= sIdx[forecastMonth(lastLbl, k)] ?? 1;
    }
    if (val < 0) val = 0;
    fc.push({ ym: nextPeriodLabel(lastLbl, k, isWeek), val: Math.round(val) });
  }

  return { path, a: fit.a, b: fit.b, r2: fit.r2, sIdx, peakM, troughM, last, anchor, fc };
}

export function trendSeasonalRowBasis(
  f: Pick<TrendSeasonalForecastResult, 'path' | 'b' | 'sIdx' | 'anchor' | 'last' | 'avgWindow'>,
  ym: string,
  isWeek: boolean,
): string {
  if (f.path === 'avg') {
    return `近 ${f.avgWindow ?? 6} 期均值 ${Math.round(f.anchor)} 件`;
  }
  if (f.path === 'naive') {
    return `最新期 ${Math.round(f.last)} 件`;
  }
  const trendPart = `锚定 ${Math.round(f.anchor)} 件 × 衰减趋势`;
  if (isWeek) {
    return `${trendPart}（斜率 ${signed(f.b)} 件/期）`;
  }
  const mm = +(ym.split('-')[1] ?? 1);
  return `${trendPart} × 季节因子 ${(f.sIdx[mm] ?? 1).toFixed(2)}`;
}

export function trendSeasonalPanelTag(isWeek: boolean): string {
  return isWeek
    ? '近8周锚定 + 衰减趋势'
    : '近6月锚定 + 限幅季节（0.85–1.15）';
}

export type FitConfidence = '较高' | '中等' | '偏低';

export function fitConfidenceFromR2(r2: number): FitConfidence {
  if (r2 >= 0.55) return '较高';
  if (r2 >= 0.35) return '中等';
  return '偏低';
}

/** Matrix/panel shared label for the unified dashboard forecast path. */
export function trendSeasonalModelLabel(
  isWeek: boolean,
  r2: number,
  path: DashboardForecastPath = 'seasonal',
): string {
  if (path === 'avg') return '移动平均（粗估）';
  if (path === 'naive') return '朴素法（粗估）';
  const base = isWeek ? '锚定+衰减趋势' : path === 'seasonal' ? '锚定+限幅季节' : '锚定+衰减趋势';
  const conf = fitConfidenceFromR2(r2);
  return conf === '较高' ? base : `${base}（可信度${conf}）`;
}

/** Hover/tooltip rationale for unified dashboard forecast rows. */
export function trendSeasonalModelReason(
  f: Pick<
    TrendSeasonalForecastResult,
    'path' | 'a' | 'b' | 'r2' | 'sIdx' | 'peakM' | 'troughM' | 'last' | 'anchor' | 'avgWindow'
  >,
  isWeek: boolean,
  periodCount: number,
): string {
  const conf = fitConfidenceFromR2(f.r2);
  if (f.path === 'avg') {
    return (
      `移动平均粗估（与底部预估同口径）：趋势弱或历史不足 ${DASHBOARD_MIN_MONTHS_FOR_SEASONAL} 月，` +
      `取近 ${f.avgWindow ?? 6} 期均值 ${fmtPieces(f.anchor)} 件平稳外推；R²=${f.r2.toFixed(2)}（可信度${conf}）。看板粗估，非系统发布预测。`
    );
  }
  if (f.path === 'naive') {
    return (
      `朴素法粗估（与底部预估同口径）：数据无明显趋势(R²=${f.r2.toFixed(2)}，可信度${conf})，` +
      `以最新期 ${fmtPieces(f.last)} 件外推。看板粗估，非系统发布预测。`
    );
  }

  const tw = f.b > 0 ? '整体上升' : f.b < 0 ? '整体下降' : '基本平稳';
  if (isWeek) {
    return (
      `近8周锚定 + 衰减趋势（与底部预估同口径）：锚定 ${fmtPieces(f.anchor)} 件，斜率 ${signed(f.b)} 件/期，` +
      `R²=${f.r2.toFixed(2)}（可信度${conf}），趋势${tw}；基于 ${periodCount} 周历史。看板粗估，非系统发布预测。`
    );
  }
  const peakF = f.sIdx[f.peakM] ?? 1;
  const troughF = f.sIdx[f.troughM] ?? 1;
  const seasonalNote =
    f.path === 'seasonal'
      ? `季节因子限幅 [${DASHBOARD_SEASONALITY_CLIP_MIN}, ${DASHBOARD_SEASONALITY_CLIP_MAX}]，` +
        `峰值 ${MONTH_NAME[f.peakM - 1]}(因子${peakF.toFixed(2)})、谷值 ${MONTH_NAME[f.troughM - 1]}(因子${troughF.toFixed(2)})；`
      : '未检测到足够季节强度，仅应用衰减趋势；';
  return (
    `近6月锚定 + 限幅季节（与底部预估同口径）：锚定 ${fmtPieces(f.anchor)} 件，斜率 ${signed(f.b)} 件/期，` +
    `R²=${f.r2.toFixed(2)}（可信度${conf}），趋势${tw}；${seasonalNote}` +
    `基于 ${periodCount} 月历史（已去前导零${isWeek ? '' : '、进行中月折整'}）。看板粗估，非系统发布预测。`
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

/** 相邻预测期最大环比绝对值（%），用于稳定性校验 */
export function maxForecastMomPct(fc: ForecastPoint[], lastActual: number): number | null {
  if (fc.length === 0) return null;
  let prev = lastActual;
  let maxAbs = 0;
  for (const p of fc) {
    if (prev > 0) {
      maxAbs = Math.max(maxAbs, Math.abs(((p.val - prev) / prev) * 100));
    }
    prev = p.val;
  }
  return maxAbs;
}
