/**
 * T1~T6 分层门禁与分布（核心 KPI，外生已剔除）
 */
import { readFileSync } from 'node:fs';
import {
  getT1SubKpiTarget,
  getSalesTierKpiTarget,
  SALES_TIER_META,
  SALES_TIER_SEGMENT_META,
  T1_SUB_SEGMENT_META,
  type SalesTier,
  type SalesTierSegment,
  type T1SubSegment,
} from '../server/lib/forecast-sales-tier.js';

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

type Row = {
  sku: string;
  h: number;
  pred: number;
  act: number;
  ghost: boolean;
  kpiCore: boolean;
  t1Sub: string;
  seg: string;
  tier: string;
  exo: boolean;
};

function wmape(rows: Row[]): number | null {
  const c = rows.filter((r) => r.act > 0);
  if (!c.length) return null;
  return c.reduce((s, r) => s + Math.abs(r.pred - r.act), 0) / c.reduce((s, r) => s + r.act, 0);
}

const lines = readFileSync(PRED, 'utf8').split(/\r?\n/).filter(Boolean);
const h = parseCsvLine(lines[0]!);
const ix = (n: string) => h.indexOf(n);
const rows: Row[] = [];
for (let i = 1; i < lines.length; i++) {
  const c = parseCsvLine(lines[i]!);
  if (!c[ix('sales_tier')]?.startsWith('T')) continue;
  rows.push({
    sku: c[ix('sku')] ?? '',
    h: Number(c[ix('horizon')]),
    pred: Number(c[ix('predicted_monthly')]),
    act: Number(c[ix('actual_monthly')]),
    ghost: c[ix('ghost_row')] === '1',
    kpiCore: c[ix('kpi_core')] === '1',
    t1Sub: c[ix('t1_sub_segment')] ?? '',
    seg: c[ix('sales_segment')] ?? '',
    tier: c[ix('sales_tier')] ?? '',
    exo: c[ix('exogenous_sku')] === '1',
  });
}

const near = rows.filter((r) => r.h <= 3);
const subs = Object.keys(T1_SUB_SEGMENT_META) as T1SubSegment[];

console.log('=== T1 子层核心 KPI（外生已剔除，h≤3）===');
  for (const sub of subs.sort((a, b) => T1_SUB_SEGMENT_META[a].gateOrder - T1_SUB_SEGMENT_META[b].gateOrder)) {
  const meta = T1_SUB_SEGMENT_META[sub];
  const subNear = near.filter((r) => r.t1Sub === sub);
  const core = subNear.filter((r) => r.kpiCore);
  const ghosts = subNear.filter((r) => r.ghost);
  const target = getT1SubKpiTarget(sub, 'precision');
  const w = wmape(core);
  const status =
    target == null
      ? '—'
      : w != null && w <= target
        ? 'pass'
        : 'fail';
  console.log(
    `${meta.label}: 核心 ${w == null ? '—' : (w * 100).toFixed(1) + '%'} (目标 ${target == null ? '—' : (target * 100).toFixed(0) + '%'}) ${status} | 可比 ${core.length} | ghost ${ghosts.length}`,
  );
  if (meta.pointForecast && core.length > 0) {
    for (const hk of [1, 2, 3]) {
      const subK = core.filter((r) => r.h === hk);
      const wk = wmape(subK);
      console.log(`  k=${hk}: ${wk == null ? '—' : (wk * 100).toFixed(1) + '%'} n=${subK.length}`);
    }
  }
}

console.log('\n=== T1 全层（核心 KPI，非外生）===');
const t1Core = near.filter((r) => r.kpiCore);
console.log('核心 WMAPE', ((wmape(t1Core) ?? 0) * 100).toFixed(1) + '%', 'n=', t1Core.length);
console.log('ghost 行', near.filter((r) => r.ghost).length);

console.log('\n=== 核心池 Top10 误差 SKU（非外生，T1.1+T1.3）===');
const pool = near.filter((r) => r.kpiCore && (r.t1Sub === 'T1.1_elite_stable' || r.t1Sub === 'T1.3_anchor_stable'));
const bySku = new Map<string, { err: number; act: number; rows: Row[] }>();
for (const r of pool) {
  const agg = bySku.get(r.sku) ?? { err: 0, act: 0, rows: [] };
  agg.err += Math.abs(r.pred - r.act);
  agg.act += r.act;
  agg.rows.push(r);
  bySku.set(r.sku, agg);
}
const top = [...bySku.entries()]
  .map(([sku, v]) => ({
    sku,
    err: v.err,
    wmape: v.act > 0 ? v.err / v.act : 0,
    ghost: v.rows.filter((x) => x.ghost).length,
    sub: v.rows[0]?.t1Sub,
  }))
  .sort((a, b) => b.err - a.err)
  .slice(0, 12);
