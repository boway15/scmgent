import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
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
});
