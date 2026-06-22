/**
 * 校验 docs/samples/fob 三类示例能否解析且柜号对齐
 * 用法: cd apps/web && pnpm exec tsx server/scripts/verify-fob-samples.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseEdVolumeSheet,
  parseSenweiTruckingSheet,
  parseHuamaoFreightSheet,
  sheetRowsFromBuffer,
} from '../lib/fob-bill-parsers.js';
import { computeContainerMatch } from '../lib/fob-container-match.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = join(__dirname, '../../../../docs/samples/fob');
const USD_RATE = 7.25;

async function main() {
  const volRows = await sheetRowsFromBuffer(readFileSync(join(base, '01-volume-ed.xlsx')).buffer);
  const truckRows = await sheetRowsFromBuffer(readFileSync(join(base, '02-trucking-bill.xlsx')).buffer);
  const freightRows = await sheetRowsFromBuffer(readFileSync(join(base, '03-freight-bill.xlsx')).buffer);

  const vol = parseEdVolumeSheet(volRows);
  const truck = parseSenweiTruckingSheet(truckRows);
  const freight = parseHuamaoFreightSheet(freightRows, USD_RATE);

  const volumeContainers = [...new Set(vol.items.map((i) => i.containerNo))];
  const billContainers = [
    ...new Set([...truck.items.map((i) => i.containerNo), ...freight.items.map((i) => i.containerNo)]),
  ];
  const match = computeContainerMatch(volumeContainers, billContainers);

  console.log('volume rows:', vol.items.length, 'skipped:', vol.skippedRows, 'errors:', vol.errors.length);
  console.log('trucking items:', truck.items.length, 'freight items:', freight.items.length);
  console.log(
    'container match:',
    match.matchedCount,
    '/',
    match.volumeCount,
    match.canAllocate ? '(OK)' : '(MISMATCH)',
  );

  if (!match.canAllocate || vol.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
