import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { parseVolumeSheetRows, sheetRowsFromBuffer } from './fob-bill-parsers.js';
import {
  TRANSFER_VOLUME_TEMPLATE_HEADERS,
  buildFobImportTemplate,
} from './fob-import-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePath = join(__dirname, '../../../../docs/samples/import-fob/体积信息_202606181444.xlsx');

{
  const wb = XLSX.readFile(samplePath);
  const sampleRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][];
  assert.deepEqual(sampleRows[0], [...TRANSFER_VOLUME_TEMPLATE_HEADERS]);
}

{
  const { buffer, filename } = await buildFobImportTemplate('volume');
  assert.equal(filename, '1.体积导入模板.xlsx');
  const rows = await sheetRowsFromBuffer(buffer);
  assert.deepEqual(rows[0], [...TRANSFER_VOLUME_TEMPLATE_HEADERS]);
  const { items, errors } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].containerNo, 'TLLU8925555');
  assert.equal(items[0].merchantCode, 'WJH2606020011');
  assert.equal(items[0].skuCode, 'DJ502313_34');
}

{
  const buf = readFileSync(samplePath);
  const rows = await sheetRowsFromBuffer(buf);
  const { items, errors } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 15);
}

console.log('fob-import-templates.test.ts: all passed');
