/**
 * 诊断 T1.1 ghost 行：训练特征 vs 子层/风险分类
 */
import { readFileSync } from 'node:fs';
import { extractSalesHistoryFeatures, resolveT1SubSegment } from '../server/lib/forecast-sales-tier.js';
import { evaluateAClassDemandRisk } from '../server/lib/forecast-a-risk.js';

const SALES =
  'd:/Docker/project/scm-agent/docs/samples/xiaoshou/产品销售报表-每月6a40a8dac9533e5db3fc8864.csv';
const PRED =
  'd:/Docker/project/scm-agent/docs/samples/forecast-backtest/csv-backtest-report/backtest-predictions.csv';

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

const salesText = readFileSync(SALES, 'utf8').replace(/^\uFEFF/, '');
const lines = salesText.split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines[0]!);
const months = header
  .map((h) => /^\((\d{4}-\d{2})\)$/.exec(h.trim())?.[1])
  .filter((c): c is string => c != null)
  .sort();
const train = months.slice(0, 24);
const skuTrain = new Map<string, number[]>();
for (let i = 1; i < lines.length; i++) {
  const p = parseCsvLine(lines[i]!);
  const rec: Record<string, string> = {};
  header.forEach((h, j) => {
    rec[h] = (p[j] ?? '').trim();
  });
  const sku = rec.SKU ?? '';
  if (!sku) continue;
  const series = train.map((ym) => Math.max(0, Number(rec[`(${ym})`]) || 0));
  const ex = skuTrain.get(sku);
  if (!ex) skuTrain.set(sku, series);
  else for (let j = 0; j < train.length; j++) ex[j] = (ex[j] ?? 0) + (series[j] ?? 0);
}

const predLines = readFileSync(PRED, 'utf8').split(/\r?\n/).filter(Boolean);
const ph = parseCsvLine(predLines[0]!);
const ix = (n: string) => ph.indexOf(n);

type GhostDiag = {
  sku: string;
  h: string;
  pred: number;
  collapsed: boolean;
  sub: string;
  risk: string;
  ratio: number | null;
  last2: number[];
  exo: boolean;
};

const nearGhosts: GhostDiag[] = [];
for (let i = 1; i < predLines.length; i++) {
  const c = parseCsvLine(predLines[i]!);
  if (c[ix('t1_sub_segment')] !== 'T1.1_elite_stable') continue;
  if (Number(c[ix('horizon')]) > 3) continue;
  if (c[ix('ghost_row')] !== '1') continue;
  const sku = c[ix('sku')] ?? '';
  const series = skuTrain.get(sku) ?? [];
  const f = extractSalesHistoryFeatures(series);
  const sub = resolveT1SubSegment(f);
  const risk = evaluateAClassDemandRisk(series);
  nearGhosts.push({
    sku,
    h: c[ix('horizon')] ?? '',
    pred: Number(c[ix('predicted_monthly')]),
    collapsed: f.collapsed,
    sub,
    risk: risk.tier,
    ratio: risk.last3ToPrior3Ratio,
    last2: series.slice(-2),
    exo: c[ix('exogenous_sku')] === '1',
  });
}

console.log('T1.1 near ghost (h<=3):', nearGhosts.length);
for (const g of nearGhosts) console.log(g);

// k=2/3 core under-forecast SKUs
const core = [];
for (let i = 1; i < predLines.length; i++) {
  const c = parseCsvLine(predLines[i]!);
  if (c[ix('t1_sub_segment')] !== 'T1.1_elite_stable') continue;
  if (c[ix('kpi_core')] !== '1') continue;
  const h = Number(c[ix('horizon')]);
  if (h < 2) continue;
  const pred = Number(c[ix('predicted_monthly')]);
  const act = Number(c[ix('actual_monthly')]);
  if (act <= 0) continue;
  core.push({ sku: c[ix('sku')], h, pred, act, err: Math.abs(pred - act) });
}
core.sort((a, b) => b.err - a.err);
console.log('\nTop k>=2 core errors:');
for (const r of core.slice(0, 15)) {
  const bias = ((r.pred - r.act) / r.act * 100).toFixed(0);
  console.log(r.sku, 'k=' + r.h, 'wmape-contrib err', Math.round(r.err), 'bias', bias + '%');
}

// SKU train/test pattern
import { median6MonthlyQty } from '../server/lib/forecast-monthly-abcd.js';
const salesText2 = readFileSync(SALES, 'utf8').replace(/^\uFEFF/, '');
const lines2 = salesText2.split(/\r?\n/).filter(Boolean);
const header2 = parseCsvLine(lines2[0]!);
const months2 = header2
  .map((h) => /^\((\d{4}-\d{2})\)$/.exec(h.trim())?.[1])
  .filter((c): c is string => c != null)
  .sort();
const train2 = months2.slice(0, 24);
const test2 = months2.slice(24, 29);
console.log('\nSKU patterns:');
for (const sku of ['DJ503441_2', 'DJ503441_1', 'DJ503265_2', 'DJ502954_2']) {
  let series: number[] = [];
  for (let i = 1; i < lines2.length; i++) {
    const p = parseCsvLine(lines2[i]!);
    const rec: Record<string, string> = {};
    header2.forEach((h, j) => {
      rec[h] = (p[j] ?? '').trim();
    });
    if (rec.SKU !== sku) continue;
    series = train2.map((ym) => Math.max(0, Number(rec[`(${ym})`]) || 0));
    break;
  }
  const testVals = test2.map((ym) => {
    for (let i = 1; i < lines2.length; i++) {
      const p = parseCsvLine(lines2[i]!);
      const rec: Record<string, string> = {};
      header2.forEach((h, j) => {
        rec[h] = (p[j] ?? '').trim();
      });
      if (rec.SKU === sku) return Math.max(0, Number(rec[`(${ym})`]) || 0);
    }
    return 0;
  });
  const f = extractSalesHistoryFeatures(series);
  const last = series[series.length - 1] ?? 0;
  const prev = series[series.length - 2] ?? 0;
  console.log({
    sku,
    sub: resolveT1SubSegment(f),
    q4: f.q4Boost.toFixed(2),
    last3: series.slice(-3),
    test: testVals,
    med6: median6MonthlyQty(series),
    fade: prev > 0 ? (last / prev).toFixed(2) : 'na',
    risk: evaluateAClassDemandRisk(series).tier,
  });
}
