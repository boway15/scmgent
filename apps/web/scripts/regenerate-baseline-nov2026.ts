/**
 * 全量重生成 2026-11 起草稿。
 * mode=shadow 时 generate 结束后会自动跑影子落地全流程（promote→reshape→decay→再帽）。
 *
 * pnpm --filter @scm/web exec tsx scripts/regenerate-baseline-nov2026.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { generateBaselineForecastVersion } from '../server/lib/forecast-collaboration.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

async function main() {
  console.log('generating baseline startMonth=2026-11 ...');
  const started = Date.now();
  const result = await generateBaselineForecastVersion({
    startMonth: '2026-11',
    monthCount: 6,
    forceNewVersion: true,
    versionName: `OPT-DAMP-${Date.now()}`,
    excludeAccessories: true,
  });
  console.log(
    JSON.stringify(
      {
        versionId: result.version.id,
        versionNo: result.version.versionNo,
        startMonth: result.version.startMonth,
        forecastRows: result.forecastRows,
        reviewRows: result.reviewRows,
        elapsedSec: Math.round((Date.now() - started) / 1000),
        note: 'shadow landing pipeline runs automatically when seasonalIndex.mode=shadow',
      },
      null,
      2,
    ),
  );
  console.log(`VERSION_ID=${result.version.id}`);
  console.log(`VERSION_NO=${result.version.versionNo}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
