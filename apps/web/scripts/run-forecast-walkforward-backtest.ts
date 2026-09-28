/**
 * 走步回测：用历史 cutoff 重跑预测，生成 2026 H1 等区间的可验证准确率数据。
 *
 * Usage:
 *   pnpm forecast:walkforward
 *   pnpm forecast:walkforward -- --as-of 2026-01-01 --months 6 --station US
 *   pnpm forecast:walkforward -- --sku-code DJ502530_2
 *   pnpm forecast:walkforward -- --algo monthly_abcd
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { runWalkForwardAccuracyBacktest } from '../server/lib/forecast-walkforward-backtest.js';
import { resolveForecastAlgoMode, type ForecastAlgoMode } from '../server/lib/forecast-algo-mode.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const asOf = readArg('--as-of') ?? '2026-01-01';
  const months = Number(readArg('--months') ?? '6');
  const station = readArg('--station') ?? 'US';
  const platform = readArg('--platform') ?? 'ALL';
  const skuCode = readArg('--sku-code');
  const versionName = readArg('--version-name');
  const tierArg = readArg('--tier');
  const algoArg = readArg('--algo');
  const replaceVersion = process.argv.includes('--replace');
  const flexBiasShadow = process.argv.includes('--flex-bias-shadow');
  const algoMode: ForecastAlgoMode = resolveForecastAlgoMode(algoArg);
  const tierFilter =
    tierArg === 'core' || tierArg === 'mid' || tierArg === 'tail' ? tierArg : tierArg === 'all' ? 'all' : undefined;
  const csvArg = readArg('--csv');
  const csvPath = csvArg
    ? resolve(ROOT, csvArg)
    : resolve(
        ROOT,
        `docs/samples/forecast-backtest/walkforward-${asOf}-${months}m${algoMode === 'monthly_abcd' ? '-abcd' : ''}${flexBiasShadow ? '-flex-shadow' : ''}.csv`,
      );

  if (!Number.isInteger(months) || months < 1 || months > 24) {
    console.error('--months must be an integer between 1 and 24');
    process.exit(1);
  }

  console.log(`走步回测 asOf=${asOf} months=${months} station=${station} platform=${platform} algo=${algoMode}`);
  if (skuCode) console.log(`单 SKU：${skuCode}`);
  if (tierFilter) console.log(`分层汇总：${tierFilter}`);
  if (replaceVersion) console.log('版本模式：--replace（purge 后复用同名版本）');
  if (flexBiasShadow) console.log('柔性窗：--flex-bias-shadow（显式启用 v2 校正，生产默认已开）');

  const result = await runWalkForwardAccuracyBacktest({
    asOf,
    monthCount: months,
    station,
    platform,
    skuCode,
    versionName,
    replaceVersion,
    exportCsvPath: csvPath,
    createReviewItems: false,
    tierFilter,
    algoMode,
    flexBiasShadow,
  });

  console.log('\n' + result.summary);
  console.log('\n版本 ID（准确率页可按草稿版本筛选）：', result.version.id);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
