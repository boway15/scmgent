/**
 * 对比 baseline vs flex-shadow 走步 CSV 的柔性窗归因。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { horizonMonthIndex } from '../server/lib/forecast-horizon-band.js';
import {
  buildTierHorizonAttribution,
  formatSignedPct,
  formatTierHorizonAttributionTable,
  parseHorizonDiscountProduct,
  type FlexBiasAttributionRow,
} from '../server/lib/forecast-flex-bias-attribution.js';
import { parseWalkForwardAsOf } from '../server/lib/forecast-walkforward-backtest.js';

const ROOT = resolve(import.meta.dirname, '../../..');

function parseCsv(path: string, asOf: Date): FlexBiasAttributionRow[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
  const [headerLine, ...data] = lines;
  if (!headerLine?.startsWith('sku_code')) {
    throw new Error(`unexpected header: ${headerLine ?? '(empty)'}`);
  }
  const headers = headerLine.split(',');
  const indexOf = (name: string) => headers.indexOf(name);
  const idx = {
    monthLabel: indexOf('month_label'),
    forecastDaily: indexOf('forecast_daily_avg'),
    actualDaily: indexOf('actual_daily_avg'),
    profileSegment: indexOf('profile_segment'),
    horizonIndex: indexOf('horizon_index'),
    discountProduct: indexOf('discount_product'),
    flexBiasCorrection: indexOf('flex_bias_correction'),
  };

  return data.map((line) => {
    const parts = line.split(',');
    const monthLabel = parts[idx.monthLabel] ?? '';
    const match = /^(\d{4})-(\d{2})$/.exec(monthLabel.trim());
    if (!match) return null;
    const forecastDaily = Number(parts[idx.forecastDaily]);
    const actualDaily = Number(parts[idx.actualDaily]);
    if (!Number.isFinite(forecastDaily) || !Number.isFinite(actualDaily)) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const horizonIndexRaw = idx.horizonIndex >= 0 ? Number(parts[idx.horizonIndex]) : NaN;
    const horizonIndex = Number.isFinite(horizonIndexRaw)
      ? horizonIndexRaw
      : horizonMonthIndex(year, month, asOf);

    const flexRaw = idx.flexBiasCorrection >= 0 ? Number(parts[idx.flexBiasCorrection]) : NaN;
    const discountRaw = idx.discountProduct >= 0 ? Number(parts[idx.discountProduct]) : NaN;
    const horizonFactors = {
      conservativeFactor: Number.isFinite(discountRaw) ? discountRaw : undefined,
      monthFactor: 1,
      effectiveTrendDecay: 1,
      flexBiasCorrection: Number.isFinite(flexRaw) ? flexRaw : undefined,
    };

    return {
      profileSegment: parts[idx.profileSegment] ?? 'unclassified',
      horizonIndex,
      forecastDaily,
      actualDaily,
      horizonFactors,
    } satisfies FlexBiasAttributionRow;
  }).filter((row): row is FlexBiasAttributionRow => row != null);
}

function planningFlexBias(rows: FlexBiasAttributionRow[], tier: string): number | null {
  const sub = rows.filter(
    (row) =>
      row.profileSegment === tier &&
      row.horizonIndex >= 3 &&
      row.horizonIndex <= 5 &&
      row.actualDaily > 0 &&
      row.forecastDaily > 0,
  );
  if (!sub.length) return null;
  const err = sub.reduce((sum, row) => sum + (row.forecastDaily - row.actualDaily), 0);
  const act = sub.reduce((sum, row) => sum + row.actualDaily, 0);
  return act > 0 ? err / act : null;
}

function main() {
  const asOf = parseWalkForwardAsOf('2026-01-01');
  const baselinePath = resolve(ROOT, 'docs/samples/forecast-backtest/walkforward-2026-01-01-6m-baseline.csv');
  const shadowArg = process.argv.find((arg) => arg.startsWith('--shadow='))?.slice('--shadow='.length);
  const shadowPath = resolve(
    ROOT,
    shadowArg ?? 'docs/samples/forecast-backtest/walkforward-2026-01-01-6m-flex-shadow.csv',
  );

  const baselineRows = parseCsv(baselinePath, asOf);
  const shadowRows = parseCsv(shadowPath, asOf);
  const baseline = buildTierHorizonAttribution(baselineRows);
  const shadow = buildTierHorizonAttribution(shadowRows);

  console.log('=== Baseline vs Flex-Shadow 柔性窗对比 ===');
  console.log(`Baseline 行数：${baselineRows.length} · Shadow 行数：${shadowRows.length}`);
  console.log('');
  console.log(
    [
      '指标',
      'Baseline',
      'Flex-Shadow',
      'Δ',
    ].join('\t'),
  );
  console.log(
    [
      '柔性窗整体偏差',
      formatSignedPct(baseline.flexWeightedBias),
      formatSignedPct(shadow.flexWeightedBias),
      formatSignedPct(
        baseline.flexWeightedBias != null && shadow.flexWeightedBias != null
          ? shadow.flexWeightedBias - baseline.flexWeightedBias
          : null,
      ),
    ].join('\t'),
  );
  console.log(
    [
      '近端 k≤2 偏差',
      formatSignedPct(baseline.precisionWeightedBias),
      formatSignedPct(shadow.precisionWeightedBias),
      formatSignedPct(
        baseline.precisionWeightedBias != null && shadow.precisionWeightedBias != null
          ? shadow.precisionWeightedBias - baseline.precisionWeightedBias
          : null,
      ),
    ].join('\t'),
  );
  console.log('');
  console.log('=== 规划口径 · 各 T 层柔性窗偏差（含 T4B/T99，actual>0）===');
  console.log(['T层', 'Baseline', 'Shadow', 'Δ'].join('\t'));
  for (const tier of ['T1', 'T2', 'T3', 'T4A', 'T4B', 'T99']) {
    const wb = planningFlexBias(baselineRows, tier);
    const ws = planningFlexBias(shadowRows, tier);
    console.log(
      [
        tier,
        formatSignedPct(wb),
        formatSignedPct(ws),
        formatSignedPct(wb != null && ws != null ? ws - wb : null),
      ].join('\t'),
    );
  }
  console.log('');

  const tailTiers = ['T4A', 'T4B', 'T99'];
  console.log('=== T4A/T4B/T99 · k=3–5 格子对比 ===');
  console.log(['T层', 'k', 'Baseline偏差', 'Shadow偏差', 'Δ', 'Shadow校正系数中位'].join('\t'));
  for (const tier of tailTiers) {
    for (let k = 3; k <= 5; k += 1) {
      const b = baseline.cells.find((cell) => cell.tier === tier && cell.horizonIndex === k);
      const s = shadow.cells.find((cell) => cell.tier === tier && cell.horizonIndex === k);
      if (!b && !s) continue;
      const delta =
        b?.weightedBias != null && s?.weightedBias != null
          ? s.weightedBias - b.weightedBias
          : null;
      console.log(
        [
          tier,
          k,
          formatSignedPct(b?.weightedBias ?? null),
          formatSignedPct(s?.weightedBias ?? null),
          formatSignedPct(delta),
          s?.discountProductMedian != null ? s.discountProductMedian.toFixed(2) : '—',
        ].join('\t'),
      );
    }
  }

  console.log('');
  console.log('=== Baseline 归因表 ===');
  for (const line of formatTierHorizonAttributionTable(baseline)) console.log(line);
  console.log('');
  console.log('=== Flex-Shadow 归因表 ===');
  for (const line of formatTierHorizonAttributionTable(shadow)) console.log(line);
}

main();
