/**
 * T1~T6 分层：SKU 数量与训练销量分布（含 T1 子层）
 * Usage: pnpm --filter @scm/web exec tsx scripts/sales-tier-distribution.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveSalesTierSegment,
  resolveT1SubSegment,
  SALES_TIER_META,
  T1_SUB_SEGMENT_META,
  type SalesTier,
  type T1SubSegment,
} from '../server/lib/forecast-sales-tier.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const DEFAULT_CSV = resolve(
  ROOT,
  'docs/samples/xiaoshou/产品销售报表-每月6a40a8dac9533e5db3fc8864.csv',
);
const TRAIN_MONTHS = 24;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
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

function loadSkus(path: string) {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0]!);
  const months = header
    .map((c) => parseMonthCol(c))
    .filter((c): c is string => c != null)
    .sort();
  const train = months.slice(0, TRAIN_MONTHS);
  const test = months.slice(TRAIN_MONTHS, TRAIN_MONTHS + 6);
  const bySku = new Map<string, { train: number[]; test: number; category: string }>();

  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]!);
    const rec: Record<string, string> = {};
    header.forEach((h, j) => {
      rec[h] = (parts[j] ?? '').trim();
    });
    const sku = rec.SKU ?? '';
    if (!sku) continue;
    const trainQty = train.map((ym) => Math.max(0, Number(rec[`(${ym})`]) || 0));
    const testSum = test.reduce((s, ym) => s + Math.max(0, Number(rec[`(${ym})`]) || 0), 0);
    const ex = bySku.get(sku);
    if (!ex) {
      bySku.set(sku, { train: trainQty, test: testSum, category: rec['品类'] ?? '' });
    } else {
      for (let j = 0; j < train.length; j++) ex.train[j] = (ex.train[j] ?? 0) + (trainQty[j] ?? 0);
      ex.test += testSum;
    }
  }
  return { skus: bySku, trainMonths: train, testMonths: test };
}

function pct(n: number, total: number): string {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—';
}

function bucket(trainSum: number): string {
  if (trainSum === 0) return '0';
  if (trainSum < 200) return '<200';
  if (trainSum < 1000) return '200~1k';
  if (trainSum < 5000) return '1k~5k';
  if (trainSum < 20000) return '5k~2w';
  return '≥2w';
}

const csvPath = process.argv.includes('--csv')
  ? process.argv[process.argv.indexOf('--csv') + 1]!
  : DEFAULT_CSV;
const { skus, trainMonths, testMonths } = loadSkus(csvPath);

let totalTrain = 0;
let totalTest = 0;
const tierStats = new Map<SalesTier, { sku: number; train: number; test: number }>();
const t1SubStats = new Map<T1SubSegment, { sku: number; train: number }>();
const tierBuckets = new Map<SalesTier, Map<string, number>>();

for (const [, v] of skus) {
  const trainSum = v.train.reduce((a, b) => a + b, 0);
  totalTrain += trainSum;
  totalTest += v.test;
  const holdoutSum = v.test;
  const { tier, features } = resolveSalesTierSegment(v.train, { holdoutSum });
  const agg = tierStats.get(tier) ?? { sku: 0, train: 0, test: 0 };
  agg.sku += 1;
  agg.train += trainSum;
  agg.test += v.test;
  tierStats.set(tier, agg);
  const b = bucket(trainSum);
  const bm = tierBuckets.get(tier) ?? new Map<string, number>();
  bm.set(b, (bm.get(b) ?? 0) + 1);
  tierBuckets.set(tier, bm);
  if (tier === 'T1_anchor') {
    const sub = resolveT1SubSegment(features);
    const sa = t1SubStats.get(sub) ?? { sku: 0, train: 0 };
    sa.sku += 1;
    sa.train += trainSum;
    t1SubStats.set(sub, sa);
  }
}

const totalSku = skus.size;
console.log('=== 训练窗', trainMonths[0], '~', trainMonths[trainMonths.length - 1], `(${TRAIN_MONTHS}月) ===`);
console.log('SKU 总数:', totalSku, '| 训练总销量:', totalTrain.toLocaleString(), '| 验证总销量:', totalTest.toLocaleString());
console.log('\n=== T1~T6 分层分布 ===');
console.log('层级'.padEnd(14), 'SKU数'.padStart(6), '占比'.padStart(7), '训练销量'.padStart(12), '训练占比'.padStart(8), '验证销量'.padStart(12), '验证占比'.padStart(8), '户均训练'.padStart(10));
const tiers = (Object.keys(SALES_TIER_META) as SalesTier[]).filter((t) => tierStats.has(t));
for (const tier of tiers) {
  const s = tierStats.get(tier)!;
  const avg = s.sku > 0 ? Math.round(s.train / s.sku) : 0;
  console.log(
    SALES_TIER_META[tier].label.padEnd(14),
    String(s.sku).padStart(6),
    pct(s.sku, totalSku).padStart(7),
    s.train.toLocaleString().padStart(12),
    pct(s.train, totalTrain).padStart(8),
    s.test.toLocaleString().padStart(12),
    pct(s.test, totalTest).padStart(8),
    String(avg).padStart(10),
  );
}

console.log('\n=== T1 子层分布（训练销量）===');
const t1Total = tierStats.get('T1_anchor')?.train ?? 1;
for (const sub of (Object.keys(T1_SUB_SEGMENT_META) as T1SubSegment[]).sort(
  (a, b) => T1_SUB_SEGMENT_META[a].gateOrder - T1_SUB_SEGMENT_META[b].gateOrder,
)) {
  const s = t1SubStats.get(sub);
  if (!s) continue;
  console.log(
    `${T1_SUB_SEGMENT_META[sub].label}: ${s.sku} SKU (${pct(s.sku, tierStats.get('T1_anchor')?.sku ?? 1)}) | 训练 ${s.train.toLocaleString()} (${pct(s.train, t1Total)}) | 户均 ${Math.round(s.train / s.sku)}`,
  );
}

console.log('\n=== 各层训练销量档位（SKU 数）===');
const bucketOrder = ['0', '<200', '200~1k', '1k~5k', '5k~2w', '≥2w'];
for (const tier of tiers) {
  const bm = tierBuckets.get(tier);
  if (!bm) continue;
  const parts = bucketOrder.map((b) => `${b}:${bm.get(b) ?? 0}`).join('  ');
  console.log(`${SALES_TIER_META[tier].label}: ${parts}`);
}
