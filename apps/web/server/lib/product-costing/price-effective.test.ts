import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dedupePriceBookByDate,
  findOverlappingPriceBookEntry,
  isPriceEffectiveOn,
  rangesOverlap,
} from './price-effective.js';

describe('price-effective', () => {
  it('filters entries by price-as-of date', () => {
    const asOf = new Date('2024-06-15');
    assert.equal(
      isPriceEffectiveOn({ effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31' }, asOf),
      true,
    );
    assert.equal(
      isPriceEffectiveOn({ effectiveFrom: '2024-07-01', effectiveTo: null }, asOf),
      false,
    );
    assert.equal(isPriceEffectiveOn({ effectiveFrom: '2000-01-01', effectiveTo: null }, asOf), true);
  });

  it('dedupes by latest effectiveFrom on the same slice', () => {
    const book = [
      {
        id: 'a',
        regionId: 'r1',
        factoryId: 'f1',
        materialName: '颗粒板',
        spec: '18mm',
        unit: '张',
        effectiveFrom: '2024-01-01',
        effectiveTo: null,
      },
      {
        id: 'b',
        regionId: 'r1',
        factoryId: 'f1',
        materialName: '颗粒板',
        spec: '18mm',
        unit: '张',
        effectiveFrom: '2024-06-01',
        effectiveTo: null,
      },
    ];
    const deduped = dedupePriceBookByDate(book, new Date('2024-06-15'));
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0]?.id, 'b');
  });

  it('detects overlapping ranges on the same slice', () => {
    assert.equal(
      rangesOverlap(
        { from: new Date('2024-01-01'), to: new Date('2024-12-31') },
        { from: new Date('2024-06-01'), to: null },
      ),
      true,
    );
    assert.equal(
      rangesOverlap(
        { from: new Date('2024-01-01'), to: new Date('2024-06-01') },
        { from: new Date('2024-06-01'), to: null },
      ),
      false,
    );
  });

  it('findOverlappingPriceBookEntry matches same slice only', () => {
    const candidates = [
      {
        id: '1',
        regionId: 'r1',
        factoryId: null,
        materialName: '纸箱',
        spec: '',
        unit: 'm2',
        effectiveFrom: '2024-01-01',
        effectiveTo: '2024-12-31',
      },
    ];
    const overlap = findOverlappingPriceBookEntry(candidates, {
      regionId: 'r1',
      factoryId: null,
      materialName: '纸箱',
      spec: '',
      unit: 'm2',
      effectiveFrom: new Date('2024-06-01'),
      effectiveTo: null,
    });
    assert.ok(overlap);
    const noOverlap = findOverlappingPriceBookEntry(candidates, {
      regionId: 'r2',
      factoryId: null,
      materialName: '纸箱',
      spec: '',
      unit: 'm2',
      effectiveFrom: new Date('2024-06-01'),
      effectiveTo: null,
    });
    assert.equal(noOverlap, null);
  });
});
