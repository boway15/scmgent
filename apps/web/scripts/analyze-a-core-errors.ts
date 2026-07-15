/**
 * A:core 误差分解（可比样本 / ghost / 高估低估）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PRED = resolve(
  import.meta.dirname,
  '../../../docs/samples/forecast-backtest/csv-backtest-report/backtest-predictions.csv',
);

type Row = {
  sku: string;
  seg: string;
  h: number;
  pred: number;
  act: number;
  model: string;
  ghost: boolean;
};

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

function load(): Row[] {
  const lines = readFileSync(PRED, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]!);
  const idx = (name: string) => header.indexOf(name);
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const p = parseCsvLine(lines[i]!);
    out.push({
      sku: p[idx('sku')] ?? '',
      seg: p[idx('profile_segment')] ?? '',
      h: Number(p[idx('horizon')]),
      pred: Number(p[idx('predicted_monthly')]),
      act: Number(p[idx('actual_monthly')]),
      model: p[idx('model')] ?? '',
      ghost: p[idx('ghost_row')] === '1',
    });
  }
  return out;
}

function wmape(rows: Row[]): number | null {
  const c = rows.filter((r) => r.act > 0);
  if (!c.length) return null;
  const err = c.reduce((s, r) => s + Math.abs(r.pred - r.act), 0);
  const act = c.reduce((s, r) => s + r.act, 0);
  return act > 0 ? err / act : null;
}

function bias(rows: Row[]): number | null {
  const c = rows.filter((r) => r.act > 0);
  if (!c.length) return null;
  const tp = c.reduce((s, r) => s + r.pred, 0);
  const ta = c.reduce((s, r) => s + r.act, 0);
  return ta > 0 ? (tp - ta) / ta : null;
}

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`;
}

const rows = load();
const aCore = rows.filter((r) => r.seg === 'A:core');
const near = aCore.filter((r) => r.h >= 1 && r.h <= 3);
const far = aCore.filter((r) => r.h >= 4 && r.h <= 6);

console.log('=== A:core 总体 ===');
console.log(`行数 ${aCore.length} | ghost ${aCore.filter((r) => r.ghost).length}`);
console.log(`k=1~3 WMAPE ${pct(wmape(near))} bias ${pct(bias(near))} comparable ${near.filter((r) => r.act > 0).length}`);
console.log(`k=4~6 WMAPE ${pct(wmape(far))} bias ${pct(bias(far))} comparable ${far.filter((r) => r.act > 0).length}`);

console.log('\n=== 按 model ===');
for (const model of [...new Set(aCore.map((r) => r.model))].sort()) {
  const sub = aCore.filter((r) => r.model === model);
  console.log(`${model}: n=${sub.length} ghost=${sub.filter((r) => r.ghost).length} WMAPE ${pct(wmape(sub))} bias ${pct(bias(sub))}`);
}

console.log('\n=== k=1~3 可比：高估/低估 ===');
const comp = near.filter((r) => r.act > 0);
const over = comp.filter((r) => r.pred > r.act * 1.15);
const under = comp.filter((r) => r.pred < r.act * 0.85);
const ok = comp.filter((r) => r.pred >= r.act * 0.85 && r.pred <= r.act * 1.15);
console.log(`可比 ${comp.length} | 高估>15% ${over.length} WMAPE ${pct(wmape(over))}`);
console.log(`低估<-15% ${under.length} WMAPE ${pct(wmape(under))}`);
console.log(`±15%内 ${ok.length} WMAPE ${pct(wmape(ok))}`);

console.log('\n=== ghost 贡献（k=1~3）===');
const ghosts = near.filter((r) => r.ghost);
const ghostPred = ghosts.reduce((s, r) => s + r.pred, 0);
console.log(`ghost 行 ${ghosts.length} | 多预测 ${Math.round(ghostPred)} 件`);

console.log('\n=== Top 10 高估 SKU (k=1, 可比) ===');
const k1 = comp.filter((r) => r.h === 1);
k1.sort((a, b) => (b.pred - b.act) / b.act - (a.pred - a.act) / a.act);
for (const r of k1.filter((r) => r.pred > r.act).slice(0, 10)) {
  console.log(`${r.sku}: pred=${Math.round(r.pred)} act=${Math.round(r.act)} bias=${pct((r.pred - r.act) / r.act)} model=${r.model}`);
}

console.log('\n=== Top 10 低估 SKU (k=1, 可比) ===');
k1.sort((a, b) => (a.pred - a.act) / a.act - (b.pred - b.act) / b.act);
for (const r of k1.filter((r) => r.pred < r.act).slice(0, 10)) {
  console.log(`${r.sku}: pred=${Math.round(r.pred)} act=${Math.round(r.act)} bias=${pct((r.pred - r.act) / r.act)} model=${r.model}`);
}
