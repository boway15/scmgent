/**
 * 分层阈值网格搜索 → forecast-calibration.json
 *
 * Usage:
 *   pnpm forecast:calibrate:profile
 *   pnpm forecast:calibrate:profile -- --csv apps/web/docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v6.csv --as-of 2026-01-01
 */
import { config } from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildCalibrationFeatureCache,
  expandProfileCalibrationGrid,
  formatSegmentationScoreLine,
  parseWalkforwardAccuracyRows,
  rankSegmentationScores,
  scorePersistedSegmentBaseline,
  scoreSegmentation,
} from '../server/lib/forecast-profile-calibration.js';
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
  const rows = parseWalkforwardAccuracyRows(text);
  const skuCodes = [...new Set(rows.map((r) => r.skuCode))];

  console.log(`分层标定 · ${csvPath} · asOf=${asOfStr} · ${rows.length} 行 · ${skuCodes.length} SKU`);
  const featuresBySku = await buildCalibrationFeatureCache({
    asOf,
    station,
    platform,
    skuCodes,
  });
  console.log(`DB 特征加载完成：${featuresBySku.size} SKU`);

  const baselineWmape = scorePersistedSegmentBaseline({ rows, asOf });
  console.log(`v6 persisted A:core precision WMAPE: ${baselineWmape != null ? (baselineWmape * 100).toFixed(1) + '%' : '—'}`);

  const grid = expandProfileCalibrationGrid();
  const scores = grid.map((cfg) =>
    scoreSegmentation({ rows, featuresBySku, config: cfg, asOf }),
  );
  const ranked = rankSegmentationScores(scores);
  const top10 = ranked.slice(0, 10);

  console.log('\nTop 10 分层配置:');
  top10.forEach((s, i) => console.log(formatSegmentationScoreLine(s, i + 1)));

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
    profile: best.config,
    aCore: existing.aCore,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const reportPath = outPath.replace(/\.json$/, '-profile-report.md');
  const md = [
    '# 分层标定报告',
    '',
    `- CSV: \`${csvPath}\``,
    `- asOf: ${asOfStr}`,
    `- 行数: ${rows.length}`,
    `- v6 persisted A:core precision WMAPE: ${baselineWmape != null ? (baselineWmape * 100).toFixed(1) + '%' : '—'}`,
    `- 推荐 A:core precision WMAPE: ${best.aCorePrecisionWmape != null ? (best.aCorePrecisionWmape * 100).toFixed(1) + '%' : '—'}`,
    `- A:core SKU 数: ${best.aCoreSkuCount}`,
    `- 微销量误分类占比: ${(best.misclassifiedMicroShare * 100).toFixed(1)}%`,
    '',
    '## Top 10',
    '',
    ...top10.map((s, i) => `- ${formatSegmentationScoreLine(s, i + 1)}`),
    '',
    '## 推荐 profile JSON',
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