for (const t of top) {
  console.log(`  ${t.sku} (${t.sub}): absErr=${Math.round(t.err)} WMAPE=${(t.wmape * 100).toFixed(0)}% ghost=${t.ghost}`);
}

console.log('\n=== 非外生 ghost（T1.1，h≤3）===');
for (const r of near.filter((r) => r.t1Sub === 'T1.1_elite_stable' && r.ghost && !r.exo)) {
  console.log(`  ${r.sku} k=${r.h} pred=${Math.round(r.pred)}`);
}

console.log('\n=== T1 段×带（核心 KPI，外生已剔除）===');
const segments = [
  { seg: 'T1:elite', label: 'T1·主力·核心' },
  { seg: 'T1:anchor', label: 'T1·主力·标准' },
] as const;
for (const { seg, label } of segments) {
  const subRows = near.filter((r) => {
    const s = r.t1Sub;
    if (seg === 'T1:elite') return s === 'T1.1_elite_stable' || s === 'T1.2_elite_decline';
    return s === 'T1.3_anchor_stable' || s === 'T1.4_anchor_decline';
  });
  const core = subRows.filter((r) => r.kpiCore);
  const nearCore = core.filter((r) => r.h <= 3);
  const farCore = core.filter((r) => r.h >= 4);
  const nearT = seg === 'T1:elite' ? 0.2 : 0.25;
  const farT = seg === 'T1:elite' ? 0.28 : 0.32;
  const wNear = wmape(nearCore);
  const wFar = wmape(farCore);
  console.log(
    `${label} 近端(k≤3): ${wNear == null ? '—' : (wNear * 100).toFixed(1) + '%'} (目标 ${nearT * 100}%) ${wNear != null && wNear <= nearT ? 'pass' : 'fail'} | ghost ${subRows.filter((r) => r.ghost && r.h <= 3).length}`,
  );
  console.log(
    `${label} 远端(k≥4): ${wFar == null ? '—' : (wFar * 100).toFixed(1) + '%'} (目标 ${farT * 100}%) ${wFar != null && wFar <= farT ? 'pass' : 'fail'} | ghost ${subRows.filter((r) => r.ghost && r.h >= 4).length}`,
  );
}

console.log('\n=== T2/T3/T4 段级核心 KPI（h≤3，外生已剔除）===');
for (const seg of ['T2:stable', 'T3:seasonal', 'T4:intermittent'] as SalesTierSegment[]) {
  const subNear = near.filter((r) => r.seg === seg);
  const core = subNear.filter((r) => r.kpiCore);
  const target = getSalesTierKpiTarget(seg, 'precision');
  const w = wmape(core);
  const label = SALES_TIER_SEGMENT_META[seg].label;
  const status = target == null ? '—' : w != null && w <= target ? 'pass' : 'fail';
  console.log(
    `${label}: 核心 ${w == null ? '—' : (w * 100).toFixed(1) + '%'} (目标 ${target == null ? '—' : (target * 100).toFixed(0) + '%'}) ${status} | 可比 ${core.length} | ghost ${subNear.filter((r) => r.ghost).length}`,
  );
}

console.log('\n=== 可比月 WMAPE（act>0，含 ghost 月，T2/T3）===');
for (const tier of ['T2_stable', 'T3_seasonal'] as SalesTier[]) {
  const sub = near.filter((r) => r.tier === tier && r.act > 0);
  console.log(`${SALES_TIER_META[tier].label}: ${((wmape(sub) ?? 0) * 100).toFixed(1)}% n=${sub.length} ghost=${sub.filter((r) => r.ghost).length}`);
}

console.log('\n=== T1.2/T1.4 下滑层（核心 KPI）===');
for (const sub of ['T1.2_elite_decline', 'T1.4_anchor_decline'] as const) {
  const core = near.filter((r) => r.t1Sub === sub && r.kpiCore);
  console.log(`${T1_SUB_SEGMENT_META[sub].label}: ${((wmape(core) ?? 0) * 100).toFixed(1)}% n=${core.length} ghost=${near.filter((r) => r.t1Sub === sub && r.ghost).length}`);
}
