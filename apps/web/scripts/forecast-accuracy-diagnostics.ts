/**
 * 预测准确率诊断：输出全局 WMAPE/Bias、分层指标、数据质量与误差 Top SKU。
 *
 * Usage:
 *   pnpm --dir apps/web exec tsx scripts/forecast-accuracy-diagnostics.ts
 *   pnpm --dir apps/web exec tsx scripts/forecast-accuracy-diagnostics.ts --version-id <uuid> --start-month 2026-01 --end-month 2026-06
 *   pnpm --dir apps/web exec tsx scripts/forecast-accuracy-diagnostics.ts --version-name 走步回测-2026-01-01-6M-v3 --json
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import {
  buildForecastAccuracyDiagnostics,
  formatForecastAccuracyDiagnosticsMarkdown,
} from '../server/lib/forecast-accuracy-diagnostics.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function readIntArg(name: string): number | undefined {
  const raw = readArg(name);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

async function main() {
  const diagnostics = await buildForecastAccuracyDiagnostics({
    versionId: readArg('--version-id'),
    versionName: readArg('--version-name'),
    station: readArg('--station'),
    platform: readArg('--platform'),
    startMonth: readArg('--start-month'),
    endMonth: readArg('--end-month'),
    asOf: readArg('--as-of'),
    limitTopErrors: readIntArg('--limit-top-errors'),
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(diagnostics, null, 2));
    return;
  }

  console.log(formatForecastAccuracyDiagnosticsMarkdown(diagnostics));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
