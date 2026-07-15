/**
 * 串联分层 + 算法标定，输出对比报告（离线重算 WMAPE）
 *
 * Usage:
 *   pnpm forecast:calibrate
 *   pnpm forecast:calibrate -- --skip-grid  # 仅报告当前 JSON
 */
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildACoreCalibrationContextCache,
  regressionSkuDetailRows,
  scoreACoreCalibration,
} from '../server/lib/forecast-a-class-calibration.js';
import {
  buildCalibrationFeatureCache,
  buildSegmentMapFromFeatures,
  computeSegmentDrift,
  parseWalkforwardAccuracyRows,
  scorePersistedSegmentBaseline,
  scoreSegmentation,
} from '../server/lib/forecast-profile-calibration.js';
import {
  DEFAULT_FORECAST_CALIBRATION_CONFIG,
  loadForecastCalibration,
} from '../server/lib/forecast-profile-config.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function runScript(script: string, extraArgs: string[] = []): void {
  const result = spawnSync(
    'pnpm',
    ['--filter', '@scm/web', 'exec', 'tsx', `scripts/${script}`, '--', ...extraArgs],
    { cwd: ROOT, stdio: 'inherit', shell: true },
  );
  if (result.status !== 0) {
    throw new Error(`${script} exited with code ${result.status ?? 1}`);
  }
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
  const skipGrid = process.argv.includes('--skip-grid');
  const asOf = new Date(`${asOfStr}T00:00:00.000Z`);

  const passArgs = [
    '--csv',
    csvPath,
    '--as-of',
    asOfStr,
    '--station',
    station,
    '--platform',
    platform,
    '--out',
    outPath,
  ];

  if (!skipGrid) {
    console.log('=== Phase 1: 分层标定 ===');
    runScript('calibrate-forecast-profile.ts', passArgs);
    console.log('\n=== Phase 2: 算法标定 ===');
    runScript('calibrate-forecast-a-class.ts', passArgs);
  }

  const calibration = loadForecastCalibration();
  const text = readFileSync(csvPath, 'utf8');
  const rows = parseWalkforwardAccuracyRows(text);
  const skuCodes = [...new Set(rows.map((r) => r.skuCode))];

  const featuresBySku = await buildCalibrationFeatureCache({
    asOf,
    station,
    platform,
    skuCodes,
  });
  const contextsBySku = await buildACoreCalibrationContextCache({
    asOf,
    station,
    platform,
    skuCodes.filter((c) =>
      rows.some((r) => r.skuCode === c && r.profileSegment === 'A:core'),
    ),
  });

  const baselineWmape = scorePersistedSegmentBaseline({ rows, asOf });
  const defaultProfileScore = scoreSegmentation({
    rows,
    featuresBySku,
    config: DEFAULT_FORECAST_CALIBRATION_CONFIG.profile,
    asOf,
  });
  const recommendedProfileScore = scoreSegmentation({
    rows,
    featuresBySku,
    config: calibration.profile,
    asOf,
  });

  const recommendedSegmentBySku = buildSegmentMapFromFeatures(
    featuresBySku,
    calibration.profile,
    asOf,
  );

  const defaultAlgoScore = scoreACoreCalibration({
    rows,
    contextsBySku,
    asOf,
    config: DEFAULT_FORECAST_CALIBRATION_CONFIG.aCore,
    segmentFilter: (r) => recommendedSegmentBySku.get(r.skuCode) === 'A:core',
  });

  const recommendedAlgoScore = scoreACoreCalibration({
    rows,
    contextsBySku,
    asOf,
    config: calibration.aCore,
    segmentFilter: (r) => recommendedSegmentBySku.get(r.skuCode) === 'A:core',
  });

  const beforeSeg = buildSegmentMapFromFeatures(
    featuresBySku,
    DEFAULT_FORECAST_CALIBRATION_CONFIG.profile,
    asOf,
  );
  const afterSeg = buildSegmentMapFromFeatures(featuresBySku, calibration.profile, asOf);
  const drift = computeSegmentDrift(beforeSeg, afterSeg);

  const regressionDetails = regressionSkuDetailRows({
    rows,
    contextsBySku,
    asOf,
    config: calibration.aCore,
  }).filter((r) => r.skuCode === 'DJ502530_2');

  const reportPath = outPath.replace(/\.json$/, '-full-report.md');
  const fmt = (v: number | null) => (v != null ? `${(v * 100).toFixed(1)}%` : '—');

  const md = [
    '# 走步标定汇总报告',
    '',
    `- CSV: \`${csvPath}\``,
    `- asOf: ${asOfStr}`,
    `- 配置: \`${outPath}\``,
    '',
    '## WMAPE 对比（离线重算）',
    '',
    '| 阶段 | A:core precision WMAPE |',
    '|------|------------------------|',
    `| v6 persisted segment | ${fmt(baselineWmape)} |`,
    `| 默认 profile 重分层 | ${fmt(defaultProfileScore.aCorePrecisionWmape)} |`,
    `| 推荐 profile 重分层 | ${fmt(recommendedProfileScore.aCorePrecisionWmape)} |`,
    `| 推荐 profile + 默认 algo | ${fmt(defaultAlgoScore.precisionWmape)} |`,
    `| 推荐 profile + 推荐 algo | ${fmt(recommendedAlgoScore.precisionWmape)} |`,
    '',
    '## 分层漂移',
    '',
    `- A:core → A:mid: ${drift.fromCoreToMid.length} SKU`,
    `- A:mid → A:core: ${drift.fromMidToCore.length} SKU`,
    drift.fromCoreToMid.length
      ? `- 示例: ${drift.fromCoreToMid.slice(0, 10).join(', ')}`
      : '',
    '',
    '## DJ502530_2 回归明细',
    '',
    ...regressionDetails.map(
      (r) =>
        `- ${r.month}: actual=${r.actualDaily.toFixed(2)} forecast=${r.forecastDaily.toFixed(2)} F/A=${r.ratio != null ? r.ratio.toFixed(2) : '—'}`,
    ),
    '',
    '## 当前 JSON',
    '',
    '```json',
    JSON.stringify(calibration, null, 2),
    '```',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  writeFileSync(reportPath, md, 'utf8');
  console.log(`\n汇总报告: ${reportPath}`);
  console.log(`v6 baseline: ${fmt(baselineWmape)} → 推荐: ${fmt(recommendedAlgoScore.precisionWmape)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
