import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyPage, shouldSendPageToDify } from './page-classify.js';

describe('page classification', () => {
  it('classifies an explosion page', () => {
    assert.equal(classifyPage(3, 'EXPLOSION 爆炸图'), 'explosion');
  });

  it('classifies a short product proposal as render', () => {
    assert.equal(classifyPage(2, '产品方案'), 'render');
    assert.equal(shouldSendPageToDify('render', '产品方案'), false);
  });

  it('classifies the first page as cover', () => {
    assert.equal(classifyPage(1, '新品设计提案'), 'cover');
    assert.equal(shouldSendPageToDify('cover', '新品设计提案'), false);
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

  it('sends non-cover render pages when a real slide image is available', () => {
    assert.equal(
      shouldSendPageToDify('render', '', { pageNo: 3, hasRealImage: true }),
      true,
    );
    assert.equal(
      shouldSendPageToDify('cover', '', { pageNo: 1, hasRealImage: true }),
      false,
    );
  });
});
