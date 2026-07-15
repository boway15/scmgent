/**
 * A·主力算法网格搜索（真 recent30/90 特征）→ forecast-calibration.json
 *
 * Usage:
 *   pnpm forecast:calibrate:algo
 *   pnpm forecast:calibrate:algo -- --csv apps/web/docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v6.csv
 */
import { config } from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildACoreCalibrationContextCache,
  expandACoreCalibrationGrid,
  formatACoreScoreLine,
  rankACoreCalibrationScores,
  regressionSkuDetailRows,
  scoreACoreCalibration,
} from '../server/lib/forecast-a-class-calibration.js';
import { parseWalkforwardAccuracyRows } from '../server/lib/forecast-profile-calibration.js';
import {
  DEFAULT_FORECAST_CALIBRATION_CONFIG,
  parseForecastCalibrationConfig,
  type ForecastCalibrationConfig,
} from '../server/lib/forecast-profile-config.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const csvPath =
    readArg('--csv') ??
    resolve(ROOT, 'apps/web/docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v6.csv');
  const asOfStr = readArg('--as-of') ?? '2026-01-01';
  const station = readArg('--station') ?? 'US';
  const platform = readArg('--platform') ?? 'ALL';
  const outPath =
    readArg('--out') ?? resolve(ROOT, 'apps/web/server/config/forecast-calibration.json');
  const asOf = new Date(`${asOfStr}T00:00:00.000Z`);

  const text = readFileSync(csvPath, 'utf8');
  const rows = parseWalkforwardAccuracyRows(text).filter((r) => r.profileSegment === 'A:core');
  const skuCodes = [...new Set(rows.map((r) => r.skuCode))];

  console.log(`A:core 算法标定 · ${csvPath} · ${rows.length} 行 · ${skuCodes.length} SKU`);
  const contextsBySku = await buildACoreCalibrationContextCache({
    asOf,
    station,
    platform,
    skuCodes,
  });
  console.log(`DB 上下文加载完成：${contextsBySku.size} SKU`);

  const defaultScore = scoreACoreCalibration({
    rows,
    contextsBySku,
    asOf,
    config: DEFAULT_FORECAST_CALIBRATION_CONFIG.aCore,
  });
  console.log(
    `v6 默认参数 precision WMAPE: ${defaultScore.precisionWmape != null ? (defaultScore.precisionWmape * 100).toFixed(1) + '%' : '—'}`,
  );

  const grid = expandACoreCalibrationGrid();
  const scores = grid.map((cfg) =>
    scoreACoreCalibration({ rows, contextsBySku, asOf, config: cfg }),
  );
  const ranked = rankACoreCalibrationScores(scores);
  const top10 = ranked.slice(0, 10);

  console.log('\nTop 10 算法配置:');
  top10.forEach((s, i) => console.log(formatACoreScoreLine(s, i + 1)));

  const best = ranked[0];
  if (!best) {
    console.error('无可用评分结果');
    process.exit(1);
  }

  let existing: ForecastCalibrationConfig = { ...DEFAULT_FORECAST_CALIBRATION_CONFIG };
  try {
    existing = parseForecastCalibrationConfig(JSON.parse(readFileSync(outPath, 'utf8')));
  } catch {
    // use default
  }

  const output: ForecastCalibrationConfig = {
    version: 1,
    profile: existing.profile,
    aCore: best.config,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const regressionDetails = regressionSkuDetailRows({
    rows,
    contextsBySku,
    asOf,
    config: best.config,
  }).filter((r) => r.skuCode === 'DJ502530_2');

  const reportPath = outPath.replace(/\.json$/, '-algo-report.md');
  const md = [
    '# A:core 算法标定报告',
    '',
    `- CSV: \`${csvPath}\``,
    `- asOf: ${asOfStr}`,
    `- v6 默认 precision WMAPE: ${defaultScore.precisionWmape != null ? (defaultScore.precisionWmape * 100).toFixed(1) + '%' : '—'}`,
    `- 推荐 precision WMAPE: ${best.precisionWmape != null ? (best.precisionWmape * 100).toFixed(1) + '%' : '—'}`,
    `- 回归集 precision WMAPE: ${best.regressionPrecisionWmape != null ? (best.regressionPrecisionWmape * 100).toFixed(1) + '%' : '—'}`,
    '',
    '## Top 10',
    '',
    ...top10.map((s, i) => `- ${formatACoreScoreLine(s, i + 1)}`),
    '',
    '## DJ502530_2 明细',
    '',
    ...regressionDetails.map(
      (r) =>
        `- ${r.month}: actual=${r.actualDaily.toFixed(2)} forecast=${r.forecastDaily.toFixed(2)} F/A=${r.ratio != null ? r.ratio.toFixed(2) : '—'}`,
    ),
    '',
    '## 推荐 aCore JSON',
    '',
    '```json',
    JSON.stringify(best.config, null, 2),
    '```',
    '',
  ].join('\n');
  writeFileSync(reportPath, md, 'utf8');

  console.log(`\n已写入 ${outPath}`);
  console.log(`报告 ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
