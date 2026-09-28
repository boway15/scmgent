/**
 * 走步回测：T 层 × 预测距离 k 柔性窗偏差归因（规划口径，含 T4B/T99）。
 *
 * Usage:
 *   pnpm forecast:walkforward:flex-attribution
 *   pnpm forecast:walkforward:flex-attribution -- --csv docs/samples/forecast-backtest/walkforward-2026-01-01-6m.csv
 *   pnpm forecast:walkforward:flex-attribution -- --csv walkforward.csv --as-of 2026-01-01
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { horizonMonthIndex } from '../server/lib/forecast-horizon-band.js';
import {
  buildTierHorizonAttribution,
  formatTierHorizonAttributionTable,
  parseHorizonDiscountProduct,
  type FlexBiasAttributionRow,
} from '../server/lib/forecast-flex-bias-attribution.js';
import { parseWalkForwardAsOf } from '../server/lib/forecast-walkforward-backtest.js';

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function parseMonthLabel(label: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(label.trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

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
    levelDaily: indexOf('level_daily'),
    anchorDaily: indexOf('anchor_daily'),
    seasonalDaily: indexOf('seasonal_daily'),
  };

  return data
    .map((line) => {
      const parts = line.split(',');
      const monthLabel = parts[idx.monthLabel] ?? '';
      const monthParts = parseMonthLabel(monthLabel);
      const forecastDaily = Number(parts[idx.forecastDaily]);
      const actualDaily = Number(parts[idx.actualDaily]);
      if (!monthParts || !Number.isFinite(forecastDaily) || !Number.isFinite(actualDaily)) {
        return null;
      }

      const horizonIndexRaw = idx.horizonIndex >= 0 ? Number(parts[idx.horizonIndex]) : NaN;
      const horizonIndex = Number.isFinite(horizonIndexRaw)
        ? horizonIndexRaw
        : horizonMonthIndex(monthParts.year, monthParts.month, asOf);

      const discountRaw = idx.discountProduct >= 0 ? Number(parts[idx.discountProduct]) : NaN;
      const horizonFactors =
        Number.isFinite(discountRaw) ||
        (idx.levelDaily >= 0 && parts[idx.levelDaily]) ||
        (idx.anchorDaily >= 0 && parts[idx.anchorDaily])
          ? {
              conservativeFactor: undefined,
              monthFactor: undefined,
              effectiveTrendDecay: undefined,
              levelDaily: idx.levelDaily >= 0 ? Number(parts[idx.levelDaily]) : undefined,
              anchorDaily: idx.anchorDaily >= 0 ? Number(parts[idx.anchorDaily]) : undefined,
              seasonalDaily: idx.seasonalDaily >= 0 ? Number(parts[idx.seasonalDaily]) : undefined,
              discountProduct: Number.isFinite(discountRaw) ? discountRaw : undefined,
            }
          : undefined;

      const parsedDiscount =
        horizonFactors && 'discountProduct' in horizonFactors && horizonFactors.discountProduct != null
          ? horizonFactors.discountProduct
          : parseHorizonDiscountProduct(horizonFactors);

      return {
        profileSegment: parts[idx.profileSegment] ?? 'unclassified',
        horizonIndex,
        forecastDaily,
        actualDaily,
        horizonFactors:
          parsedDiscount != null
            ? {
                ...(horizonFactors ?? {}),
                conservativeFactor: parsedDiscount,
                monthFactor: 1,
                effectiveTrendDecay: 1,
              }
            : horizonFactors,
      } satisfies FlexBiasAttributionRow;
    })
    .filter((row): row is FlexBiasAttributionRow => row != null);
}

function main() {
  const defaultCsv = resolve('docs/samples/forecast-backtest/walkforward-2026-01-01-6m.csv');
  const csvPath = resolve(readArg('--csv') ?? defaultCsv);
  const asOf = parseWalkForwardAsOf(readArg('--as-of') ?? '2026-01-01');
  const rows = parseCsv(csvPath, asOf);
  const summary = buildTierHorizonAttribution(rows);

  console.log(`柔性窗偏差归因：${csvPath}`);
  console.log(`总行数：${rows.length} · asOf=${asOf.toISOString().slice(0, 10)}`);
  console.log('');
  for (const line of formatTierHorizonAttributionTable(summary)) {
    console.log(line);
  }
}

main();
