import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendExtractOtherCategoryNote,
  categoryForExtractLine,
} from './extract-line-category.js';

describe('categoryForExtractLine', () => {
  it('keeps category for explicit rows matched to price book', () => {
    assert.equal(
      categoryForExtractLine({
        origin: 'explicit',
        category: '五金',
        matchStatus: 'exact',
      }),
      '五金',
    );
    assert.equal(
      categoryForExtractLine({
        origin: 'explicit',
        category: '板材',
        matchStatus: 'name_only',
      }),
      '板材',
    );
  });

  it('moves unmatched explicit AI rows to 其他', () => {
    assert.equal(
      categoryForExtractLine({
        origin: 'explicit',
        category: '板材',
        matchStatus: 'unmatched',
      }),
      '其他',
    );
  });

  it('does not change template/rule rows', () => {
    assert.equal(
      categoryForExtractLine({
        origin: 'template',
        category: '板材',
        matchStatus: 'unmatched',
      }),
      '板材',
    );
  });
});

describe('appendExtractOtherCategoryNote', () => {
  it('adds note when reclassified to 其他', () => {
    assert.equal(
      appendExtractOtherCategoryNote('', '其他', '板材'),
      '未匹配价目，归入其他',
    );
  });
});
