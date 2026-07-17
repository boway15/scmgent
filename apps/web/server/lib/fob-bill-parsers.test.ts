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
  // 纯退税 / 纯非FOB 柜不参与分账
  const rows = [
    ['临柜号', '调拨单号', '订舱编号', 'SKU编码', '体积', '是否退税', '目的仓'],
    ['H001', 'DB001', 'WJH001', 'SKU-A', '3', '退税', '美西仓'],
    ['H001', 'DB002', 'WJH001', 'SKU-B', '2', '退税', '美西仓'],
    ['H002', 'DB003', 'WJH002', 'SKU-C', '5', '非FOB', '美东仓'],
  ];
  const { items, errors, skippedRows, nonFobContainers } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 0);
  assert.equal(skippedRows, 3);
  assert.deepEqual(nonFobContainers, ['H001', 'H002']);
}

{
  // 混柜：含 FOB 行则整柜（含退税行）参与分账；纯非FOB 柜跳过
  const rows = [
    [
      '货柜号',
      '临柜号',
      '调拨单号',
      '订舱编号',
      'SKU编码',
      '体积',
      '是否退税',
      '工厂名称',
      '工厂类型',
      '目的仓',
    ],
    [
      'OOCU8469000',
      'H26070300023',
      'DB001',
      'WJH001',
      'SKU-A',
      '3.78',
      '退税',
      '广州宏龙办公家具有限公司',
      'FOB',
      '美东仓',
    ],
    [
      'OOCU8469000',
      'H26070300023',
      'DB003',
      'WJH003',
      'SKU-C',
      '1.2',
      '退税',
      '广州宏龙办公家具有限公司',
      '退税',
      '美东仓',
    ],
    [
      '',
      'H999',
      'DB002',
      'WJH002',
      'SKU-B',
      '2',
      '不退税',
      '厦门迈尔斯贸易有限公司',
      '非退税',
      '美西仓',
    ],
  ];
  const { items, errors, nonFobContainers } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 2);
  assert.equal(items[0].containerNo, 'OOCU8469000');
  assert.equal(items[0].merchantCode, '广州宏龙办公家具有限公司');
  assert.equal(items[0].merchantName, '广州宏龙办公家具有限公司');
  assert.equal(
    items[0].remark,
    '业务编号:WJH001；调拨:DB001；类别:FOB；工厂:广州宏龙办公家具有限公司；目的仓:美东仓',
  );
  assert.equal(items[1].containerNo, 'OOCU8469000');
  assert.equal(items[1].merchantCode, '广州宏龙办公家具有限公司');
  assert.match(items[1].remark ?? '', /类别:退税/);
  assert.ok(Math.abs(items[0].volumeCbm + items[1].volumeCbm - 4.98) < 0.01);
  assert.deepEqual(nonFobContainers, ['H999']);
}

{
  // 同订舱多工厂：主体按工厂名称拆分（非订舱编号）
  const rows = [
    [
      '货柜号',
      '临柜号',
      '调拨单号',
      '订舱编号',
      'SKU编码',
      '体积',
      '是否退税',
      '工厂名称',
      '工厂类型',
      '目的仓',
    ],
    ['CSNU8685863', 'H1', 'DB1', 'ZKX2604290075', 'SKU-A', '37.7', '退税', '漳州贝德家具有限公司', 'FOB', '美西仓'],
    ['CSNU8685863', 'H1', 'DB2', 'ZKX2604290075', 'SKU-B', '31.29', '退税', '漳州悦淳工贸有限公司', 'FOB', '美西仓'],
    ['CSNU8685863', 'H1', 'DB3', 'ZKX2604290075', 'SKU-C', '0.23', '退税', '贝德家具有限公司', 'FOB', '美西仓'],
  ];
  const { items, errors } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 3);
  const codes = new Set(items.map((i) => i.merchantCode));
  assert.equal(codes.size, 3);
  assert.ok(codes.has('漳州贝德家具有限公司'));
  assert.ok(codes.has('漳州悦淳工贸有限公司'));
  assert.ok(codes.has('贝德家具有限公司'));
  assert.ok(items.every((i) => i.merchantCode === i.merchantName));
  assert.ok(items.every((i) => (i.remark ?? '').includes('业务编号:ZKX2604290075')));
  assert.ok(Math.abs(items.reduce((s, i) => s + i.volumeCbm, 0) - 69.22) < 0.01);
}

{
  // 工厂名称为空：报错，不回退订舱编号
  const rows = [
    [
      '货柜号',
      '临柜号',
      '调拨单号',
      '订舱编号',
      'SKU编码',
      '体积',
      '是否退税',
      '工厂名称',
      '工厂类型',
      '目的仓',
    ],
    ['CSNU8685863', 'H1', 'DB1', 'ZKX2604290075', 'SKU-A', '10', '退税', '', 'FOB', '美西仓'],
  ];
  const { items, errors } = parseVolumeSheetRows(rows);
  assert.equal(items.length, 0);
  assert.ok(errors.some((e) => /工厂名称/.test(e)));
}

{
  // 样例体积文件全为退税类别 → 全部标为非 FOB 柜，不产生分摊体积行
  const buf = readFileSync(join(samplesDir, '体积信息_202606181444.xlsx'));
  const rows = await sheetRowsFromBuffer(buf);
  const { items, errors, nonFobContainers } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 0);
  assert.ok((nonFobContainers?.length ?? 0) >= 1);
  assert.ok(nonFobContainers?.includes('TLLU8925555'));
  assert.ok(nonFobContainers?.includes('WHSU8817230'));
}

{
  const buf = readFileSync(join(samplesDir, '导出截单清单数据导出_202607150908.xlsx'));
  const rows = await sheetRowsFromBuffer(buf);
  const { items, errors, nonFobContainers } = parseVolumeSheetRows(rows);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 0);
  assert.deepEqual(nonFobContainers, ['OOCU8469000']);
}

console.log('fob-bill-parsers.test.ts: all passed');
