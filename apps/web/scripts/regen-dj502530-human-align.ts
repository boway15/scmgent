import { config } from 'dotenv';
import { resolve } from 'node:path';
import { generateBaselineForecastVersion } from '../server/lib/forecast-collaboration.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const result = await generateBaselineForecastVersion({
  startMonth: '2026-11',
  monthCount: 6,
  forceNewVersion: true,
  versionName: `HUMAN-ALIGN-DJ502530-${Date.now()}`,
  excludeAccessories: true,
  skuCode: 'DJ502530_2',
});

console.log(
  JSON.stringify(
    {
      versionNo: result.version.versionNo,
      versionId: result.version.id,
      forecastRows: result.forecastRows,
    },
    null,
    2,
  ),
);
process.exit(0);
