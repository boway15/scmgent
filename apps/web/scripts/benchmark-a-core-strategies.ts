/**
 * 对比 A:core 各锚定策略 WMAPE（可比样本）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { daysInCalendarMonth } from '../server/lib/forecast-baseline.js';
import {
  deriveRecentDailyFromMonthly,
  isLastMonthCollapsed,
  seasonalNaiveMonthlyQty,
} from '../server/lib/forecast-monthly-abcd.js';
import { evaluateAClassDemandRisk } from '../server/lib/forecast-a-risk.js';

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

type Sku = { sku: string; months: Record<string, number> };

function load(): { aSkus: Sku[]; trainMonths: string[]; testMonths: string[] } {
  const text = readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]!);
  const months = header.map(parseMonthCol).filter((c): c is string => c != null).sort();
  const trainMonths = months.slice(0, TRAIN);
  const testMonths = months.slice(TRAIN, TRAIN + 5);
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
  const skus = [...bySku.values()];
  const scored = skus.map((s) => ({
    s,
    q12: trainMonths.slice(-12).reduce((a, m) => a + (s.months[m] ?? 0), 0),
  }));
  scored.sort((a, b) => b.q12 - a.q12);
  return { aSkus: scored.slice(0, 853).map((x) => x.s), trainMonths, testMonths };
}

function wmape(pairs: { pred: number; act: number }[]): number {
  const c = pairs.filter((p) => p.act > 0);
  if (!c.length) return NaN;
  return c.reduce((s, p) => s + Math.abs(p.pred - p.act), 0) / c.reduce((s, p) => s + p.act, 0);
}

function monthlyFromDaily(d: number, ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return d * daysInCalendarMonth(y!, m!);
}

type Strategy = (train: number[], testYm: string, h: number) => number;

const strategies: Record<string, Strategy> = {
  recent3avg: (train, testYm, h) => {
    const avg = train.slice(-3).reduce((a, b) => a + b, 0) / 3;
    return avg;
  },
  seasonalNaive: (train, _testYm, h) => seasonalNaiveMonthlyQty(train, h),
  collapsedNear: (train, testYm, h) => {
    const [fy, fm] = testYm.split('-').map(Number);
    const d = deriveRecentDailyFromMonthly(train, fy!, fm!);
    return monthlyFromDaily(d.recent30DailyAvg, testYm);
  },
  collapsedBlendLy: (train, testYm, h) => {
    const [fy, fm] = testYm.split('-').map(Number);
    const d = deriveRecentDailyFromMonthly(train, fy!, fm!);
    const near = monthlyFromDaily(d.recent90DailyAvg, testYm);
    const ly = seasonalNaiveMonthlyQty(train, h);
    return 0.6 * near + 0.4 * ly;
  },
  riskAware: (train, testYm, h) => {
    const risk = evaluateAClassDemandRisk(train);
    if (risk.forceZero) return 0;
    const [fy, fm] = testYm.split('-').map(Number);
    const d = deriveRecentDailyFromMonthly(train, fy!, fm!);
    const near = monthlyFromDaily(
      Math.max(d.recent30DailyAvg, d.recent90DailyAvg * 0.95),
      testYm,
    );
    const ly = seasonalNaiveMonthlyQty(train, h);
    let pred = h <= 2 ? 0.55 * near + 0.45 * ly : 0.35 * near + 0.65 * ly;
    if (risk.demandDiscount < 1) pred *= risk.demandDiscount;
    if (isLastMonthCollapsed(train)) pred = Math.max(pred, near * 0.92);
    const med6 = [...train.slice(-6)].sort((a, b) => a - b);
    const m6 = med6[Math.floor(med6.length / 2)] ?? 0;
    const last = train[train.length - 1] ?? 0;
    if (m6 > 0 && last < m6 * 0.2) pred = Math.min(pred, m6 * 0.85);
    return Math.max(0, pred);
  },
  minNearLy: (train, testYm, h) => {
    const [fy, fm] = testYm.split('-').map(Number);
    const d = deriveRecentDailyFromMonthly(train, fy!, fm!);
    const near = monthlyFromDaily(d.recent90DailyAvg, testYm);
    const ly = seasonalNaiveMonthlyQty(train, h);
    return Math.min(near, ly > 0 ? ly : near);
  },
  maxNearLy: (train, testYm, h) => {
    const [fy, fm] = testYm.split('-').map(Number);
    const d = deriveRecentDailyFromMonthly(train, fy!, fm!);
    const near = monthlyFromDaily(d.recent90DailyAvg, testYm);
    const ly = seasonalNaiveMonthlyQty(train, h);
    return Math.max(near, ly);
  },
};

const { aSkus, trainMonths, testMonths } = load();

for (const [name, fn] of Object.entries(strategies)) {
  const pairs: { pred: number; act: number }[] = [];
  for (const sku of aSkus) {
    const train = trainMonths.map((m) => sku.months[m] ?? 0);
    for (let h = 0; h < 3 && h < testMonths.length; h++) {
      const act = sku.months[testMonths[h]!] ?? 0;
      if (act <= 0) continue;
      pairs.push({ pred: fn(train, testMonths[h]!, h), act });
    }
  }
  console.log(`${name} k=1~3 WMAPE ${(wmape(pairs) * 100).toFixed(1)}% n=${pairs.length}`);
}
