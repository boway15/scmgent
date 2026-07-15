/**
 * 走步回测 CSV：按决策窗口 (k=0~2 / k=3~5) × 销量分层统计 WMAPE，对照 15%/25% 目标。
 *
 * Usage:
 *   pnpm --filter @scm/web exec tsx scripts/analyze-walkforward-horizon-bands.ts
 *   pnpm --filter @scm/web exec tsx scripts/analyze-walkforward-horizon-bands.ts -- --csv apps/web/docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v3.csv
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyVolumeTier, type VolumeTier } from '../server/lib/forecast-eligibility.js';
import { computeWeightedMape } from '../server/lib/forecast-accuracy-tier.js';

type CsvRow = {
  skuCode: string;
  monthLabel: string;
  monthIndex: number;
  forecastDaily: number;
  actualDaily: number;
  biasRate: number | null;
  mape: number | null;
};

type HorizonBand = 'precision' | 'flex' | 'all';

const HORIZON_MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'] as const;

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function parseCsv(path: string): CsvRow[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const [header, ...data] = lines;
  if (!header?.startsWith('sku_code')) throw new Error(`unexpected header: ${header}`);

  return data.map((line) => {
    const parts = line.split(',');
    const monthLabel = parts[3] ?? '';
    const monthIndex = HORIZON_MONTHS.indexOf(monthLabel as (typeof HORIZON_MONTHS)[number]);
    return {
      skuCode: parts[0] ?? '',
      monthLabel,
      monthIndex: monthIndex >= 0 ? monthIndex : -1,
      forecastDaily: Number(parts[4]),
      actualDaily: Number(parts[5]),
      biasRate: parts[6] === '' ? null : Number(parts[6]),
      mape: parts[7] === '' ? null : Number(parts[7]),
    };
  });
}

function filterBand(rows: CsvRow[], band: HorizonBand): CsvRow[] {
  if (band === 'all') return rows;
  if (band === 'precision') return rows.filter((r) => r.monthIndex >= 0 && r.monthIndex <= 2);
  return rows.filter((r) => r.monthIndex >= 3 && r.monthIndex <= 5);
}

function weightedBias(rows: CsvRow[]): number | null {
  const comp = rows.filter((r) => r.actualDaily > 0 && r.forecastDaily > 0 && r.biasRate != null);
  if (!comp.length) return null;
  const num = comp.reduce((s, r) => s + Math.abs(r.biasRate!) * r.actualDaily, 0);
  const den = comp.reduce((s, r) => s + r.actualDaily, 0);
  return den > 0 ? num / den : null;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—';
}

function fmtPct(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx] ?? null;
}

function buildSkuTierMap(rows: CsvRow[]): Map<string, VolumeTier | 'zero'> {
  const bySku = new Map<string, { sumActual: number; months: number }>();
  for (const r of rows) {
    const agg = bySku.get(r.skuCode) ?? { sumActual: 0, months: 0 };
    agg.sumActual += r.actualDaily;
    agg.months += 1;
    bySku.set(r.skuCode, agg);
  }
  const out = new Map<string, VolumeTier | 'zero'>();
  for (const [sku, agg] of bySku) {
    const avg = agg.sumActual / agg.months;
    if (agg.sumActual <= 0) out.set(sku, 'zero');
    else out.set(sku, classifyVolumeTier(avg));
  }
  return out;
}

function analyzeFile(csvPath: string) {
  const rows = parseCsv(csvPath);
  const skuTier = buildSkuTierMap(rows);

  console.log(`\n${'='.repeat(72)}`);
  console.log(`文件: ${csvPath}`);
  console.log(`总行数: ${rows.length} | SKU 数: ${skuTier.size}`);

  const zeroSkus = [...skuTier.values()].filter((t) => t === 'zero').length;
  const coreSkus = [...skuTier.values()].filter((t) => t === 'core').length;
  console.log(`零销 SKU: ${zeroSkus} (${pct(zeroSkus, skuTier.size)}) | 主力 SKU: ${coreSkus}`);

  const bands: Array<{ band: HorizonBand; label: string; target: string }> = [
    { band: 'precision', label: '精准备货 k=0~2 (1-3月)', target: '≤15%' },
    { band: 'flex', label: '生产柔性 k=3~5 (3-6月)', target: '≤25%' },
    { band: 'all', label: '全 6 月', target: '—' },
  ];

  console.log('\n【窗口 × 全量 WMAPE】');
  for (const { band, label, target } of bands) {
    const sub = filterBand(rows, band);
    const comp = sub.filter((r) => r.actualDaily > 0);
    const wmape = computeWeightedMape(sub);
    const high15 = comp.filter((r) => r.mape != null && r.mape > 0.15).length;
    const high25 = comp.filter((r) => r.mape != null && r.mape > 0.25).length;
    console.log(
      `- ${label} | 目标 ${target} | WMAPE ${fmtPct(wmape)} | 加权|bias| ${fmtPct(weightedBias(sub))} | MAPE>15% ${pct(high15, comp.length)} | MAPE>25% ${pct(high25, comp.length)}`,
    );
  }

  console.log('\n【窗口 × 销量分层 WMAPE】');
  const tiers: Array<VolumeTier | 'zero'> = ['core', 'mid', 'tail', 'zero'];
  for (const { band, label } of bands.slice(0, 2)) {
    console.log(`\n  ${label}:`);
    for (const tier of tiers) {
      const sub = filterBand(rows, band).filter((r) => skuTier.get(r.skuCode) === tier);
      const comp = sub.filter((r) => r.actualDaily > 0);
      const wmape = computeWeightedMape(sub);
      const skuCount = new Set(sub.map((r) => r.skuCode)).size;
      console.log(
        `    ${tier.padEnd(5)} | ${skuCount} SKU | 可比 ${comp.length} 行 | WMAPE ${fmtPct(wmape)} | |bias| ${fmtPct(weightedBias(sub))}`,
      );
    }
  }

  // 主力 SKU 级 WMAPE 分布（k=0~2）
  const coreNearWmapes: number[] = [];
  const coreFarWmapes: number[] = [];
  for (const [sku, tier] of skuTier) {
    if (tier !== 'core') continue;
    const skuRows = rows.filter((r) => r.skuCode === sku);
    const near = filterBand(skuRows, 'precision');
    const far = filterBand(skuRows, 'flex');
    const nearW = computeWeightedMape(near);
    const farW = computeWeightedMape(far);
    if (nearW != null && near.some((r) => r.actualDaily > 0)) coreNearWmapes.push(nearW);
    if (farW != null && far.some((r) => r.actualDaily > 0)) coreFarWmapes.push(farW);
  }

  console.log('\n【主力 SKU 级 WMAPE 分布】');
  console.log(
    `  k=0~2: n=${coreNearWmapes.length} | P50 ${fmtPct(percentile(coreNearWmapes, 0.5))} | P75 ${fmtPct(percentile(coreNearWmapes, 0.75))} | P90 ${fmtPct(percentile(coreNearWmapes, 0.9))} | 达标≤15% ${pct(coreNearWmapes.filter((v) => v <= 0.15).length, coreNearWmapes.length)}`,
  );
  console.log(
    `  k=3~5: n=${coreFarWmapes.length} | P50 ${fmtPct(percentile(coreFarWmapes, 0.5))} | P75 ${fmtPct(percentile(coreFarWmapes, 0.75))} | P90 ${fmtPct(percentile(coreFarWmapes, 0.9))} | 达标≤25% ${pct(coreFarWmapes.filter((v) => v <= 0.25).length, coreFarWmapes.length)}`,
  );

  // 误差归因
  const nearAll = filterBand(rows, 'precision');
  const nearComp = nearAll.filter((r) => r.actualDaily > 0);
  const ghostForecast = nearAll.filter((r) => r.actualDaily === 0 && r.forecastDaily > 0).length;
  const overForecast = nearComp.filter((r) => r.biasRate != null && r.biasRate < -0.15).length;
  const underForecast = nearComp.filter((r) => r.biasRate != null && r.biasRate > 0.15).length;

  console.log('\n【k=0~2 误差归因（全量）】');
  console.log(`  零实际仍预测>0: ${ghostForecast} 行 (${pct(ghostForecast, nearAll.length)})`);
  console.log(`  可比行高估(|bias|>15%): ${overForecast} (${pct(overForecast, nearComp.length)})`);
  console.log(`  可比行低估(|bias|>15%): ${underForecast} (${pct(underForecast, nearComp.length)})`);

  // 若剔除零销 SKU，core 近月 WMAPE
  const coreNearExZero = filterBand(
    rows.filter((r) => skuTier.get(r.skuCode) !== 'zero'),
    'precision',
  ).filter((r) => skuTier.get(r.skuCode) === 'core');
  console.log('\n【情景模拟：仅主力 + 剔除零销 SKU】');
  console.log(`  k=0~2 主力 WMAPE: ${fmtPct(computeWeightedMape(coreNearExZero))}`);
  const coreFarExZero = filterBand(
    rows.filter((r) => skuTier.get(r.skuCode) !== 'zero'),
    'flex',
  ).filter((r) => skuTier.get(r.skuCode) === 'core');
  console.log(`  k=3~5 主力 WMAPE: ${fmtPct(computeWeightedMape(coreFarExZero))}`);
}

function main() {
  const ROOT = resolve(import.meta.dirname, '../../..');
  const defaultPaths = [
    resolve(ROOT, 'apps/web/docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v2.csv'),
    resolve(ROOT, 'apps/web/docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v3.csv'),
  ];
  const single = readArg('--csv');
  const paths = single ? [resolve(single)] : defaultPaths;

  console.log('走步回测决策窗口分析 | 目标: k=0~2 WMAPE≤15%, k=3~5 WMAPE≤25%');
  for (const p of paths) {
    try {
      analyzeFile(p);
    } catch (err) {
      console.error(`跳过 ${p}:`, err instanceof Error ? err.message : err);
    }
  }
}

main();
