import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePriceBookSheet } from './price-book-import.js';

describe('parsePriceBookSheet', () => {
  it('maps Chinese headers and normalizes an empty spec', () => {
    const rows = parsePriceBookSheet([
      ['大类', '材料名称', '规格', '单位', '单价', '备注'],
      ['板材', '多层板', '', '张', 88.5, '常用'],
    ]);

    assert.deepEqual(rows, [
      {
        category: '板材',
        materialName: '多层板',
        spec: '',
        unit: '张',
        unitPrice: 88.5,
        notes: '常用',
      },
    ]);
  });

  it('maps English headers', () => {
    const rows = parsePriceBookSheet([
      ['category', 'material_name', 'spec', 'unit', 'unit_price', 'notes'],
      ['五金', '滑轨', '450mm', '副', '12.25', ''],
    ]);

    assert.equal(rows[0]?.materialName, '滑轨');
    assert.equal(rows[0]?.unitPrice, 12.25);
  });

  it('skips rows with a negative unit price', () => {
    const rows = parsePriceBookSheet([
      ['大类', '材料名称', '规格', '单位', '单价', '备注'],
      ['板材', '多层板', '18mm', '张', -1, '错误价格'],
      ['板材', '多层板', '12mm', '张', 60, ''],
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.spec, '12mm');
  });
});
