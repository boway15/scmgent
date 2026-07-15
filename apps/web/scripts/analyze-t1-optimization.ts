/**
 * T1 优化潜力分析：误差结构、反事实基线、Top 贡献 SKU
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { daysInCalendarMonth } from '../server/lib/forecast-baseline.js';
import {
  deriveRecentDailyFromMonthly,
  median6MonthlyQty,
  monthlyQtyToDailyAvg,
  seasonalNaiveMonthlyQty,
} from '../server/lib/forecast-monthly-abcd.js';
import { forecastT1AnchorDaily } from '../server/lib/forecast-t1-anchor.js';
import {
  extractSalesHistoryFeatures,
  resolveSalesTierSegment,
  resolveT1SubSegment,
  type T1SubSegment,
} from '../server/lib/forecast-sales-tier.js';
import {
  DEFAULT_KPI_MIN_ACTUAL_MONTHLY,
  DEFAULT_OUTLIER_APE_THRESHOLD,
  filterRowsForCoreKpi,
  isOutlierRow,
} from '../server/lib/forecast-accuracy-outlier.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const SALES_CSV = resolve(ROOT, 'docs/samples/xiaoshou/产品销售报表-每月6a40a8dac9533e5db3fc8864.csv');
const PRED_CSV = resolve(ROOT, 'docs/samples/forecast-backtest/csv-backtest-report/backtest-predictions.csv');
const TRAIN = 24;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseMonthCol(col: string): string | null {
  const m = /^\((\d{4}-\d{2})\)$/.exec(col.trim());
  return m ? m[1]! : null;
}

type Pair = {
  sku: string;
  h: number;
  ym: string;
  pred: number;
  act: number;
  model: string;
  ghost: boolean;
  outlierSku: boolean;
  kpiCore: boolean;
  t1Sub: string;
  seg: string;
};

function wmape(p: Pair[]): number | null {
  const c = p.filter((x) => x.act > 0);
  if (!c.length) return null;
  return c.reduce((s, x) => s + Math.abs(x.pred - x.act), 0) / c.reduce((s, x) => s + x.act, 0);
}

function bias(p: Pair[]): number | null {
  const c = p.filter((x) => x.act > 0 && x.pred > 0);
  if (!c.length) return null;
  return c.reduce((s, x) => s + ((x.pred - x.act) / x.act) * x.act, 0) / c.reduce((s, x) => s + x.act, 0);
}

function monthlyFromDaily(d: number, ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return d * daysInCalendarMonth(y!, m!);
}

// load sales
const salesText = readFileSync(SALES_CSV, 'utf8').replace(/^\uFEFF/, '');
const salesLines = salesText.split(/\r?\n/).filter(Boolean);
const salesHeader = parseCsvLine(salesLines[0]!);
const months = salesHeader.map(parseMonthCol).filter((c): c is string => c != null).sort();
const trainMonths = months.slice(0, TRAIN);
const testMonths = months.slice(TRAIN, TRAIN + 3);

const skuMonths = new Map<string, Record<string, number>>();
for (let i = 1; i < salesLines.length; i++) {
  const parts = parseCsvLine(salesLines[i]!);
  const rec: Record<string, string> = {};
  salesHeader.forEach((h, j) => (rec[h] = (parts[j] ?? '').trim()));
  const sku = rec.SKU ?? '';
  if (!sku) continue;
  const m: Record<string, number> = {};
  for (const ym of months) m[ym] = Math.max(0, Number(rec[`(${ym})`]) || 0);
  const ex = skuMonths.get(sku);
  if (!ex) skuMonths.set(sku, m);
  else for (const ym of months) ex[ym] = (ex[ym] ?? 0) + m[ym]!;
}

// load preds
const predText = readFileSync(PRED_CSV, 'utf8').replace(/^\uFEFF/, '');
const predLines = predText.split(/\r?\n/).filter(Boolean);
const predHeader = parseCsvLine(predLines[0]!);
const ix = (n: string) => predHeader.indexOf(n);

const rows: Pair[] = [];
for (let i = 1; i < predLines.length; i++) {
  const p = parseCsvLine(predLines[i]!);
  rows.push({
    sku: p[ix('sku')] ?? '',
    h: Number(p[ix('horizon')]),
    ym: p[ix('year_month')] ?? '',
    pred: Number(p[ix('predicted_monthly')]),
    act: Number(p[ix('actual_monthly')]),
    model: p[ix('model')] ?? '',
    ghost: p[ix('ghost_row')] === '1',
    outlierSku: p[ix('outlier_sku')] === '1',
    kpiCore: p[ix('kpi_core')] === '1',
    t1Sub: p[ix('t1_sub_segment')] ?? '',
    seg: p[ix('sales_segment')] ?? '',
  });
}

const near = rows.filter((r) => r.h <= 3);
const t1Near = near.filter((r) => r.seg.startsWith('T1'));
const coreKpi = t1Near.filter((r) => r.kpiCore);
const gate11 = t1Near.filter((r) => r.t1Sub === 'T1.1_elite_stable');
const gate11Core = gate11.filter((r) => r.kpiCore);

console.log('=== 1. 当前口径（k=1~3）===');
console.log('T1 原始 WMAPE', ((wmape(t1Near) ?? 0) * 100).toFixed(1) + '%');
console.log('T1 核心 KPI WMAPE', ((wmape(coreKpi) ?? 0) * 100).toFixed(1) + '%', 'bias', ((bias(coreKpi) ?? 0) * 100).toFixed(1) + '%');
console.log('T1.1 核心 KPI', ((wmape(gate11Core) ?? 0) * 100).toFixed(1) + '%', 'n=', gate11Core.length);

console.log('\n=== 2. 误差来源分解（T1 k=1~3）===');
const buckets = [
  { label: 'ghost', f: (r: Pair) => r.ghost },
  { label: '外生冲击 SKU（可比月）', f: (r: Pair) => !r.ghost && r.outlierSku && r.act > 0 },
  { label: '核心 KPI 可比', f: (r: Pair) => r.kpiCore },
  { label: '微销展示 act<50', f: (r: Pair) => !r.ghost && !r.outlierSku && r.act > 0 && r.act < 50 },
  { label: '可比非核心 act>=50', f: (r: Pair) => !r.ghost && !r.outlierSku && r.act >= 50 && !r.kpiCore },
];
for (const b of buckets) {
  const sub = t1Near.filter(b.f);
  const absErr = sub.reduce((s, r) => s + Math.abs(r.pred - r.act), 0);
  const totalErr = t1Near.reduce((s, r) => s + Math.abs(r.pred - r.act), 0);
  console.log(
    `${b.label.padEnd(22)} n=${String(sub.length).padStart(4)}`,
    `WMAPE ${((wmape(sub) ?? 0) * 100).toFixed(1).padStart(5)}%`,
    `误差占比 ${totalErr > 0 ? ((absErr / totalErr) * 100).toFixed(0) : 0}%`,
  );
}

console.log('\n=== 3. 按地平线 / 子层（核心 KPI）===');
for (const h of [1, 2, 3]) {
  const sub = coreKpi.filter((r) => r.h === h);
  console.log(`k=${h} WMAPE ${((wmape(sub) ?? 0) * 100).toFixed(1)}% bias ${((bias(sub) ?? 0) * 100).toFixed(1)}% n=${sub.length}`);
}
for (const sub of ['T1.1_elite_stable', 'T1.3_anchor_stable'] as T1SubSegment[]) {
  const s = coreKpi.filter((r) => r.t1Sub === sub);
  console.log(`${sub} 核心 WMAPE ${((wmape(s) ?? 0) * 100).toFixed(1)}% n=${s.length}`);
}

console.log('\n=== 4. 高估 vs 低估（核心 KPI）===');
const over = coreKpi.filter((r) => r.pred > r.act * 1.15);
const under = coreKpi.filter((r) => r.pred < r.act * 0.85);
const ok = coreKpi.filter((r) => r.pred >= r.act * 0.85 && r.pred <= r.act * 1.15);
console.log(`高估>15% ${over.length} WMAPE ${((wmape(over) ?? 0) * 100).toFixed(1)}%`);
console.log(`低估<-15% ${under.length} WMAPE ${((wmape(under) ?? 0) * 100).toFixed(1)}%`);
console.log(`±15%内 ${ok.length} WMAPE ${((wmape(ok) ?? 0) * 100).toFixed(1)}% 占比 ${((ok.length / coreKpi.length) * 100).toFixed(0)}%`);

console.log('\n=== 5. Top 15 误差贡献 SKU（核心 KPI，按绝对误差）===');
const bySku = new Map<string, Pair[]>();
for (const r of coreKpi) {
  const arr = bySku.get(r.sku) ?? [];
  arr.push(r);
  bySku.set(r.sku, arr);
}
const skuErr = [...bySku.entries()]
  .map(([sku, rs]) => ({
    sku,
    absErr: rs.reduce((s, r) => s + Math.abs(r.pred - r.act), 0),
    act: rs.reduce((s, r) => s + r.act, 0),
    wmape: wmape(rs),
    bias: bias(rs),
    n: rs.length,
  }))
  .sort((a, b) => b.absErr - a.absErr)
  .slice(0, 15);
for (const s of skuErr) {
  console.log(
    `  ${s.sku}: absErr=${s.absErr.toFixed(0)} WMAPE=${((s.wmape ?? 0) * 100).toFixed(0)}% bias=${((s.bias ?? 0) * 100).toFixed(0)}% (${s.n}月)`,
  );
}

// counterfactual algorithms on T1.1 core SKUs only
console.log('\n=== 6. 反事实基线（T1.1 核心 KPI SKU，k=1~3）===');
const gate11Skus = new Set(gate11Core.map((r) => r.sku));
type CfRow = { pred: number; act: number };
const cf: Record<string, CfRow[]> = {
  current: [],
  med6: [],
  seasonal: [],
  last3: [],
  recent90: [],
};

for (const sku of gate11Skus) {
  const raw = trainMonths.map((m) => skuMonths.get(sku)?.[m] ?? 0);
  if (resolveSalesTierSegment(raw).tier !== 'T1_anchor') continue;
  for (const [h, ym] of testMonths.entries()) {
    const act = skuMonths.get(sku)?.[ym] ?? 0;
    if (act < DEFAULT_KPI_MIN_ACTUAL_MONTHLY) continue;
    const [fy, fm] = ym.split('-').map(Number);
    const cur = forecastT1AnchorDaily({
      monthlyQty: raw,
      rawMonthlyQty: raw,
      horizonIndex: h,
      forecastYear: fy!,
      forecastMonth: fm!,
    });
    const d = deriveRecentDailyFromMonthly(raw, fy!, fm!);
    const preds = {
      current: monthlyFromDaily(cur.forecastDailyAvg, ym),
      med6: median6MonthlyQty(raw),
      seasonal: seasonalNaiveMonthlyQty(raw, h),
      last3: raw.slice(-3).reduce((a, b) => a + b, 0) / 3,
      recent90: monthlyFromDaily(d.recent90DailyAvg, ym),
    };
    for (const [name, pred] of Object.entries(preds)) {
      cf[name]!.push({ pred, act });
    }
  }
}
for (const [name, pairs] of Object.entries(cf)) {
  const w = wmape(pairs.map((p) => ({ ...p, sku: '', h: 1, ym: '', model: '', ghost: false, outlierSku: false, kpiCore: true, t1Sub: '', seg: '' })));
  console.log(`  ${name.padEnd(10)} WMAPE ${((w ?? 0) * 100).toFixed(1)}% n=${pairs.length}`);
}

console.log('\n=== 7. 验证期月份效应（核心 KPI）===');
for (const ym of testMonths) {
  const sub = coreKpi.filter((r) => r.ym === ym);
  console.log(`${ym}: WMAPE ${((wmape(sub) ?? 0) * 100).toFixed(1)}% bias ${((bias(sub) ?? 0) * 100).toFixed(1)}% act=${sub.reduce((s, r) => s + r.act, 0).toFixed(0)}`);
}

console.log('\n=== 8. 训练特征与误差（T1.1 核心 KPI）===');
const featBuckets = [
  { label: 'q4Boost>=1.0', f: (f: ReturnType<typeof extractSalesHistoryFeatures>) => f.q4Boost >= 1.0 },
  { label: 'q4Boost 0.85~1', f: (f: ReturnType<typeof extractSalesHistoryFeatures>) => f.q4Boost >= 0.85 && f.q4Boost < 1.0 },
  { label: 'cv<0.5', f: (f: ReturnType<typeof extractSalesHistoryFeatures>) => f.cv < 0.5 },
  { label: 'cv 0.5~0.9', f: (f: ReturnType<typeof extractSalesHistoryFeatures>) => f.cv >= 0.5 && f.cv < 0.9 },
];
for (const sku of gate11Skus) {
  const raw = trainMonths.map((m) => skuMonths.get(sku)?.[m] ?? 0);
  const feat = extractSalesHistoryFeatures(raw);
  const rs = gate11Core.filter((r) => r.sku === sku);
  if (!rs.length) continue;
  for (const b of featBuckets) {
    if (b.f(feat)) {
      (b as { rows?: Pair[] }).rows = ((b as { rows?: Pair[] }).rows ?? []).concat(rs);
    }
  }
}
for (const b of featBuckets) {
  const rs = (b as { rows?: Pair[] }).rows ?? [];
  if (rs.length < 5) continue;
  console.log(`${b.label.padEnd(16)} n=${rs.length} WMAPE ${((wmape(rs) ?? 0) * 100).toFixed(1)}%`);
}

console.log('\n=== 9. 优化潜力估算 ===');
const totalActCore = coreKpi.reduce((s, r) => s + r.act, 0);
const totalAbsCore = coreKpi.reduce((s, r) => s + Math.abs(r.pred - r.act), 0);
const top5Err = skuErr.slice(0, 5).reduce((s, x) => s + x.absErr, 0);
const ghostErr = t1Near.filter((r) => r.ghost).reduce((s, r) => s + r.pred, 0);
console.log(`核心 KPI 总绝对误差: ${totalAbsCore.toFixed(0)}（销量基数 ${totalActCore.toFixed(0)}）`);
console.log(`Top5 SKU 误差占比: ${((top5Err / totalAbsCore) * 100).toFixed(1)}%`);
console.log(`若消灭全部 ghost 预测量: 可减少 ghost 预测 ${ghostErr.toFixed(0)} 件/月累计`);
const ifTop5Out = totalAbsCore - top5Err;
console.log(`若再剔除 Top5 误差 SKU: 核心 WMAPE 约 ${((ifTop5Out / totalActCore) * 100).toFixed(1)}%（${((wmape(coreKpi) ?? 0) * 100).toFixed(1)}% → 理论下限）`);

// blend sensitivity: simulate 80/20 vs 72/28 for stable T1.1
console.log('\n=== 10. 结构性与季节性（验证期整体下滑？）===');
const trainQ4 = trainMonths.slice(-3);
const trainPrior = trainMonths.slice(-12, -3);
const q4TrainSum = [...skuMonths.values()].reduce(
  (s, m) => s + trainQ4.reduce((a, ym) => a + (m[ym] ?? 0), 0),
  0,
);
const priorTrainSum = [...skuMonths.values()].reduce(
  (s, m) => s + trainPrior.reduce((a, ym) => a + (m[ym] ?? 0), 0),
  0,
);
const valSum = testMonths.reduce(
  (s, ym) => s + [...skuMonths.values()].reduce((a, m) => a + (m[ym] ?? 0), 0),
  0,
);
const valPerMonth = valSum / testMonths.length;
const trainQ4Avg = q4TrainSum / 3;
console.log(`训练末3月均平台销量: ${(trainQ4Avg / 1).toFixed(0)}`);
console.log(`验证期月均平台销量: ${(valSum / testMonths.length).toFixed(0)}`);
console.log(`验证/训练末3月: ${((valPerMonth / trainQ4Avg) * 100).toFixed(0)}%（整体市场下滑会系统性高估）`);

console.log('\n=== 11. 建议优先级 ===');
const w11 = (wmape(gate11Core) ?? 0) * 100;
const wCore = (wmape(coreKpi) ?? 0) * 100;
console.log(`[P0] ghost 仍 ${t1Near.filter((r) => r.ghost).length} 行 — 加强 T1.5 塌陷与断销规则`);
console.log(`[P1] 验证期整体下滑 ${((valPerMonth / trainQ4Avg) * 100).toFixed(0)}% — 对 q4Boost<1 的 T1.1 加宏观折扣 5~10%`);
console.log(`[P2] 高估样本 ${over.length} 行 — 检查 bias cap 是否过松`);
console.log(`[P3] Top SKU 集中 ${((top5Err / totalAbsCore) * 100).toFixed(0)}% 误差 — 外生标记或人工复核`);
console.log(`[P4] T1.1 核心 KPI ${w11.toFixed(1)}% vs 目标 20% — 算法微调空间约 ${Math.max(0, w11 - 20).toFixed(0)}pp，med6 未必更优见 §6`);

// counterfactual discounts
const cf96 = coreKpi.map((r) => ({ ...r, pred: r.pred * 0.96 }));
const cf94 = coreKpi.map((r) => ({ ...r, pred: r.pred * 0.94 }));
console.log('\n=== 12. 反事实宏观折扣（核心 KPI）===');
console.log('4% 全平台折扣 WMAPE', ((wmape(cf96) ?? 0) * 100).toFixed(1) + '%');
console.log('6% 全平台折扣 WMAPE', ((wmape(cf94) ?? 0) * 100).toFixed(1) + '%');

const dj = t1Near.filter((r) => r.sku.startsWith('DJ502530'));
console.log('\n=== 13. DJ502530 家族（典型高估簇）===');
console.log('rows', dj.length, 'WMAPE', ((wmape(dj.filter((r) => r.act > 0)) ?? 0) * 100).toFixed(0) + '%');
console.log('pred sum', dj.reduce((s, r) => s + r.pred, 0), 'act sum', dj.reduce((s, r) => s + r.act, 0));
