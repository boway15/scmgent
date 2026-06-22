import assert from 'node:assert/strict';
import {
  parseHuamaoFreightSheet,
  parseSimplifiedFreightSheet,
} from './fob-bill-parsers.js';

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

console.log('fob-bill-parsers.test.ts: all passed');
