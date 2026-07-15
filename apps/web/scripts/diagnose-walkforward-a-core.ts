/**
 * A:core 走步对比诊断：v3 vs v5 共同 SKU、偏差方向、子档漂移
 *
 * Usage:
 *   pnpm --filter @scm/web exec tsx scripts/diagnose-walkforward-a-core.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { horizonMonthIndex } from '../server/lib/forecast-horizon-band.js';
import { isRegressionSku } from '../server/lib/forecast-regression-skus.js';

type Row = {
  skuCode: string;
  monthLabel: string;
  forecastYear: number;
  month: number;
  forecast: number;
  actual: number;
  segment?: string;
  biasRate: number | null;
};

function parseCsv(path: string, hasSegment: boolean): Row[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const [, ...data] = lines;
  return data.map((line) => {
    const p = line.split(',');
    const monthLabel = p[3] ?? '';
    const m = /^(\d{4})-(\d{2})$/.exec(monthLabel);
    const forecast = Number(p[4]);
    const actual = Number(p[5]);
    const bias = p[6] === '' ? null : Number(p[6]);
    return {
      skuCode: p[0] ?? '',
      monthLabel,
      forecastYear: m ? Number(m[1]) : 2026,
      month: m ? Number(m[2]) : 1,
      forecast,
      actual,
      segment: hasSegment ? p[8] || undefined : undefined,
      biasRate: bias,
    };
  });
}

function wmape(rows: Row[]): number | null {
  const comp = rows.filter((r) => r.actual > 0);
  if (!comp.length) return null;
  const err = comp.reduce((s, r) => s + Math.abs(r.forecast - r.actual), 0);
  const act = comp.reduce((s, r) => s + r.actual, 0);
  return act > 0 ? err / act : null;
}

function key(r: Row) {
  return `${r.skuCode}|${r.monthLabel}`;
}

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function main() {
  const root = resolve(import.meta.dirname, '..');
  const v3Path = resolve(root, 'docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v3.csv');
  const v5Path = resolve(root, 'docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v5.csv');
  const v6Path = resolve(root, 'docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v6.csv');
  const targetPath = readArg('--csv') ? resolve(process.cwd(), readArg('--csv')!) : v6Path;
  const asOf = new Date('2026-01-01T00:00:00.000Z');

  const v3 = parseCsv(v3Path, false);
  const v5 = parseCsv(v5Path, true);
  const current = parseCsv(targetPath, true);
  const currentLabel = targetPath.includes('v6') ? 'v6' : targetPath.includes('v5') ? 'v5' : 'csv';
  const v3Map = new Map(v3.map((r) => [key(r), r]));

  const common = current.filter((r) => v3Map.has(key(r)));
  const aCore = common.filter((r) => r.segment === 'A:core' && r.actual > 0);
  const precision = aCore.filter(
    (r) => horizonMonthIndex(r.forecastYear, r.month, asOf) <= 2,
  );
  const flex = aCore.filter((r) => {
    const k = horizonMonthIndex(r.forecastYear, r.month, asOf);
    return k >= 3 && k <= 5;
  });

  const under = aCore.filter((r) => r.forecast < r.actual);
  const over = aCore.filter((r) => r.forecast > r.actual);
  const sumForecast = aCore.reduce((s, r) => s + r.forecast, 0);
  const sumActual = aCore.reduce((s, r) => s + r.actual, 0);

  console.log(`=== A:core 诊断（${currentLabel} persisted，共同 SKU 集）===\n`);
  console.log(`共同行数：${common.length}`);
  console.log(`A:core 可比行：${aCore.length}`);
  console.log(`precision 可比：${precision.length} · WMAPE ${fmt(wmape(precision))}`);
  console.log(`flex 可比：${flex.length} · WMAPE ${fmt(wmape(flex))}`);
  console.log(`forecast/actual 合计比：${(sumForecast / sumActual).toFixed(3)}`);
  console.log(`欠预测行：${under.length} (${pct(under.length, aCore.length)})`);
  console.log(`过预测行：${over.length} (${pct(over.length, aCore.length)})`);

  const paired = aCore
    .map((rCur) => {
      const r3 = v3Map.get(key(rCur))!;
      const r5 = v5.find((r) => key(r) === key(rCur));
      return {
        ...rCur,
        v3Forecast: r3.forecast,
        v5Forecast: r5?.forecast,
        deltaVsV3: rCur.forecast - r3.forecast,
        v3Mape: r3.actual > 0 ? Math.abs(r3.forecast - r3.actual) / r3.actual : null,
        curMape: Math.abs(rCur.forecast - rCur.actual) / rCur.actual,
      };
    })
    .filter((r) => r.actual > 0);

  const v3WmapeOnAcore = wmape(paired.map((r) => ({ ...r, forecast: r.v3Forecast })));
  const curWmape = wmape(paired);
  const v5WmapeOnAcore = wmape(
    paired.filter((r) => r.v5Forecast != null).map((r) => ({ ...r, forecast: r.v5Forecast! })),
  );

  console.log('\n--- 同 SKU×月：v3 / v5 / 当前 预测（A:core 可比）---');
  console.log(`v3 WMAPE：${fmt(v3WmapeOnAcore)}`);
  console.log(`v5 WMAPE：${fmt(v5WmapeOnAcore)}`);
  console.log(`${currentLabel} WMAPE：${fmt(curWmape)}`);

  const aCoreSkus = new Set(aCore.map((r) => r.skuCode));
  const segmentCounts = new Map<string, number>();
  for (const r of common) {
    if (!aCoreSkus.has(r.skuCode)) continue;
    const seg = r.segment ?? '?';
    segmentCounts.set(seg, (segmentCounts.get(seg) ?? 0) + 1);
  }
  console.log(`\n--- ${currentLabel} 标为 A:core 的 SKU 行 segment 分布 ---`);
  for (const [seg, n] of [...segmentCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${seg}: ${n}`);
  }

  // Top 20 误差 SKU
  const bySku = new Map<string, { err: number; act: number; n: number }>();
  for (const r of aCore) {
    const cur = bySku.get(r.skuCode) ?? { err: 0, act: 0, n: 0 };
    cur.err += Math.abs(r.forecast - r.actual);
    cur.act += r.actual;
    cur.n += 1;
    bySku.set(r.skuCode, cur);
  }
  const top = [...bySku.entries()]
    .map(([sku, s]) => ({ sku, wmape: s.act > 0 ? s.err / s.act : 0, ...s }))
    .sort((a, b) => b.wmape - a.wmape)
    .slice(0, 15);

  console.log('\n--- A:core Top15 WMAPE SKU ---');
  for (const t of top) {
    const reg = isRegressionSku(t.sku) ? ' [回归集]' : '';
    console.log(`  ${t.sku}${reg}: WMAPE ${(t.wmape * 100).toFixed(1)}% (${t.n} 月)`);
  }

  // precision 段欠/过预测
  const pUnder = precision.filter((r) => r.forecast < r.actual);
  const pOver = precision.filter((r) => r.forecast > r.actual);
  const pSumF = precision.reduce((s, r) => s + r.forecast, 0);
  const pSumA = precision.reduce((s, r) => s + r.actual, 0);
  console.log('\n--- A:core precision 段 ---');
  console.log(`F/A=${(pSumF / pSumA).toFixed(3)} · 欠预测 ${pUnder.length} · 过预测 ${pOver.length}`);

  // 若 v3 全量按 tier 算是 core 的 SKU（用 v3 预测+actual 估 volume）
  const v3SkuAvg = new Map<string, number[]>();
  for (const r of v3) {
    if (r.actual <= 0) continue;
    const list = v3SkuAvg.get(r.skuCode) ?? [];
    list.push(r.actual);
    v3SkuAvg.set(r.skuCode, list);
  }
  let driftNote = 0;
  for (const sku of aCoreSkus) {
    const avgs = v3SkuAvg.get(sku);
    if (!avgs?.length) continue;
    const avg = avgs.reduce((s, x) => s + x, 0) / avgs.length;
    if (avg < 5) driftNote++;
  }
  console.log(`\n--- 漂移提示：${currentLabel} A:core SKU 中目标期日均<5 的有 ${driftNote} 个 ---`);
}

function fmt(v: number | null) {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}
function pct(n: number, d: number) {
  return d > 0 ? `${((100 * n) / d).toFixed(1)}%` : '—';
}

main();
