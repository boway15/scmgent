/**
 * 回测误差诊断：定位模型薄弱环节
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyForecastProfile,
  type ProfileClass,
} from '../server/lib/forecast-profile-class.js';
import {
  seasonalNaiveMonthlyQty,
  trendForecastMonthlyQty,
  median6MonthlyQty,
} from '../server/lib/forecast-monthly-abcd.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const CSV = resolve(ROOT, 'docs/samples/xiaoshou/产品销售报表-每月6a40a8dac9533e5db3fc8864.csv');
const PRED = resolve(ROOT, 'docs/samples/forecast-backtest/csv-backtest-report/backtest-predictions.csv');

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === ',' && !q) {
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

type SkuRow = { sku: string; category: string; months: Record<string, number> };

function loadSales(): { rows: SkuRow[]; months: string[] } {
  const text = readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0]!);
  const months = header.map((c) => parseMonthCol(c)).filter((c): c is string => c != null).sort();
  const bySku = new Map<string, SkuRow>();
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]!);
    const rec: Record<string, string> = {};
    header.forEach((h, j) => (rec[h] = (parts[j] ?? '').trim()));
    const sku = rec.SKU ?? '';
    if (!sku) continue;
    const m: Record<string, number> = {};
    for (const ym of months) m[ym] = Math.max(0, Number(rec[`(${ym})`]) || 0);
    const ex = bySku.get(sku);
    if (!ex) bySku.set(sku, { sku, category: rec['品类'] ?? '', months: m });
    else for (const ym of months) ex.months[ym] = (ex.months[ym] ?? 0) + m[ym]!;
  }
  return { rows: [...bySku.values()], months };
}

type Pred = { sku: string; cls: ProfileClass; ym: string; h: number; pred: number; act: number };

function loadPreds(): Pred[] {
  const text = readFileSync(PRED, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]!);
  const idx = (name: string) => header.indexOf(name);
  const out: Pred[] = [];
  for (let i = 1; i < lines.length; i++) {
    const p = parseCsvLine(lines[i]!);
    out.push({
      sku: p[idx('sku')] ?? '',
      cls: (p[idx('profile_class')] ?? 'A') as ProfileClass,
      ym: p[idx('year_month')] ?? '',
      h: Number(p[idx('horizon')]),
      pred: Number(p[idx('predicted_monthly')]),
      act: Number(p[idx('actual_monthly')]),
    });
  }
  return out;
}

function wmape(rows: { pred: number; act: number }[]): number | null {
  const c = rows.filter((r) => r.act > 0);
  if (!c.length) return null;
  return c.reduce((s, r) => s + Math.abs(r.pred - r.act), 0) / c.reduce((s, r) => s + r.act, 0);
}

function bias(rows: { pred: number; act: number }[]): number | null {
  const c = rows.filter((r) => r.act > 0);
  if (!c.length) return null;
  const tp = c.reduce((s, r) => s + r.pred, 0);
  const ta = c.reduce((s, r) => s + r.act, 0);
  return ta > 0 ? (tp - ta) / ta : null;
}

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`;
}

const TRAIN = 24;
const { rows, months: allMonths } = loadSales();
const trainMonths = allMonths.slice(0, TRAIN);
const testMonths = allMonths.slice(TRAIN, TRAIN + 5);
const classifyMonths = trainMonths.slice(-12);
const preds = loadPreds();

console.log('========== 1. 偏差方向（可比样本）==========');
for (const cls of ['A', 'B', 'C', 'D', 'ALL'] as const) {
  const sub = preds.filter((r) => (cls === 'ALL' || r.cls === cls) && r.act > 0);
  console.log(`${cls}: bias ${pct(bias(sub))} | WMAPE ${pct(wmape(sub))} | n=${sub.length}`);
}

console.log('\n========== 2. 按提前期 k ==========');
for (let h = 1; h <= 5; h++) {
  const sub = preds.filter((r) => r.h === h && r.act > 0);
  console.log(`k=${h} (${testMonths[h - 1]}): WMAPE ${pct(wmape(sub))} bias ${pct(bias(sub))}`);
}

console.log('\n========== 3. A类：Holt-Winters vs seasonal_naive 对比 ==========');
const aSkus = rows.filter((r) => {
  const q = classifyMonths.map((m) => r.months[m] ?? 0);
  return classifyForecastProfile(q) === 'A';
});

type AltRow = { pred: number; act: number };
const hwRows: AltRow[] = [];
const snRows: AltRow[] = [];
const recent3Rows: AltRow[] = [];

for (const sku of aSkus) {
  const train = trainMonths.map((m) => sku.months[m] ?? 0);
  for (let h = 0; h < testMonths.length; h++) {
    const act = sku.months[testMonths[h]!] ?? 0;
    if (act <= 0) continue;
    const hw = preds.find((p) => p.sku === sku.sku && p.h === h + 1)?.pred ?? 0;
    const sn = seasonalNaiveMonthlyQty(train, h);
    const r3 = train.slice(-3).reduce((a, b) => a + b, 0) / 3;
    hwRows.push({ pred: hw, act });
    snRows.push({ pred: sn, act });
    recent3Rows.push({ pred: r3, act });
  }
}
console.log(`Holt-Winters(当前): WMAPE ${pct(wmape(hwRows))}`);
console.log(`seasonal_naive(生产): WMAPE ${pct(wmape(snRows))}`);
console.log(`近3月均(基线):     WMAPE ${pct(wmape(recent3Rows))}`);

console.log('\n========== 4. A类主力 SKU 误差结构 ==========');
const aCorePreds = preds.filter((r) => {
  if (r.cls !== 'A' || r.act <= 0) return false;
  const avg = testMonths.reduce((s, m) => s + (rows.find((x) => x.sku === r.sku)?.months[m] ?? 0), 0) / testMonths.length;
  return avg >= 150;
});
const over = aCorePreds.filter((r) => r.pred > r.act * 1.15);
const under = aCorePreds.filter((r) => r.pred < r.act * 0.85);
console.log(`主力 A 可比样本 ${aCorePreds.length}: 高估>${15}% ${over.length} | 低估<${15}% ${under.length}`);
console.log(`高估 WMAPE ${pct(wmape(over))} | 低估 WMAPE ${pct(wmape(under))}`);

console.log('\n========== 5. 训练期末趋势 vs 验证期反弹 ==========');
const trainEnd = trainMonths.slice(-3);
const testQ1 = testMonths.slice(0, 3);
let trainEndSum = 0;
let testQ1Sum = 0;
for (const r of rows) {
  trainEndSum += trainEnd.reduce((s, m) => s + (r.months[m] ?? 0), 0);
  testQ1Sum += testQ1.reduce((s, m) => s + (r.months[m] ?? 0), 0);
}
console.log(`训练末3月总销 ${trainEndSum.toLocaleString()}`);
console.log(`验证前3月总销 ${testQ1Sum.toLocaleString()} (+${(((testQ1Sum - trainEndSum) / trainEndSum) * 100).toFixed(1)}%)`);

const aTrainEnd = aSkus.reduce((s, r) => s + trainEnd.reduce((a, m) => a + (r.months[m] ?? 0), 0), 0);
const aTestQ1 = aSkus.reduce((s, r) => s + testQ1.reduce((a, m) => a + (r.months[m] ?? 0), 0), 0);
console.log(`A类 训练末3月 ${aTrainEnd.toLocaleString()} → 验证前3月 ${aTestQ1.toLocaleString()} (+${(((aTestQ1 - aTrainEnd) / aTrainEnd) * 100).toFixed(1)}%)`);

console.log('\n========== 6. 异常月对 A 类的影响（剔除大促/缺货月重训）=========');
function cleanTrain(train: number[]): number[] {
  const mean = train.reduce((a, b) => a + b, 0) / train.length;
  const std = Math.sqrt(train.reduce((s, x) => s + (x - mean) ** 2, 0) / train.length);
  return train.map((q) => {
    if (q === 0 || (mean > 0 && q < mean * 0.2)) return mean; // 缺货填均值
    if (q > mean + 2 * std) return mean + std; // 大促压顶
    return q;
  });
}
const cleanedSn: AltRow[] = [];
const rawSn: AltRow[] = [];
for (const sku of aSkus) {
  const raw = trainMonths.map((m) => sku.months[m] ?? 0);
  const cleaned = cleanTrain(raw);
  for (let h = 0; h < testMonths.length; h++) {
    const act = sku.months[testMonths[h]!] ?? 0;
    if (act <= 0) continue;
    rawSn.push({ pred: seasonalNaiveMonthlyQty(raw, h), act });
    cleanedSn.push({ pred: seasonalNaiveMonthlyQty(cleaned, h), act });
  }
}
console.log(`seasonal_naive 原始:  WMAPE ${pct(wmape(rawSn))}`);
console.log(`seasonal_naive 清洗后: WMAPE ${pct(wmape(cleanedSn))}`);

console.log('\n========== 7. C/D 类：零销预测 vs 有销实际 ==========');
for (const cls of ['C', 'D'] as ProfileClass[]) {
  const sub = preds.filter((r) => r.cls === cls);
  const falsePos = sub.filter((r) => r.act === 0 && r.pred > 0);
  const hit = sub.filter((r) => r.act > 0);
  console.log(
    `${cls}: 总预测行 ${sub.length} | 零销误报(预测>0实际=0) ${falsePos.length} (${((falsePos.length / sub.length) * 100).toFixed(1)}%) | 有销可比 ${hit.length}`,
  );
  console.log(`  误报贡献额外误差 ${falsePos.reduce((s, r) => s + r.pred, 0).toFixed(0)} 件（未进 WMAPE 但影响备货）`);
}

console.log('\n========== 8. 销量分层 WMAPE ==========');
const avgActBySku = new Map<string, number>();
for (const r of preds) {
  const cur = avgActBySku.get(r.sku) ?? 0;
  avgActBySku.set(r.sku, cur + r.act);
}
for (const [sku, sum] of avgActBySku) avgActBySku.set(sku, sum / testMonths.length);

for (const [label, min, max] of [
  ['主力 ≥150/月', 150, Infinity],
  ['腰部 30-150', 30, 150],
  ['长尾 <30', 0, 30],
] as const) {
  const skuSet = new Set([...avgActBySku.entries()].filter(([, a]) => a >= min && a < max).map(([s]) => s));
  const sub = preds.filter((r) => skuSet.has(r.sku) && r.act > 0);
  console.log(`${label}: WMAPE ${pct(wmape(sub))} | SKU ${skuSet.size} | 可比 ${sub.length}`);
}

console.log('\n========== 9. 2025同期 vs 2026验证（季节锚定潜力）==========');
const yoyRows: AltRow[] = [];
const modelRows: AltRow[] = [];
for (const sku of aSkus) {
  for (let h = 0; h < testMonths.length; h++) {
    const ym = testMonths[h]!;
    const [y, m] = ym.split('-').map(Number);
    const yoyKey = `${y - 1}-${String(m).padStart(2, '0')}`;
    const act = sku.months[ym] ?? 0;
    if (act <= 0) continue;
    const yoy = sku.months[yoyKey] ?? 0;
    const model = preds.find((p) => p.sku === sku.sku && p.ym === ym)?.pred ?? 0;
    yoyRows.push({ pred: yoy, act });
    modelRows.push({ pred: model, act });
  }
}
console.log(`A类 YoY 锚定(去年同月): WMAPE ${pct(wmape(yoyRows))}`);
console.log(`A类 当前模型:          WMAPE ${pct(wmape(modelRows))}`);

console.log('\n========== 10. D类 median_6m vs 零预测 ==========');
const dSkus = rows.filter((r) => classifyForecastProfile(classifyMonths.map((m) => r.months[m] ?? 0)) === 'D');
const medRows: AltRow[] = [];
const zeroRows: AltRow[] = [];
for (const sku of dSkus) {
  const train = trainMonths.map((m) => sku.months[m] ?? 0);
  const med = median6MonthlyQty(train);
  for (const ym of testMonths) {
    const act = sku.months[ym] ?? 0;
    if (act <= 0) continue;
    medRows.push({ pred: med, act });
    zeroRows.push({ pred: 0, act });
  }
}
console.log(`median_6m: WMAPE ${pct(wmape(medRows))}`);
console.log(`零预测:    WMAPE ${pct(wmape(zeroRows))} (有销时=100%)`);
