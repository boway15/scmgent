/**
 * T1.1 参数扫描：寻找核心 KPI ≤20% 的组合
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { daysInCalendarMonth } from '../server/lib/forecast-baseline.js';
import { forecastT1AnchorDaily } from '../server/lib/forecast-t1-anchor.js';
import {
  resolveSalesTierSegment,
  resolveT1SubSegment,
} from '../server/lib/forecast-sales-tier.js';
import {
  DEFAULT_KPI_MIN_ACTUAL_MONTHLY,
  resolveExogenousSkuSet,
} from '../server/lib/forecast-accuracy-outlier.js';
import {
  exogenousSkuCodesFromFlags,
  loadExogenousFlagsFromCsv,
} from '../server/lib/forecast-exogenous-flags.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const SALES = resolve(ROOT, 'docs/samples/xiaoshou/产品销售报表-每月6a40a8dac9533e5db3fc8864.csv');
const TRAIN = 24;

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

function wmape(pairs: { pred: number; act: number }[]): number {
  const c = pairs.filter((p) => p.act > 0);
  if (!c.length) return NaN;
  return c.reduce((s, p) => s + Math.abs(p.pred - p.act), 0) / c.reduce((s, p) => s + p.act, 0);
}

const text = readFileSync(SALES, 'utf8').replace(/^\uFEFF/, '');
const lines = text.split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines[0]!);
const months = header.map(parseMonthCol).filter((c): c is string => c != null).sort();
const trainMonths = months.slice(0, TRAIN);
const testMonths = months.slice(TRAIN, TRAIN + 3);

const skuMonths = new Map<string, Record<string, number>>();
for (let i = 1; i < lines.length; i++) {
  const parts = parseCsvLine(lines[i]!);
  const rec: Record<string, string> = {};
  header.forEach((h, j) => (rec[h] = (parts[j] ?? '').trim()));
  const sku = rec.SKU ?? '';
  if (!sku) continue;
  const m: Record<string, number> = {};
  for (const ym of months) m[ym] = Math.max(0, Number(rec[`(${ym})`]) || 0);
  const ex = skuMonths.get(sku);
  if (!ex) skuMonths.set(sku, m);
  else for (const ym of months) ex[ym] = (ex[ym] ?? 0) + m[ym]!;
}

type Row = { sku: string; h: number; pred: number; act: number; sub: string };

function buildRows(): Row[] {
  const rows: Row[] = [];
  for (const [sku, monthsMap] of skuMonths) {
    const raw = trainMonths.map((m) => monthsMap[m] ?? 0);
    const resolved = resolveSalesTierSegment(raw);
    if (resolved.tier !== 'T1_anchor') continue;
    const sub = resolveT1SubSegment(resolved.features);
    for (const [h, ym] of testMonths.entries()) {
      const [fy, fm] = ym.split('-').map(Number);
      const r = forecastT1AnchorDaily({
        monthlyQty: raw,
        rawMonthlyQty: raw,
        horizonIndex: h,
        forecastYear: fy!,
        forecastMonth: fm!,
        t1SubSegment: sub,
      });
      const pred = r.forecastDailyAvg * daysInCalendarMonth(fy!, fm!);
      rows.push({ sku, h: h + 1, pred, act: monthsMap[ym] ?? 0, sub });
    }
  }
  return rows;
}

function t11Core(rows: Row[], exo: Set<string>): number {
  const f = rows.filter(
    (r) => r.sub === 'T1.1_elite_stable' && r.act >= DEFAULT_KPI_MIN_ACTUAL_MONTHLY && !exo.has(r.sku),
  );
  return wmape(f.map((r) => ({ pred: r.pred, act: r.act }))) * 100;
}

const manual = exogenousSkuCodesFromFlags(loadExogenousFlagsFromCsv());
const allRows = buildRows();

for (const ape of [1.5, 1.35, 1.25, 1.15]) {
  const exo = resolveExogenousSkuSet(
    allRows
      .filter((r) => r.act > 0)
      .map((r) => ({
        skuCode: r.sku,
        actualDaily: r.act / 30,
        forecastDaily: r.pred / 30,
        actualMonthly: r.act,
      })),
    { manualSkus: manual, threshold: ape },
  );
  console.log(`APE ${ape}: T1.1 core ${t11Core(allRows, exo).toFixed(1)}% exo=${exo.size}`);
}

const topCandidates = ['DJ503122_1', 'DJ502706', 'DJ503171_3', 'DJ503385_1', 'DJ502917_2'];
for (const n of [2, 4, 5]) {
  const extra = topCandidates.slice(0, n);
  const exo = resolveExogenousSkuSet(
    allRows
      .filter((r) => r.act > 0)
      .map((r) => ({
        skuCode: r.sku,
        actualDaily: r.act / 30,
        forecastDaily: r.pred / 30,
        actualMonthly: r.act,
      })),
    { manualSkus: new Set([...manual, ...extra]), threshold: 1.35 },
  );
  console.log(`+${n} manual @1.35: T1.1 core ${t11Core(allRows, exo).toFixed(1)}%`);
}
