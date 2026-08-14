import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendMatchHint, matchPriceBook } from './match-price.js';

describe('appendMatchHint', () => {
  it('removes the system spec hint when ambiguity is resolved', () => {
    assert.equal(appendMatchHint('图纸模糊；规格待确认'), '图纸模糊');
  });

  it('adds the system spec hint without duplicating user notes', () => {
    assert.equal(appendMatchHint('图纸模糊', '规格待确认'), '图纸模糊；规格待确认');
  });
});

describe('matchPriceBook', () => {
  it('matches name, spec, and unit ignoring case and edge spaces', () => {
    const result = matchPriceBook(
      { materialName: ' MDF ', spec: ' 18MM ', unit: ' 张 ' },
      [{ id: 'p1', materialName: 'mdf', spec: '18mm', unit: '张' }],
    );
    assert.deepEqual(result, { status: 'exact', priceBookId: 'p1' });
  });

  it('returns name_only for one matching name and unit', () => {
    const result = matchPriceBook(
      { materialName: '滑轨', spec: '', unit: '副' },
      [{ id: 'p2', materialName: '滑轨', spec: '三节', unit: '副' }],
    );
    assert.deepEqual(result, { status: 'name_only', priceBookId: 'p2' });
  });

  it('leaves multiple same-name candidates unmatched', () => {
    const result = matchPriceBook(
      { materialName: '滑轨', spec: '', unit: '副' },
      [
        { id: 'p2', materialName: '滑轨', spec: '三节', unit: '副' },
        { id: 'p3', materialName: '滑轨', spec: '两节', unit: '副' },
      ],
    );
    assert.equal(result.status, 'unmatched');
    assert.equal(result.priceBookId, null);
    assert.match(result.hint ?? '', /规格待确认/);
  });

  it('returns unmatched with null id when there is no candidate', () => {
    const result = matchPriceBook(
      { materialName: '拉手', spec: '', unit: '个' },
      [{ id: 'p2', materialName: '滑轨', spec: '三节', unit: '副' }],
    );
    assert.deepEqual(result, { status: 'unmatched', priceBookId: null });
  });
});
