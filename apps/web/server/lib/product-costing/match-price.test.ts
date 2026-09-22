import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendMatchHint, matchCostingLine, matchPriceBook, resolveFeeRates } from './match-price.js';
import { sheetUnitPriceToM2 } from './board-usage.js';

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
    assert.deepEqual(result, { status: 'exact', priceBookId: 'p1', scope: null });
  });

  it('returns name_only for one matching name and unit', () => {
    const result = matchPriceBook(
      { materialName: '滑轨', spec: '', unit: '副' },
      [{ id: 'p2', materialName: '滑轨', spec: '三节', unit: '副' }],
    );
    assert.deepEqual(result, { status: 'name_only', priceBookId: 'p2', scope: null });
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

  it('prefers a factory-specific price then falls back to region then global', () => {
    const ctx = {
      regionId: 'r-cz',
      factoryId: 'f-ysy',
      genericRegionId: 'r-g',
      genericFactoryId: 'f-g',
    };
    const book = [
      { id: 'global', materialName: '密度板', spec: '15mm', unit: '张', unitPrice: 50, regionId: 'r-g', factoryId: 'f-g' },
      { id: 'region', materialName: '密度板', spec: '15mm', unit: '张', unitPrice: 55, regionId: 'r-cz', factoryId: 'f-g' },
      { id: 'factory', materialName: '密度板', spec: '15mm', unit: '张', unitPrice: 60, regionId: 'r-cz', factoryId: 'f-ysy' },
    ];
    const factoryMatch = matchPriceBook({ materialName: '密度板', spec: '15mm', unit: '张' }, book, ctx);
    assert.equal(factoryMatch.status, 'exact');
    assert.equal(factoryMatch.priceBookId, 'factory');
    assert.equal(factoryMatch.scope, 'factory');
    assert.ok(factoryMatch.pricePerM2 && factoryMatch.pricePerM2 > 0);
    assert.equal(
      matchPriceBook(
        { materialName: '密度板', spec: '15mm', unit: '张' },
        book.filter((row) => row.id !== 'factory'),
        ctx,
      ).priceBookId,
      'region',
    );
    assert.equal(
      matchPriceBook(
        { materialName: '密度板', spec: '15mm', unit: '张' },
        book.filter((row) => row.id === 'global'),
        ctx,
      ).scope,
      'global',
    );
  });

  it('matches board aliases onto the price-book canonical name', () => {
    const result = matchPriceBook(
      { materialName: '中纤板', spec: '18mm', unit: '张' },
      [{ id: 'p4', materialName: '密度板', spec: '18mm', unit: '张' }],
    );
    assert.deepEqual(result, { status: 'exact', priceBookId: 'p4', scope: null });
  });

  it('matches board cut size onto a price-book thickness', () => {
    const result = matchPriceBook(
      { materialName: '中密度纤维板', spec: '1200x400x18mm', unit: '张' },
      [{ id: 'p5', materialName: '密度板', spec: '18mm', unit: '张' }],
    );
    assert.deepEqual(result, { status: 'exact', priceBookId: 'p5', scope: null });
  });

  it('resolves fee rates factory-first then region then global per name', () => {
    const fees = resolveFeeRates(
      {
        regionId: 'r-cz',
        factoryId: 'f-ysy',
        genericRegionId: 'r-g',
        genericFactoryId: 'f-g',
      },
      [
        { name: '人工成本', rate: 0.18, regionId: 'r-g', factoryId: 'f-g' },
        { name: '人工成本', rate: 0, regionId: 'r-cz', factoryId: 'f-ysy' },
        { name: '税点', rate: 0.06, regionId: 'r-g', factoryId: 'f-g' },
      ],
    );
    assert.deepEqual(
      fees.map((item) => ({ name: item.name, rate: item.rate, scope: item.scope })),
      [
        { name: '人工成本', rate: 0, scope: 'factory' },
        { name: '税点', rate: 0.06, scope: 'global' },
      ],
    );
  });

  it('returns unmatched with null id when there is no candidate', () => {
    const result = matchPriceBook(
      { materialName: '拉手', spec: '', unit: '个' },
      [{ id: 'p2', materialName: '滑轨', spec: '三节', unit: '副' }],
    );
    assert.deepEqual(result, { status: 'unmatched', priceBookId: null, scope: null });
  });
});

describe('matchCostingLine', () => {
  it('costs cut drawer parts by substrate m² instead of block simulation price', () => {
    const book = [
      { id: 'drawer-front-block', materialName: '抽面', spec: '', unit: '块', unitPrice: 18 },
      { id: 'board-15', materialName: '颗粒板', spec: '15mm 贴三胺', unit: '张', unitPrice: 58 },
      { id: 'mdf-15', materialName: '密度板', spec: '18mm', unit: '张', unitPrice: 52 },
    ];
    const result = matchCostingLine(
      {
        category: '板材',
        materialName: '抽面',
        spec: '15mm 598×210',
        unit: '块',
      },
      book,
      undefined,
      '密度板',
    );
    assert.equal(result.priceBookId, 'board-15');
    assert.ok(result.pricePerM2 && Math.abs(result.pricePerM2 - sheetUnitPriceToM2(58)) < 0.01);
  });

  it('matches drawer slide when alias duplicates share empty spec', () => {
    const book = [
      { id: 'slide-a', materialName: '抽屉滑轨', spec: '', unit: '套', unitPrice: 9.8 },
      { id: 'slide-b', materialName: '滚珠滑轨', spec: '', unit: '套', unitPrice: 9.8 },
    ];
    const result = matchCostingLine(
      { category: '五金', materialName: '抽屉滑轨', spec: '12寸', unit: '套' },
      book,
    );
    assert.equal(result.status, 'name_only');
    assert.equal(result.priceBookId, 'slide-a');
  });

  it('prices 12mm structure parts by nearest substrate sheet when 12mm is missing', () => {
    const book = [
      { id: 'mdf-3', materialName: '密度板', spec: '3mm', unit: '张', unitPrice: 16 },
      { id: 'mdf-18', materialName: '密度板', spec: '18mm', unit: '张', unitPrice: 52 },
      { id: 'pb-15', materialName: '颗粒板', spec: '15mm 贴三胺', unit: '张', unitPrice: 58 },
      { id: 'rail-m', materialName: '前拉条', spec: '', unit: '米', unitPrice: 0.36 },
    ];
    const side = matchCostingLine(
      { category: '板材', materialName: '侧板', spec: '12mm 400×785', unit: '块' },
      book,
      undefined,
      '密度板',
    );
    assert.equal(side.priceBookId, 'mdf-18');
    assert.equal(side.status, 'name_only');
    assert.match(side.hint ?? '', /12mm/);
    const back = matchCostingLine(
      { category: '板材', materialName: '背板', spec: '3mm 800×785', unit: '块' },
      book,
      undefined,
      '密度板',
    );
    assert.equal(back.priceBookId, 'mdf-3');
    assert.equal(back.status, 'exact');
  });

  it('prefers 防倾倒配件 个价 over alias 套价 when BOM unit is 套', () => {
    const book = [
      { id: 'tip-piece', materialName: '防倾倒配件', spec: '', unit: '个', unitPrice: 3.5 },
      { id: 'tip-kit', materialName: '金属防倾倒装置', spec: '', unit: '套', unitPrice: 4.5 },
    ];
    const result = matchCostingLine(
      { category: '五金', materialName: '防倾倒配件', spec: '', unit: '套' },
      book,
    );
    assert.equal(result.priceBookId, 'tip-piece');
    assert.ok(result.status === 'exact' || result.status === 'name_only');
  });
});
