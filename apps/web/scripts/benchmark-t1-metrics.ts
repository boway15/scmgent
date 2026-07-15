/**
 * T1 层：多种误差指标 + 基线预测算法对比（可比样本）
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
} from '../server/lib/forecast-sales-tier.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const CSV = resolve(ROOT, 'docs/samples/xiaoshou/产品销售报表-每月6a40a8dac9533e5db3fc8864.csv');
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

type Pair = { pred: number; act: number; sku: string; h: number; seg: string };

function wmape(p: Pair[]): number | null {
  const c = p.filter((x) => x.act > 0);
  if (!c.length) return null;
  const ae = c.reduce((s, x) => s + Math.abs(x.pred - x.act), 0);
  const a = c.reduce((s, x) => s + x.act, 0);
  return a > 0 ? ae / a : null;
}

function mape(p: Pair[]): number | null {
  const c = p.filter((x) => x.act > 0);
  if (!c.length) return null;
  return c.reduce((s, x) => s + Math.abs(x.pred - x.act) / x.act, 0) / c.length;
}

function smape(p: Pair[]): number | null {
  const c = p.filter((x) => x.act > 0 || x.pred > 0);
  if (!c.length) return null;
  return (
    c.reduce(
      (s, x) => s + (2 * Math.abs(x.pred - x.act)) / (Math.abs(x.pred) + Math.abs(x.act) + 1e-9),
      0,
    ) / c.length
  );
}

function hitRate(p: Pair[], tol: number): number | null {
  const c = p.filter((x) => x.act > 0);
  if (!c.length) return null;
  return c.filter((x) => Math.abs(x.pred - x.act) / x.act <= tol).length / c.length;
}

function biasRate(p: Pair[]): number | null {
  const c = p.filter((x) => x.act > 0 && x.pred > 0);
  if (!c.length) return null;
  const num = c.reduce((s, x) => s + ((x.act - x.pred) / x.pred) * x.act, 0);
  const den = c.reduce((s, x) => s + x.act, 0);
  return den > 0 ? num / den : null;
}

function monthlyFromDaily(d: number, ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return d * daysInCalendarMonth(y!, m!);
}

const text = readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '');
const lines = text.split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines[0]!);
const months = header.map(parseMonthCol).filter((c): c is string => c != null).sort();
const trainMonths = months.slice(0, TRAIN);
const testMonths = months.slice(TRAIN, TRAIN + 3);

type Sku = { sku: string; months: Record<string, number> };
const bySku = new Map<string, Sku>();
for (let i = 1; i < lines.length; i++) {
  const parts = parseCsvLine(lines[i]!);
  const rec: Record<string, string> = {};
  header.forEach((h, j) => (rec[h] = (parts[j] ?? '').trim()));
  const sku = rec.SKU ?? '';
  if (!sku) continue;
  const m: Record<string, number> = {};
  for (const ym of months) m[ym] = Math.max(0, Number(rec[`(${ym})`]) || 0);
  const ex = bySku.get(sku);
  if (!ex) bySku.set(sku, { sku, months: m });
  else for (const ym of months) ex.months[ym] = (ex.months[ym] ?? 0) + m[ym]!;
}

const t1Skus = [...bySku.values()].filter((s) => {
  const raw = trainMonths.map((m) => s.months[m] ?? 0);
  return resolveSalesTierSegment(raw).tier === 'T1_anchor';
});

function runAlgo(
  name: string,
  predict: (raw: number[], h: number, ym: string) => number,
): Pair[] {
  const out: Pair[] = [];
  for (const s of t1Skus) {
    const raw = trainMonths.map((m) => s.months[m] ?? 0);
    const seg = resolveSalesTierSegment(raw).segment;
    for (const [h, ym] of testMonths.entries()) {
      const [fy, fm] = ym.split('-').map(Number);
      const predM = predict(raw, h, ym);
      const act = s.months[ym] ?? 0;
      out.push({ pred: predM, act, sku: s.sku, h: h + 1, seg });
    }
  }
  return out;
}

const algos: { name: string; pairs: Pair[] }[] = [
  {
    name: 't1_anchor（当前）',
    pairs: runAlgo('t1', (raw, h, ym) => {
      const [fy, fm] = ym.split('-').map(Number);
      const r = forecastT1AnchorDaily({
        monthlyQty: raw,
        rawMonthlyQty: raw,
        horizonIndex: h,
        forecastYear: fy!,
        forecastMonth: fm!,
      });
      return monthlyFromDaily(r.forecastDailyAvg, ym);
    }),
  },
  {
    name: 'seasonal_naive（去年同月）',
    pairs: runAlgo('sn', (raw, h, ym) => {
      const [fy, fm] = ym.split('-').map(Number);
      const ly = seasonalNaiveMonthlyQty(raw, h);
      return ly;
    }),
  },
  {
    name: 'med6_monthly（近6月中位）',
    pairs: runAlgo('med6', (raw, h, ym) => {
      const [fy, fm] = ym.split('-').map(Number);
      return median6MonthlyQty(raw);
    }),
  },
  {
    name: 'recent90_daily×天数',
    pairs: runAlgo('r90', (raw, h, ym) => {
      const [fy, fm] = ym.split('-').map(Number);
      const d = deriveRecentDailyFromMonthly(raw, fy!, fm!);
      return monthlyFromDaily(d.recent90DailyAvg, ym);
    }),
  },
  {
    name: 'last3_avg（近3月均）',
    pairs: runAlgo('l3', (raw) => {
      const last3 = raw.slice(-3);
      return last3.reduce((a, b) => a + b, 0) / last3.length;
    }),
  },
];

console.log('=== T1 算法对比（k=1~3，可比样本 act>0）===');
for (const { name, pairs } of algos) {
  const comp = pairs.filter((p) => p.act > 0);
  const elite = comp.filter((p) => p.seg === 'T1:elite');
  const anchor = comp.filter((p) => p.seg === 'T1:anchor');
  const hi = comp.filter((p) => p.act >= 100);
  console.log(
  `\n${name}`,
  `\n  全T1 WMAPE ${((wmape(comp) ?? 0) * 100).toFixed(1)}%`,
  `MAPE ${((mape(comp) ?? 0) * 100).toFixed(1)}%`,
  `sMAPE ${((smape(comp) ?? 0) * 100).toFixed(1)}%`,
  `±15%命中 ${((hitRate(comp, 0.15) ?? 0) * 100).toFixed(1)}%`,
  `bias ${((biasRate(comp) ?? 0) * 100).toFixed(1)}%`,
  );
  console.log(
    `  elite WMAPE ${((wmape(elite) ?? 0) * 100).toFixed(1)}%`,
    `anchor ${((wmape(anchor) ?? 0) * 100).toFixed(1)}%`,
    `act≥100 ${((wmape(hi) ?? 0) * 100).toFixed(1)}%`,
  );
}

// 细分维度：同一 t1_anchor 预测
const current = algos[0]!.pairs;
const comp = current.filter((p) => p.act > 0);

type Sub = { label: string; filter: (p: Pair, f: ReturnType<typeof extractSalesHistoryFeatures>) => boolean };
const subs: Sub[] = [
  { label: '全T1可比', filter: () => true },
  { label: 'T1:elite', filter: (p) => p.seg === 'T1:elite' },
  { label: 'T1:anchor', filter: (p) => p.seg === 'T1:anchor' },
  { label: 'act≥100', filter: (p) => p.act >= 100 },
  { label: 'act 50~99', filter: (p) => p.act >= 50 && p.act < 100 },
  { label: 'act<50', filter: (p) => p.act < 50 },
  { label: '无塌陷', filter: (_, f) => !f.collapsed },
  { label: '训练末月塌陷', filter: (_, f) => f.collapsed },
  { label: 'q4Boost<0.85（近端下滑）', filter: (_, f) => f.q4Boost < 0.85 },
  { label: 'q4Boost≥1.0', filter: (_, f) => f.q4Boost >= 1.0 },
];

const featBySku = new Map(
  t1Skus.map((s) => {
    const raw = trainMonths.map((m) => s.months[m] ?? 0);
    return [s.sku, extractSalesHistoryFeatures(raw)] as const;
  }),
);

console.log('\n=== t1_anchor 细分层 WMAPE / ±15%命中（一层层验）===');
for (const sub of subs) {
  const rows = comp.filter((p) => sub.filter(p, featBySku.get(p.sku)!));
  if (rows.length < 5) continue;
  console.log(
    `${sub.label.padEnd(22)} n=${String(rows.length).padStart(4)}`,
    `WMAPE ${((wmape(rows) ?? 0) * 100).toFixed(1).padStart(5)}%`,
    `MAPE ${((mape(rows) ?? 0) * 100).toFixed(1).padStart(5)}%`,
    `±15% ${((hitRate(rows, 0.15) ?? 0) * 100).toFixed(1).padStart(5)}%`,
    `目标20% ${(wmape(rows) ?? 1) <= 0.2 ? 'PASS' : 'fail'}`,
  );
}

console.log('\n=== 指标说明 ===');
console.log('换 MAPE/sMAPE 不会让「同一预测」自动达标——分母不同，排名可能变，但算法未变则改善有限');
console.log('±15%命中率：业务「够用」口径，主力 SKU 常比 WMAPE 更直观');
