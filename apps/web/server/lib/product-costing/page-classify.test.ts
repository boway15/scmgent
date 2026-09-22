import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyPage,
  selectPagesForFactsJudge,
  shouldSendPageToBomExtract,
  shouldSendPageToDify,
  sortPagesForExtract,
} from './page-classify.js';

describe('page classification', () => {
  it('classifies an explosion page', () => {
    assert.equal(classifyPage(3, 'EXPLOSION 爆炸图'), 'explosion');
  });

  it('classifies a short product proposal as render', () => {
    assert.equal(classifyPage(2, '产品方案'), 'render');
    assert.equal(shouldSendPageToDify('render', '产品方案'), false);
    assert.equal(
      shouldSendPageToDify('render', '产品方案', { pageNo: 2, hasRealImage: true }),
      false,
    );
  });

  it('classifies the first page as cover', () => {
    assert.equal(classifyPage(1, '新品设计提案'), 'cover');
    assert.equal(shouldSendPageToDify('cover', '新品设计提案'), false);
  });

  it('classifies empty non-cover slides as unknown for multimodal review', () => {
    assert.equal(classifyPage(4, ''), 'unknown');
    assert.equal(shouldSendPageToDify('unknown', '', { pageNo: 4, hasRealImage: true }), true);
    assert.equal(shouldSendPageToDify('unknown', '', { pageNo: 4, hasRealImage: false }), false);
  });

  it('classifies and sends CMF material selection', () => {
    const text = 'CMF 材质选择：密度板';
    assert.equal(classifyPage(4, text), 'cmf');
    assert.equal(shouldSendPageToDify('cmf', text), true);
  });

  it('sends cover or render pages when material keywords occur', () => {
    assert.equal(shouldSendPageToDify('render', '产品方案：实木桌面'), true);
    assert.equal(shouldSendPageToDify('cover', '18mm 板材'), true);
  });

  it('orders size and notes before explosion for cross-page coherence', () => {
    const ordered = sortPagesForExtract([
      { pageNo: 5, pageType: 'explosion' as const },
      { pageNo: 7, pageType: 'size' as const },
      { pageNo: 4, pageType: 'notes' as const },
    ]);
    assert.deepEqual(
      ordered.map((page) => page.pageNo),
      [7, 4, 5],
    );
  });
});

describe('facts vs bom page selection', () => {
  it('prefers size and notes pages, skips cover and explosion photos', () => {
    const selected = selectPagesForFactsJudge([
      { pageType: 'cover' as const, pageNo: 1 },
      { pageType: 'size' as const, pageNo: 2 },
      { pageType: 'notes' as const, pageNo: 3 },
      { pageType: 'explosion' as const, pageNo: 4 },
      { pageType: 'explosion' as const, pageNo: 5 },
      { pageType: 'render' as const, pageNo: 6 },
    ]);
    assert.deepEqual(
      selected.map((page) => page.pageNo),
      [2, 3],
    );
  });

  it('includes cover text pages for identity when no size/notes exist', () => {
    const selected = selectPagesForFactsJudge([
      { pageType: 'cover' as const, pageNo: 1 },
      { pageType: 'render' as const, pageNo: 2 },
      { pageType: 'explosion' as const, pageNo: 3 },
    ]);
    assert.deepEqual(
      selected.map((page) => page.pageNo),
      [1],
    );
  });

  it('sends size and explosion to BOM extract', () => {
    assert.equal(shouldSendPageToBomExtract('size'), true);
    assert.equal(shouldSendPageToBomExtract('explosion'), true);
    assert.equal(shouldSendPageToBomExtract('cover'), false);
    assert.equal(shouldSendPageToBomExtract('render'), false);
  });
});
