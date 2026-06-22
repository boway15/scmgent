import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseHuamaoFreightSheet,
  parseSimplifiedFreightSheet,
  parseVolumeSheetRows,
  sheetRowsFromBuffer,
} from './fob-bill-parsers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(__dirname, '../../../../docs/samples/import-fob');

{
  const rows = [
    ['货柜号', '海运费(USD)', '文件费(CNY)'],
    ['ABCD1234567', '1000', '50'],
  ];
  const { items, errors } = parseSimplifiedFreightSheet(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 2);
  assert.equal(items[0].amountCny, 1000);
  assert.equal(items[0].originalCurrency, 'CNY');
  assert.equal(items[0].exchangeRate, undefined);
  assert.equal(items[1].amountCny, 50);
}

{
  const header: unknown[] = new Array(42).fill('');
  header[2] = '柜号';
  header[12] = '海运费(USD)';
  header[28] = '柜号';
  header[36] = '报关费(CNY)';

  const row: unknown[] = new Array(42).fill('');
  row[0] = '1';
  row[2] = 'ABCD1234567';
  row[12] = '800';
  row[28] = 'ABCD1234567';
  row[36] = '300';

  const { items, errors } = parseHuamaoFreightSheet([[], [], [], [], [], header, row]);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 2);

  const ocean = items.find((i) => i.feeType === '海运费(USD)');
  assert.ok(ocean);
  assert.equal(ocean.amountCny, 800);
  assert.equal(ocean.originalCurrency, 'CNY');
  assert.equal(ocean.exchangeRate, undefined);

  const customs = items.find((i) => i.feeType === '报关费(CNY)');
  assert.ok(customs);
  assert.equal(customs.amountCny, 300);
}

{
  const rows = [
    ['临柜号', '调拨单号', '订舱编号', 'SKU编码', '体积', '是否退税', '目的仓'],
    ['H001', 'DB001', 'WJH001', 'SKU-A', '3', '退税', '美西仓'],
    ['H001', 'DB002', 'WJH001', 'SKU-B', '2', '退税', '美西仓'],
    ['H002', 'DB003', 'WJH002', 'SKU-C', '5', '非FOB', '美东仓'],
  ];
  const { items, errors, skippedRows } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(skippedRows, 1);
  assert.equal(items.length, 2);
  assert.equal(items[0].containerNo, 'H001');
  assert.equal(items[0].merchantCode, 'WJH001');
  assert.equal(items[0].remark, '业务编号:WJH001；调拨:DB001；类别:退税；目的仓:美西仓');
}

{
  const buf = readFileSync(join(samplesDir, '体积信息_202606181444.xlsx'));
  const rows = await sheetRowsFromBuffer(buf);
  const { items, errors } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 15);
  const volByContainer = new Map<string, number>();
  for (const item of items) {
    volByContainer.set(item.containerNo, (volByContainer.get(item.containerNo) ?? 0) + item.volumeCbm);
  }
  assert.ok(Math.abs((volByContainer.get('H26060200014') ?? 0) - 68) < 0.01);
  assert.ok(Math.abs((volByContainer.get('H26060300010') ?? 0) - 66.71) < 0.01);
}

console.log('fob-bill-parsers.test.ts: all passed');
