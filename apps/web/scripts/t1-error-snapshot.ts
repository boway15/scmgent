import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const P = resolve(
  import.meta.dirname,
  '../../../docs/samples/forecast-backtest/csv-backtest-report/backtest-predictions.csv',
);

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

const lines = readFileSync(P, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines[0]!);
const ix = (name: string) => header.indexOf(name);

type Row = {
  sku: string;
  seg: string;
  h: number;
  pred: number;
  act: number;
  model: string;
  ghost: boolean;
};

const rows: Row[] = [];
for (let i = 1; i < lines.length; i++) {
  const p = parseCsvLine(lines[i]!);
  rows.push({
    sku: p[ix('sku')] ?? '',
    seg: p[ix('sales_segment')] ?? '',
    h: Number(p[ix('horizon')]),
    pred: Number(p[ix('predicted_monthly')]),
    act: Number(p[ix('actual_monthly')]),
    model: p[ix('model')] ?? '',
    ghost: p[ix('ghost_row')] === '1',
  });
}

function wmape(rs: Row[]): number {
  const ae = rs.reduce((s, r) => s + Math.abs(r.pred - r.act), 0);
  const a = rs.reduce((s, r) => s + r.act, 0);
  return a > 0 ? (ae / a) * 100 : 0;
}

const t1 = rows.filter((r) => r.seg.startsWith('T1'));
const ghost = t1.filter((r) => r.ghost);
const comp = t1.filter((r) => !r.ghost && r.act > 0);

console.log('T1 rows', t1.length, 'ghost', ghost.length, 'comparable', comp.length);
console.log('T1 WMAPE all', wmape(t1).toFixed(1) + '%', 'comparable only', wmape(comp).toFixed(1) + '%');
console.log(
  'T1 elite ghost',
  ghost.filter((r) => r.seg === 'T1:elite').length,
  'anchor',
  ghost.filter((r) => r.seg === 'T1:anchor').length,
);
console.log('ghost pred sum', ghost.reduce((s, r) => s + r.pred, 0).toFixed(0));
const lowAct = comp.filter((r) => r.act < 50);
const hiAct = comp.filter((r) => r.act >= 100);
console.log('comparable act<50', lowAct.length, 'wmape', wmape(lowAct).toFixed(1) + '%');
console.log('comparable act>=100', hiAct.length, 'wmape', wmape(hiAct).toFixed(1) + '%');
console.log('models', [...new Set(t1.map((r) => r.model))].join(','));
const h1 = t1.filter((r) => r.h <= 3);
console.log('k1-3 wmape', wmape(h1).toFixed(1) + '%', 'k1-3 comp', wmape(h1.filter((r) => !r.ghost && r.act > 0)).toFixed(1) + '%');

const ghostByModel = new Map<string, number>();
for (const r of ghost) {
  ghostByModel.set(r.model, (ghostByModel.get(r.model) ?? 0) + 1);
}
console.log('ghost by model', Object.fromEntries(ghostByModel));

const eliteNear = t1.filter((r) => r.seg === 'T1:elite' && r.h <= 3);
const anchorNear = t1.filter((r) => r.seg === 'T1:anchor' && r.h <= 3);
console.log('T1:elite k1-3', wmape(eliteNear).toFixed(1) + '%', 'comp', wmape(eliteNear.filter((r) => !r.ghost && r.act > 0)).toFixed(1) + '%');
console.log('T1:anchor k1-3', wmape(anchorNear).toFixed(1) + '%', 'comp', wmape(anchorNear.filter((r) => !r.ghost && r.act > 0)).toFixed(1) + '%');

const exLow = comp.filter((r) => r.act < 50);
const compHi = comp.filter((r) => r.act >= 50);
console.log('if exclude act<50 comp wmape', wmape(compHi).toFixed(1) + '%', 'n=', compHi.length);
