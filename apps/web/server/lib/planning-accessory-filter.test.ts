import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchesProductScope, parseProductScope } from './planning-accessory-filter.js';

describe('product scope', () => {
  it('defaults missing and unknown values to goods', () => {
    assert.equal(parseProductScope(undefined), 'goods');
    assert.equal(parseProductScope(''), 'goods');
    assert.equal(parseProductScope('all'), 'goods');
    assert.equal(parseProductScope('accessory'), 'accessory');
  });

  it('treats goods and accessory as complements', () => {
    const samples = [
      { code: 'DJ478585_2P02', skuKind: 'standard' },
      { code: 'DJ485882P01', skuKind: null },
      { code: '704576101P01', skuKind: null },
      { code: '1001009P01', skuKind: null },
      { code: 'CUSTOM_2P', skuKind: null },
      { code: 'DJ502313_34', skuKind: 'standard' },
      { code: '704576101R', skuKind: 'return' },
      { code: '704576101B1', skuKind: 'multi_box' },
      { code: 'PLAIN', skuKind: 'accessory' },
    ];
    for (const sku of samples) {
      assert.equal(
        matchesProductScope('goods', sku),
        !matchesProductScope('accessory', sku),
      );
    }
    assert.equal(matchesProductScope('accessory', { code: 'DJ478585_2P02' }), true);
    assert.equal(matchesProductScope('goods', { code: '704576101R', skuKind: 'return' }), true);
    assert.equal(matchesProductScope('accessory', { code: 'PLAIN', skuKind: 'accessory' }), true);
    assert.equal(matchesProductScope('goods', { code: 'DJ502313_34', skuKind: 'standard' }), true);
  });
});
