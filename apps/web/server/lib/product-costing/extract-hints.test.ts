import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildExtractHints, uniquePriceBookNames } from './extract-hints.js';

describe('uniquePriceBookNames', () => {
  it('dedupes names case-insensitively and respects the limit', () => {
    assert.deepEqual(
      uniquePriceBookNames(
        [
          { materialName: '密度板' },
          { materialName: '密度板' },
          { materialName: ' 滑轨 ' },
          { materialName: '颗粒板' },
        ],
        2,
      ),
      ['密度板', '滑轨'],
    );
  });
});

describe('buildExtractHints', () => {
  it('injects category rules, product facts, page task, and price-book names', () => {
    const text = buildExtractHints({
      category: '书桌',
      constructionType: '板式',
      drawerCount: 3,
      defaultSubstrate: '颗粒板',
      overallSize: { widthMm: 1800, depthMm: 800, heightMm: 750 },
      structureSummary: '顶板为盖板',
      designPrinciples: '抽侧长=柜深-50mm',
      pageType: 'explosion',
      priceBookNames: ['密度板', '滑轨', '密度板'],
    });
    assert.match(text, /品类：书桌/);
    assert.match(text, /必有板件：桌面/);
    assert.match(text, /结构类型：板式/);
    assert.match(text, /抽屉数：3/);
    assert.match(text, /默认基材：颗粒板/);
    assert.match(text, /W1800 × D800 × H750 mm/);
    assert.match(text, /第一步已确认/);
    assert.match(text, /已确认结构/);
    assert.match(text, /已确认拆料原则/);
    assert.match(text, /page_type=explosion/);
    assert.match(text, /数清抽屉组数/);
    assert.match(text, /价目标准名.*密度板、滑轨/);
    assert.match(text, /文档分工/);
    assert.match(text, /抽面/);
    assert.match(text, /一抽一套|一套滑轨/);
    assert.match(text, /不要用米/);
    assert.doesNotMatch(text, /禁止按外形自动开料/);
  });

  it('includes already extracted lines for later pages', () => {
    const text = buildExtractHints({
      pageType: 'explosion',
      priorLines: [{ materialName: '桌面板', spec: '15mm', unit: '张', qtyNet: 1 }],
    });
    assert.match(text, /已拆清单/);
    assert.match(text, /桌面板\|15mm\|张\|qty=1/);
  });

  it('omits optional facts when they are empty', () => {
    const text = buildExtractHints({ category: '其他' });
    assert.doesNotMatch(text, /抽屉数：/);
    assert.doesNotMatch(text, /价目标准名/);
    assert.match(text, /必有板件：无/);
  });
});
