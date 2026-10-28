import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractProjectGroupFromCategory,
  normalizeCategoryPath,
  resolveEffectiveSkuCategory,
  skuMatchesCategoryFilter,
} from './sku-category.js';

describe('sku-category', () => {
  it('matches exact category and child paths', () => {
    assert.equal(skuMatchesCategoryFilter('Outdoor/Patio', 'Outdoor'), true);
    assert.equal(skuMatchesCategoryFilter('Outdoor/Patio', 'Outdoor/Patio'), true);
    assert.equal(skuMatchesCategoryFilter('Outdoor/Patio', 'Patio'), true);
    assert.equal(skuMatchesCategoryFilter('Outdoor/Patio', 'Garden'), false);
    assert.equal(skuMatchesCategoryFilter(null, 'Outdoor'), false);
    assert.equal(skuMatchesCategoryFilter('Outdoor/Patio', ''), true);
  });

  it('treats backslash and slash as equivalent path separators', () => {
    const path = 'DJ02-家具事业1部\\Amazon项目1组-第一曲线-US\\卧室-床头柜Nightstands';
    const normalized = normalizeCategoryPath(path);
    assert.equal(
      skuMatchesCategoryFilter(path, 'DJ02-家具事业1部/Amazon项目1组-第一曲线-US'),
      true,
    );
    assert.equal(
      skuMatchesCategoryFilter(normalized, 'DJ02-家具事业1部\\Amazon项目1组-第一曲线-US'),
      true,
    );
  });

  it('prefers sales history category over master when resolving effective category', () => {
    assert.equal(
      resolveEffectiveSkuCategory('Outdoor/Patio', 'DJ02\\Amazon\\Nightstands'),
      'DJ02/Amazon/Nightstands',
    );
    assert.equal(resolveEffectiveSkuCategory('Outdoor/Patio', null), 'Outdoor/Patio');
  });

  it('matches keyword anywhere in path for filter helper', () => {
    const path = 'DJ02-家具事业1部\\Amazon项目1组-第一曲线-US\\卧室-床头柜Nightstands';
    assert.equal(skuMatchesCategoryFilter(path, '床头柜'), true);
    assert.equal(skuMatchesCategoryFilter(path, 'Nightstands'), true);
    assert.equal(
      skuMatchesCategoryFilter(path, 'DJ02-家具事业1部/Amazon项目1组-第一曲线-US'),
      true,
    );
  });

  it('extracts the middle category segment as project group', () => {
    assert.equal(
      extractProjectGroupFromCategory(
        'DJ02-家具事业1部\\Amazon项目1组-第一曲线-US\\卧室-床头柜Nightstands',
      ),
      'Amazon项目1组-第一曲线-US',
    );
    assert.equal(
      extractProjectGroupFromCategory(
        'DJ01-郑州大件/非Amazon项目6组-第二曲线-US/客厅-电视柜',
      ),
      '非Amazon项目6组-第二曲线-US',
    );
    assert.equal(
      extractProjectGroupFromCategory('DJ01-郑州大件\\大件品牌五部-AmazonUA组-US\\配件'),
      '大件品牌五部-AmazonUA组-US',
    );
    assert.equal(
      extractProjectGroupFromCategory(
        '事业部\\Amazon项目6组-第一曲线-US\\子层\\办公-电脑桌Desks',
      ),
      'Amazon项目6组-第一曲线-US\\子层',
    );
    assert.equal(extractProjectGroupFromCategory('Outdoor/Patio'), null);
    assert.equal(extractProjectGroupFromCategory('只有两段\\叶子'), null);
    assert.equal(extractProjectGroupFromCategory('单段品类'), null);
    assert.equal(extractProjectGroupFromCategory(null), null);
    assert.equal(extractProjectGroupFromCategory(''), null);
  });
});
