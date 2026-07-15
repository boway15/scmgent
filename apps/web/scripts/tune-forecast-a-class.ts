/**
 * A·主力近月锚定权重网格搜索（固定回归集）
 *
 * Usage:
 *   pnpm --filter @scm/web exec tsx scripts/tune-forecast-a-class.ts -- --csv walkforward.csv
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeAClassForecast } from '../server/lib/forecast-baseline.js';
import { computeWeightedMape, type AccuracyRowInput } from '../server/lib/forecast-accuracy-tier.js';
import { FORECAST_REGRESSION_SKUS } from '../server/lib/forecast-regression-skus.js';
import { horizonMonthIndex } from '../server/lib/forecast-horizon-band.js';

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function parseCsv(path: string): AccuracyRowInput[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const [header, ...data] = lines;
  if (!header?.startsWith('sku_code')) throw new Error(`unexpected header: ${header}`);

  return data.map((line) => {
    const parts = line.split(',');
    const monthLabel = parts[3] ?? '';
    const match = /^(\d{4})-(\d{2})$/.exec(monthLabel);
    return {
      skuCode: parts[0] ?? '',
      actualDaily: Number(parts[5]),
      forecastDaily: Number(parts[4]),
      biasRate: null,
      mape: null,
      forecastYear: match ? Number(match[1]) : 2026,
      month: match ? Number(match[2]) : 1,
      profileSegment: parts[8] || undefined,
    };
  });
}

function main() {
  const csv =
    readArg('--csv') ??
    resolve('apps/web/docs/samples/forecast-backtest/walkforward-2026-01-01-6m.csv');
  const asOfStr = readArg('--as-of') ?? '2026-01-01';
  const asOf = new Date(`${asOfStr}T00:00:00.000Z`);

  const rows = parseCsv(csv).filter(
    (r) =>
      r.profileSegment === 'A:core' &&
      (FORECAST_REGRESSION_SKUS as readonly string[]).includes(r.skuCode),
  );

  if (!rows.length) {
    console.log('无 A:core 回归集行，跳过调参');
    return;
  }

  const weightGrid = [
    { k0: [0.75, 0.25], k1: [0.6, 0.4] },
    { k0: [0.7, 0.3], k1: [0.55, 0.45] },
    { k0: [0.8, 0.2], k1: [0.65, 0.35] },
  ];

  let best: { wmape: number; label: string } | null = null;

  for (const weights of weightGrid) {
    const simulated = rows.map((row) => {
      const k = horizonMonthIndex(row.forecastYear!, row.month!, asOf);
      const recent30 = row.actualDaily * 1.05;
      const recent90 = row.actualDaily;
      const forecast =
        computeAClassForecast({
          recent30DailyAvg: recent30,
          recent90DailyAvg: recent90,
          lastYearSameMonthDailyAvg: recent90,
          yoyAnchorDailyAvg: recent90,
          horizonMonthIndex: k,
          seasonalityFactor: 1,
          trendFactor: 1,
          structuralLevel: recent90,
          wNear: weights.k1[1]!,
          wYoy: weights.k1[0]!,
        }) ?? row.forecastDaily;
      return { ...row, forecastDaily: forecast };
    });

    const precision = simulated.filter(
      (r) => horizonMonthIndex(r.forecastYear!, r.month!, asOf) <= 2,
    );
    const flex = simulated.filter((r) => {
      const k = horizonMonthIndex(r.forecastYear!, r.month!, asOf);
      return k >= 3 && k <= 5;
    });
    const precisionWmape = computeWeightedMape(precision);
    const flexWmape = computeWeightedMape(flex);
    const label = `k0=${weights.k0.join('/')}, k1=${weights.k1.join('/')}`;
    console.log(
      `${label} · precision WMAPE=${precisionWmape != null ? (precisionWmape * 100).toFixed(1) : '—'}% · flex=${flexWmape != null ? (flexWmape * 100).toFixed(1) : '—'}%`,
    );
    if (precisionWmape != null && (flexWmape == null || flexWmape <= 0.25)) {
      if (!best || precisionWmape < best.wmape) {
        best = { wmape: precisionWmape, label };
      }
    }
  }

  if (best) {
    console.log(`\n推荐权重：${best.label}（precision WMAPE ${(best.wmape * 100).toFixed(1)}%）`);
  }
}

main();
