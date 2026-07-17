import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCsvBytes, parseDelimitedText, sanitizeCsvText } from './parse.js';
import { wideCsvBufferToRowObjects } from '../sales-report-parser.js';

describe('parseDelimitedText', () => {
  it('parses quoted CSV cells with embedded commas', () => {
    const rows = parseDelimitedText(
      'SKU,品名,品类\nDJ1,"US Desk, black",Office',
    );
    assert.deepEqual(rows[1], ['DJ1', 'US Desk, black', 'Office']);
  });

  it('keeps quoted cells that span multiple lines (RFC4180)', () => {
    const rows = parseDelimitedText(
      [
        '需求单号,SKU,跟单说明,单据状态',
        'SPO1,DJ1,"壁炉产前样寄到贝诺，7/3开发已看',
        '碳块需要开模,周期大概20-25天左右货好；",待入库',
      ].join('\n'),
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1], [
      'SPO1',
      'DJ1',
      '壁炉产前样寄到贝诺，7/3开发已看\n碳块需要开模,周期大概20-25天左右货好；',
      '待入库',
    ]);
  });
});

describe('sanitizeCsvText', () => {
  it('removes NUL bytes that PostgreSQL rejects', () => {
    assert.equal(sanitizeCsvText('a\0b\0c'), 'abc');
    assert.equal(sanitizeCsvText('plain'), 'plain');
  });
});

describe('decodeCsvBytes', () => {
  it('strips embedded NUL bytes from decoded CSV', () => {
    const csv = 'SKU,name\nDJ1,ab\0c\0';
    const text = decodeCsvBytes(Buffer.from(csv, 'utf8'));
    assert.equal(text.includes('\0'), false);
    const rows = parseDelimitedText(text);
    assert.equal(rows[1][1], 'abc');
  });

  it('decodes Excel UTF-16LE CSV with BOM', () => {
    const csv = '需求单号,SKU,单据状态\nSPO1,DJ1,待入库\n';
    const utf16 = Buffer.from(`\uFEFF${csv}`, 'utf16le');
    const text = decodeCsvBytes(utf16);
    assert.match(text, /^需求单号,SKU,单据状态/);
    const rows = parseDelimitedText(text);
    assert.equal(rows[1]?.[0], 'SPO1');
    assert.equal(rows[1]?.[2], '待入库');
  });

  it('keeps UTF-8 Chinese headers that are not FOB markers', () => {
    const csv = '需求单号,SKU,单据状态\nSPO1,DJ1,待入库\n';
    const text = decodeCsvBytes(Buffer.from(csv, 'utf8'));
    assert.match(text, /^需求单号,SKU,单据状态/);
    assert.equal(parseDelimitedText(text)[1]?.[0], 'SPO1');
  });
});

describe('wideCsvBufferToRowObjects', () => {
  it('parses xiaoshou wide rows without NUL in cell values', () => {
    const csv = 'SKU,platform,(2026-06-01)\nDJ1,AMZ\0,\0 5';
    const rows = wideCsvBufferToRowObjects(Buffer.from(csv, 'utf8'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].SKU, 'DJ1');
    assert.equal(rows[0].platform, 'AMZ');
    assert.equal(rows[0]['(2026-06-01)'], '5');
    for (const value of Object.values(rows[0])) {
      assert.equal(value.includes('\0'), false);
    }
  });
});
