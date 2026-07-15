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
const samplesDir = join(__dirname, '../../../../docs/samples/import-fob');
const withContainerSamplePath = join(samplesDir, '导出截单清单数据导出_202607150908.xlsx');
const legacyNoContainerSamplePath = join(
  samplesDir,
  '1.体积导入-导出截单清单数据导出_202607011522.xlsx',
);
const legacySamplePath = join(samplesDir, '体积信息_202606181444.xlsx');

{
  const wb = XLSX.readFile(withContainerSamplePath);
  const sampleRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][];
  assert.deepEqual(sampleRows[0], [...TRANSFER_VOLUME_TEMPLATE_HEADERS]);
  assert.equal(TRANSFER_VOLUME_TEMPLATE_HEADERS[0], '货柜号');
}

{
  const { buffer, filename } = await buildFobImportTemplate('volume');
  assert.equal(filename, '1.体积导入模板.xlsx');
  const rows = await sheetRowsFromBuffer(buffer);
  assert.deepEqual(rows[0], [...TRANSFER_VOLUME_TEMPLATE_HEADERS]);
  assert.equal(rows[0]![0], '货柜号');
  const { items, errors } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].containerNo, 'OOCU8469000');
  assert.equal(items[0].merchantCode, 'WJH2607030019');
  assert.equal(items[0].skuCode, 'DJ504015_4');
  assert.equal(items[0].merchantName, '广州宏龙办公家具有限公司');
  assert.match(items[0].remark ?? '', /类别:FOB/);
  assert.match(items[0].remark ?? '', /工厂:广州宏龙办公家具有限公司/);
}

{
  // 业务样例全为退税类别 → 不产生分摊体积行，标为非 FOB 柜
  const buf = readFileSync(withContainerSamplePath);
  const rows = await sheetRowsFromBuffer(buf);
  const { items, errors, nonFobContainers } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 0);
  assert.deepEqual(nonFobContainers, ['OOCU8469000']);
}

{
  const buf = readFileSync(legacyNoContainerSamplePath);
  const rows = await sheetRowsFromBuffer(buf);
  const { items, errors } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 6);
  assert.equal(items[0].containerNo, 'H26061200007');
  assert.equal(items[0].merchantName, '漳州广思五金制品有限公司');
  assert.match(items[0].remark ?? '', /类别:FOB/);
}

{
  const buf = readFileSync(legacySamplePath);
  const rows = await sheetRowsFromBuffer(buf);
  const { items, errors, nonFobContainers } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 0);
  assert.ok((nonFobContainers?.length ?? 0) >= 1);
}

console.log('fob-import-templates.test.ts: all passed');
