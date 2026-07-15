/**
 * v6 vs v7 A:core 深度对比（纯 CSV，无需 DB）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeWeightedMape } from '../server/lib/forecast-accuracy-tier.js';
import { horizonMonthIndex } from '../server/lib/forecast-horizon-band.js';
import { isRegressionSku } from '../server/lib/forecast-regression-skus.js';
import { parseWalkforwardAccuracyRows } from '../server/lib/forecast-profile-calibration.js';

const root = resolve(import.meta.dirname, '..');
const v6Path = resolve(root, 'docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v6.csv');
const v7Path = resolve(root, 'docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v7.csv');
const asOf = new Date('2026-01-01T00:00:00.000Z');

function rowKey(r: { skuCode: string; forecastYear?: number; month?: number }) {
  return `${r.skuCode}|${r.forecastYear}-${String(r.month).padStart(2, '0')}`;
}

function precisionRows<T extends { forecastYear?: number; month?: number }>(rows: T[]) {
  return rows.filter((r) => horizonMonthIndex(r.forecastYear ?? 2026, r.month ?? 1, asOf) <= 2);
}

function fmt(v: number | null) {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}

const v6 = parseWalkforwardAccuracyRows(readFileSync(v6Path, 'utf8'));
const v7 = parseWalkforwardAccuracyRows(readFileSync(v7Path, 'utf8'));
const v6Map = new Map(v6.map((r) => [rowKey(r), r]));

const aCoreV7 = v7.filter((r) => r.profileSegment === 'A:core' && r.actualDaily > 0);
const aCoreV6 = v6.filter((r) => r.profileSegment === 'A:core' && r.actualDaily > 0);

console.log('=== v6 vs v7 走步对比 ===\n');
console.log(`v6 行数: ${v6.length} · v7 行数: ${v7.length}`);
console.log(`v6 A:core precision WMAPE: ${fmt(computeWeightedMape(precisionRows(aCoreV6)))}`);
console.log(`v7 A:core precision WMAPE: ${fmt(computeWeightedMape(precisionRows(aCoreV7)))}`);

let sameForecast = 0;
let diffForecast = 0;
let maxDiff = 0;
for (const r of aCoreV7) {
  const o = v6Map.get(rowKey(r));
  if (!o) continue;
  const d = Math.abs(o.forecastDaily - r.forecastDaily);
  if (d < 1e-6) sameForecast++;
  else {
    diffForecast++;
    maxDiff = Math.max(maxDiff, d);
  }
}
console.log(`\nA:core 预测: 与 v6 完全相同 ${sameForecast} 行 · 不同 ${diffForecast} 行 · 最大差 ${maxDiff.toFixed(4)}`);

const micro = aCoreV7.filter((r) => r.actualDaily < 1);
const nonMicro = aCoreV7.filter((r) => r.actualDaily >= 1);
console.log(`\n--- 微销量污染 (actual<1 却在 A:core) ---`);
console.log(`行数: ${micro.length} / ${aCoreV7.length} (${((100 * micro.length) / aCoreV7.length).toFixed(1)}%)`);
console.log(`微销量行 WMAPE: ${fmt(computeWeightedMape(micro))}`);
console.log(`非微销量行 WMAPE: ${fmt(computeWeightedMape(nonMicro))}`);
if (nonMicro.length) {
  const wAll = computeWeightedMape(aCoreV7) ?? 0;
  const wNon = computeWeightedMape(nonMicro) ?? 0;
  console.log(`若剔除微销量行，precision WMAPE 约从 ${fmt(computeWeightedMape(precisionRows(aCoreV7)))} → ${fmt(computeWeightedMape(precisionRows(nonMicro)))}`);

  const microSku = new Set(micro.map((r) => r.skuCode));
  console.log(`涉及 SKU: ${microSku.size} 个`);
}

const sumF = aCoreV7.reduce((s, r) => s + r.forecastDaily, 0);
const sumA = aCoreV7.reduce((s, r) => s + r.actualDaily, 0);
const pRows = precisionRows(aCoreV7);
const pSumF = pRows.reduce((s, r) => s + r.forecastDaily, 0);
const pSumA = pRows.reduce((s, r) => s + r.actualDaily, 0);
const over = aCoreV7.filter((r) => r.forecastDaily > r.actualDaily);
const under = aCoreV7.filter((r) => r.forecastDaily < r.actualDaily);

console.log(`\n--- 偏差方向 (v7 A:core 全部可比) ---`);
console.log(`F/A 合计: ${(sumF / sumA).toFixed(3)} · precision F/A: ${(pSumF / pSumA).toFixed(3)}`);
console.log(`过预测: ${over.length} (${((100 * over.length) / aCoreV7.length).toFixed(1)}%) · 欠预测: ${under.length}`);

const bySku = new Map<string, { err: number; act: number; n: number; sumF: number; sumA: number }>();
for (const r of precisionRows(aCoreV7)) {
  const cur = bySku.get(r.skuCode) ?? { err: 0, act: 0, n: 0, sumF: 0, sumA: 0 };
  cur.err += Math.abs(r.forecastDaily - r.actualDaily);
  cur.act += r.actualDaily;
  cur.sumF += r.forecastDaily;
  cur.sumA += r.actualDaily;
  cur.n += 1;
  bySku.set(r.skuCode, cur);
}
const top = [...bySku.entries()]
  .map(([sku, s]) => ({
    sku,
    wmape: s.act > 0 ? s.err / s.act : 0,
    fa: s.sumA > 0 ? s.sumF / s.sumA : null,
    ...s,
  }))
  .sort((a, b) => b.err - a.err)
  .slice(0, 15);

console.log('\n--- precision 段 Top15 绝对误差贡献 SKU ---');
for (const t of top) {
  const reg = isRegressionSku(t.sku) ? ' [回归]' : '';
  const fa = t.fa != null ? ` F/A=${t.fa.toFixed(2)}` : '';
  console.log(`  ${t.sku}${reg}: absErr=${t.err.toFixed(1)} WMAPE=${(t.wmape * 100).toFixed(1)}%${fa} (${t.n}月)`);
}

const dj = v7.filter((r) => r.skuCode === 'DJ502530_2');
console.log('\n--- DJ502530_2 (回归集) ---');
for (const r of dj) {
  const k = horizonMonthIndex(r.forecastYear ?? 2026, r.month ?? 1, asOf);
  const ratio = r.actualDaily > 0 ? (r.forecastDaily / r.actualDaily).toFixed(2) : '—';
  console.log(
    `  ${r.forecastYear}-${String(r.month).padStart(2, '0')} seg=${r.profileSegment} k=${k} F=${r.forecastDaily.toFixed(2)} A=${r.actualDaily.toFixed(2)} F/A=${ratio}`,
  );
}

const declining = precisionRows(aCoreV7).filter((r) => {
  const o = v6Map.get(rowKey(r));
  return o && r.forecastDaily > r.actualDaily && r.actualDaily >= 1;
});
const declineSkus = new Map<string, { sumF: number; sumA: number; n: number }>();
for (const r of declining) {
  const cur = declineSkus.get(r.skuCode) ?? { sumF: 0, sumA: 0, n: 0 };
  cur.sumF += r.forecastDaily;
  cur.sumA += r.actualDaily;
  cur.n += 1;
  declineSkus.set(r.skuCode, cur);
}
const declineOver = [...declineSkus.entries()]
  .filter(([, s]) => s.sumA > 0 && s.sumF / s.sumA > 1.2)
  .sort((a, b) => b[1].sumF - b[1].sumA - (a[1].sumF - a[1].sumA))
  .slice(0, 10);

console.log('\n--- precision 过预测 SKU (F/A>1.2) Top10 ---');
for (const [sku, s] of declineOver) {
  const reg = isRegressionSku(sku) ? ' [回归]' : '';
  console.log(`  ${sku}${reg}: F/A=${(s.sumF / s.sumA).toFixed(2)} (${s.n}月)`);
}

console.log('\n--- 结论提示 ---');
console.log('1. v7 与 v6 相同 → 当前 forecast-calibration.json 仍为 v6 默认参数，未跑网格标定');
console.log('2. 微销量误入 A:core 是 WMAPE 爆炸主因之一');
console.log('3. precision 段仍系统性过预测 (F/A>1)');
console.log('4. 下一步: Docker 内 pnpm forecast:calibrate 跑完整网格并重新走步');
