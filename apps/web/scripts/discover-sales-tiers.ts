/**
 * 从历史销量提炼分层规律：特征分布 + 各候选层 WMAPE 可达性
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifySalesTier,
  extractSalesHistoryFeatures,
  isT1Elite,
  salesTierLabel,
  type SalesTier,
} from '../server/lib/forecast-sales-tier.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const CSV = resolve(ROOT, 'docs/samples/xiaoshou/产品销售报表-每月6a40a8dac9533e5db3fc8864.csv');
const PRED = resolve(ROOT, 'docs/samples/forecast-backtest/csv-backtest-report/backtest-predictions.csv');
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

function loadSales(): { skus: Sku[]; trainMonths: string[]; testMonths: string[] } {
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
  return { skus: [...bySku.values()], trainMonths, testMonths };
}

function loadPreds(): Map<string, { h: number; pred: number; act: number }[]> {
  const text = readFileSync(PRED, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]!);
  const idx = (n: string) => header.indexOf(n);
  const map = new Map<string, { h: number; pred: number; act: number }[]>();
  for (let i = 1; i < lines.length; i++) {
    const p = parseCsvLine(lines[i]!);
    const sku = p[idx('sku')] ?? '';
    const row = { h: Number(p[idx('horizon')]), pred: Number(p[idx('predicted_monthly')]), act: Number(p[idx('actual_monthly')]) };
    const arr = map.get(sku) ?? [];
    arr.push(row);
    map.set(sku, arr);
  }
  return map;
}

type Features = {
  sku: string;
  trainSum: number;
  trainAvg: number;
  activeMonths: number;
  continuity: number;
  cv: number;
  last3Avg: number;
  prior9Avg: number;
  q4Boost: number;
  collapsed: boolean;
  valSum: number;
  valActive: number;
  isNewBurst: boolean;
};

function computeFeatures(sku: Sku, trainMonths: string[], testMonths: string[]): Features {
  const train = trainMonths.map((m) => sku.months[m] ?? 0);
  const test = testMonths.map((m) => sku.months[m] ?? 0);
  const trainSum = train.reduce((a, b) => a + b, 0);
  const trainAvg = train.length ? trainSum / train.length : 0;
  const activeMonths = train.filter((q) => q > 0).length;
  const continuity = train.length ? activeMonths / train.length : 0;
  const mean = trainAvg;
  const cv =
    mean > 0
      ? Math.sqrt(train.reduce((s, x) => s + (x - mean) ** 2, 0) / train.length) / mean
      : 999;
  const last3 = train.slice(-3);
  const prior9 = train.slice(-12, -3);
  const last3Avg = last3.reduce((a, b) => a + b, 0) / 3;
  const prior9Avg = prior9.length ? prior9.reduce((a, b) => a + b, 0) / prior9.length : 0;
  const q4Boost = prior9Avg > 0 ? last3Avg / prior9Avg : 1;
  const valSum = test.reduce((a, b) => a + b, 0);
  const valActive = test.filter((q) => q > 0).length;
  const isNewBurst = trainSum <= trainAvg * 2 && valSum > 200;
  return {
    sku: sku.sku,
    trainSum,
    trainAvg,
    activeMonths,
    continuity,
    cv,
    last3Avg,
    prior9Avg,
    q4Boost,
    collapsed: isLastMonthCollapsed(train),
    valSum,
    valActive,
    isNewBurst,
  };
}

function wmape(pairs: { pred: number; act: number }[]): number | null {
  const c = pairs.filter((p) => p.act > 0);
  if (!c.length) return null;
  return c.reduce((s, p) => s + Math.abs(p.pred - p.act), 0) / c.reduce((s, p) => s + p.act, 0);
}

const TIER_LABELS: Record<SalesTier, string> = {
  T1_anchor: salesTierLabel('T1_anchor'),
  T2_stable: salesTierLabel('T2_stable'),
  T3_seasonal: salesTierLabel('T3_seasonal'),
  T4_intermittent: salesTierLabel('T4_intermittent'),
  T5_new_or_dormant: salesTierLabel('T5_new_or_dormant'),
  T6_zero: salesTierLabel('T6_zero'),
};

const { skus, trainMonths, testMonths } = loadSales();
const preds = loadPreds();

const features = skus.map((s) => computeFeatures(s, trainMonths, testMonths));
const byTier = new Map<SalesTier, Features[]>();
for (const f of features) {
  const train = trainMonths.map((m) => skus.find((x) => x.sku === f.sku)!.months[m] ?? 0);
  const t = classifySalesTier(train, { holdoutSum: f.valSum });
  const arr = byTier.get(t) ?? [];
  arr.push(f);
  byTier.set(t, arr);
}

console.log('=== 销量规律分层（训练窗特征）===');
const totalTrain = features.reduce((s, f) => s + f.trainSum, 0);
const totalVal = features.reduce((s, f) => s + f.valSum, 0);
for (const tier of Object.keys(TIER_LABELS) as SalesTier[]) {
  const arr = byTier.get(tier) ?? [];
  const trainSales = arr.reduce((s, f) => s + f.trainSum, 0);
  const valSales = arr.reduce((s, f) => s + f.valSum, 0);
  console.log(
    `${TIER_LABELS[tier]}: SKU ${arr.length} (${((arr.length / skus.length) * 100).toFixed(1)}%) | 训练销量占比 ${((trainSales / totalTrain) * 100).toFixed(1)}% | 验证销量占比 ${((valSales / totalVal) * 100).toFixed(1)}%`,
  );
}

console.log('\n=== 各层当前模型 WMAPE（k=1~3，可比）===');
for (const tier of ['T1_anchor', 'T2_stable', 'T3_seasonal', 'T4_intermittent', 'T5_new_or_dormant'] as SalesTier[]) {
  const arr = byTier.get(tier) ?? [];
  const pairs: { pred: number; act: number }[] = [];
  for (const f of arr) {
    const rows = preds.get(f.sku) ?? [];
    for (const r of rows.filter((x) => x.h <= 3 && x.act > 0)) {
      pairs.push({ pred: r.pred, act: r.act });
    }
  }
  const w = wmape(pairs);
  const valShare = arr.reduce((s, f) => s + f.valSum, 0) / totalVal;
  console.log(
    `${tier}: WMAPE ${w == null ? '—' : (w * 100).toFixed(1) + '%'} | 可比行 ${pairs.length} | 验证销量占比 ${(valShare * 100).toFixed(1)}%`,
  );
}

console.log('\n=== T1 子切：按训练月均 ===');
const t1 = byTier.get('T1_anchor') ?? [];
for (const [label, filter] of [
  ['月均≥300', (f: Features) => f.trainAvg >= 300],
  ['月均150-300', (f: Features) => f.trainAvg >= 150 && f.trainAvg < 300],
] as const) {
  const pairs: { pred: number; act: number }[] = [];
  for (const f of t1.filter(filter)) {
    for (const r of (preds.get(f.sku) ?? []).filter((x) => x.h <= 3 && x.act > 0)) {
      pairs.push({ pred: r.pred, act: r.act });
    }
  }
  console.log(`  ${label}: SKU ${t1.filter(filter).length} WMAPE ${wmape(pairs) == null ? '—' : (wmape(pairs)! * 100).toFixed(1) + '%'}`);
}

console.log('\n=== 简单基线对比（T1，近3月均）===');
const t1pairsSn: { pred: number; act: number }[] = [];
const t1pairsR3: { pred: number; act: number }[] = [];
for (const f of t1) {
  const train = trainMonths.map((m) => skus.find((s) => s.sku === f.sku)!.months[m] ?? 0);
  const r3 = train.slice(-3).reduce((a, b) => a + b, 0) / 3;
  for (let h = 0; h < 3; h++) {
    const act = skus.find((s) => s.sku === f.sku)!.months[testMonths[h]!] ?? 0;
    if (act <= 0) continue;
    t1pairsSn.push({ pred: seasonalNaiveMonthlyQty(train, h), act });
    t1pairsR3.push({ pred: r3, act });
  }
}
console.log(`  seasonal_naive: ${(wmape(t1pairsSn)! * 100).toFixed(1)}%`);
console.log(`  recent3avg: ${(wmape(t1pairsR3)! * 100).toFixed(1)}%`);

console.log('\n=== T1* 精炼层（主攻目标）===');
function evalTierFilter(name: string, filter: (f: Features) => boolean) {
  const matched = features.filter(filter);
  const pairs: { pred: number; act: number }[] = [];
  for (const f of matched) {
    for (const r of (preds.get(f.sku) ?? []).filter((x) => x.h <= 3 && x.act > 0)) {
      pairs.push({ pred: r.pred, act: r.act });
    }
  }
  const w = wmape(pairs);
  const valSales = matched.reduce((s, f) => s + f.valSum, 0);
  console.log(
    `  ${name}: SKU ${matched.length} | WMAPE ${w == null ? '—' : (w * 100).toFixed(1) + '%'} | 可比 ${pairs.length} | 验证销量 ${((valSales / totalVal) * 100).toFixed(1)}%`,
  );
}

evalTierFilter('T1* 连续≥85% 月均≥200 CV<0.8', (f) =>
  isT1Elite(f) && f.cv < 0.8 && !f.isNewBurst,
);
evalTierFilter('T1* 连续≥90% 月均≥150', (f) =>
  f.continuity >= 0.9 && f.trainAvg >= 150 && f.trainSum > 0 && !f.isNewBurst,
);
evalTierFilter('主攻层 T1* + 验证月销≥100', (f) => {
  if (!isT1Elite(f)) return false;
  const rows = preds.get(f.sku) ?? [];
  return rows.some((r) => r.h === 1 && r.act >= 100);
});
