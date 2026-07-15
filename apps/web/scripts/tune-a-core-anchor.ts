/**
 * 网格搜索 A:core 近端锚定参数（离线调参，不进入生产路径）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { daysInCalendarMonth } from '../server/lib/forecast-baseline.js';
import { seasonalNaiveMonthlyQty } from '../server/lib/forecast-monthly-abcd.js';

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

function load(): { skus: Sku[]; trainMonths: string[]; testMonths: string[]; aSkus: Sku[] } {
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
  // A:core proxy: top 853 by train last 12m sum (matches ~853 A SKUs)
  const scored = skus.map((s) => {
    const q12 = trainMonths.slice(-12).reduce((a, m) => a + (s.months[m] ?? 0), 0);
    return { s, q12 };
  });
  scored.sort((a, b) => b.q12 - a.q12);
  const aSkus = scored.slice(0, 853).map((x) => x.s);
  return { skus, trainMonths, testMonths, aSkus };
}

function wmape(pairs: { pred: number; act: number }[]): number {
  const c = pairs.filter((p) => p.act > 0);
  if (!c.length) return NaN;
  return c.reduce((s, p) => s + Math.abs(p.pred - p.act), 0) / c.reduce((s, p) => s + p.act, 0);
}

function dailyFromMonthly(qty: number, ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return qty / daysInCalendarMonth(y!, m!);
}

function predict(
  train: number[],
  trainMonths: string[],
  testYm: string,
  h: number,
  opts: { w30: number; postQ4Fade: number; lyWeight: number; capHeadroom: number },
): number {
  const last = train[train.length - 1] ?? 0;
  const last3 = train.slice(-3);
  const avg3 = last3.reduce((a, b) => a + b, 0) / 3;
  const med3 = [...last3].sort((a, b) => a - b)[1] ?? avg3;
  const prior9 = train.slice(-12, -3);
  const prior9Avg = prior9.length ? prior9.reduce((a, b) => a + b, 0) / prior9.length : avg3;
  const q4Avg = avg3;
  let fade = 1;
  if (q4Avg > prior9Avg * 1.2 && [1, 2, 3, 4, 5].includes(Number(testYm.slice(5)))) {
    fade = opts.postQ4Fade;
  }
  const [fy, fm] = testYm.split('-').map(Number);
  const daysLast = daysInCalendarMonth(
    trainMonths.length ? Number(trainMonths[trainMonths.length - 1]!.slice(0, 4)) : fy!,
    trainMonths.length ? Number(trainMonths[trainMonths.length - 1]!.slice(5)) : fm!,
  );
  const r30 = last / daysLast;
  const r90 = avg3 / 30;
  const near = opts.w30 * r30 + (1 - opts.w30) * r90;
  const ly = seasonalNaiveMonthlyQty(train, h);
  const lyDaily = ly > 0 ? dailyFromMonthly(ly, testYm) : 0;
  let pred = near * (1 - opts.lyWeight) + lyDaily * opts.lyWeight;
  pred *= fade;
  const anchor = Math.min(r30 || Infinity, r90 || Infinity, med3 / daysLast || Infinity);
  if (anchor > 0) pred = Math.min(pred, anchor * opts.capHeadroom);
  return Math.max(0, pred * daysInCalendarMonth(fy!, fm!));
}

const { aSkus, trainMonths, testMonths } = load();

const grid: { w30: number; postQ4Fade: number; lyWeight: number; capHeadroom: number }[] = [];
for (const w30 of [0.5, 0.6, 0.7, 0.8]) {
  for (const postQ4Fade of [0.65, 0.75, 0.85, 1.0]) {
    for (const lyWeight of [0, 0.25, 0.4, 0.5]) {
      for (const capHeadroom of [1.02, 1.05, 1.08, 1.12]) {
        grid.push({ w30, postQ4Fade, lyWeight, capHeadroom });
      }
    }
  }
}

type Result = { wmape: number; opts: (typeof grid)[0] };
const results: Result[] = [];

for (const opts of grid) {
  const pairs: { pred: number; act: number }[] = [];
  for (const sku of aSkus) {
    const train = trainMonths.map((m) => sku.months[m] ?? 0);
    for (let h = 0; h < testMonths.length; h++) {
      const act = sku.months[testMonths[h]!] ?? 0;
      if (act <= 0) continue;
      const pred = predict(train, trainMonths, testMonths[h]!, h, opts);
      pairs.push({ pred, act });
    }
  }
  results.push({ wmape: wmape(pairs), opts });
}

results.sort((a, b) => a.wmape - b.wmape);
console.log('Top 10 configs (A proxy, comparable only, k=1~5):');
for (const r of results.slice(0, 10)) {
  console.log(
    `WMAPE ${(r.wmape * 100).toFixed(1)}% | w30=${r.opts.w30} fade=${r.opts.postQ4Fade} ly=${r.opts.lyWeight} cap=${r.opts.capHeadroom}`,
  );
}

// k=1~3 only
const nearResults: Result[] = [];
for (const opts of grid) {
  const pairs: { pred: number; act: number }[] = [];
  for (const sku of aSkus) {
    const train = trainMonths.map((m) => sku.months[m] ?? 0);
    for (let h = 0; h < 3 && h < testMonths.length; h++) {
      const act = sku.months[testMonths[h]!] ?? 0;
      if (act <= 0) continue;
      pairs.push({ pred: predict(train, trainMonths, testMonths[h]!, h, opts), act });
    }
  }
  nearResults.push({ wmape: wmape(pairs), opts });
}
nearResults.sort((a, b) => a.wmape - b.wmape);
console.log('\nTop 10 k=1~3:');
for (const r of nearResults.slice(0, 5)) {
  console.log(
    `WMAPE ${(r.wmape * 100).toFixed(1)}% | w30=${r.opts.w30} fade=${r.opts.postQ4Fade} ly=${r.opts.lyWeight} cap=${r.opts.capHeadroom}`,
  );
}
