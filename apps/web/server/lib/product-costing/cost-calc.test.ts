import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcCostSummary } from './cost-calc.js';

describe('calcCostSummary', () => {
  it('uses override over book price', () => {
    const s = calcCostSummary([
      { qtyNet: 2, lossRate: 0, unitPriceOverride: 10, bookUnitPrice: 99, category: '五金' },
    ]);
    assert.equal(s.lines[0].lineAmount, 20);
    assert.equal(s.materialAmount, 20);
    assert.equal(s.totalAmount, 20);
  });

  it('counts missing price and qty; zero total share is 0', () => {
    const s = calcCostSummary([
      { qtyNet: 0, lossRate: 0, unitPriceOverride: null, bookUnitPrice: null, category: '板材' },
    ]);
    assert.equal(s.missingQtyCount, 1);
    assert.equal(s.missingPriceCount, 1);
    assert.equal(s.totalAmount, 0);
    assert.equal(s.byCategory[0].share, 0);
  });

  it('costs sized boards by sheet yield plus default cut/band columns', () => {
    const s = calcCostSummary([
      {
        qtyNet: 2,
        lossRate: 0.08,
        unitPriceOverride: null,
        bookUnitPrice: 68,
        bookUnit: '张',
        category: '板材',
        materialName: '侧板',
        spec: '18mm 1200×400',
        unit: '块',
      },
    ]);
    assert.equal(s.boardSheet?.[0]?.piecesPerSheet, 6);
    assert.equal(s.boardSheet?.[0]?.usableWidthMm, 1200);
    assert.equal(s.boardSheet?.[0]?.usableLengthMm, 2400);
    assert.equal(s.boardSheet?.[0]?.boardCost, 22.67);
    assert.equal(s.materialAmount, 22.67);
    assert.equal(s.processAmount, 5.12);
    assert.equal(s.lines[0]!.lineAmount, 27.79);
  });

  it('adds factory fee rates on top of material and process totals', () => {
    const s = calcCostSummary(
      [
        { qtyNet: 1, lossRate: 0, unitPriceOverride: 100, bookUnitPrice: null, category: '板材' },
        { qtyNet: 1, lossRate: 0, unitPriceOverride: 20, bookUnitPrice: null, category: '加工' },
      ],
      [{ name: '税点', rate: 0.08, scope: 'factory' }],
    );
    assert.equal(s.materialAmount, 100);
    assert.equal(s.processAmount, 20);
    assert.equal(s.feeAmount, 9.6);
    assert.equal(s.totalAmount, 129.6);
    assert.equal(s.feeItems[0]?.scope, 'factory');
  });

  it('skips 拉手/螺丝 line cost but still costs 螺丝包', () => {
    const s = calcCostSummary(
      [
        { qtyNet: 1, lossRate: 0, unitPriceOverride: 200, bookUnitPrice: null, category: '板材', materialName: '侧板' },
        { qtyNet: 6, lossRate: 0, unitPriceOverride: null, bookUnitPrice: null, category: '五金', materialName: '拉手' },
        { qtyNet: 0, lossRate: 0, unitPriceOverride: null, bookUnitPrice: null, category: '五金', materialName: '螺丝' },
        { qtyNet: 1, lossRate: 0, unitPriceOverride: 10, bookUnitPrice: null, category: '五金', materialName: '螺丝包' },
      ],
      [],
      { otherHardwarePct: 5 },
    );
    assert.equal(s.materialAmount, 210);
    assert.equal(s.missingPriceCount, 0);
    assert.equal(s.missingQtyCount, 0);
    assert.equal(s.feeItems.length, 0);
    assert.equal(s.totalAmount, 210);
  });

  it('does not add standalone 加工/开料 rows into the total', () => {
    const s = calcCostSummary([
      {
        qtyNet: 2,
        lossRate: 0,
        unitPriceOverride: null,
        bookUnitPrice: 68,
        bookUnit: '张',
        category: '板材',
        materialName: '侧板',
        spec: '18mm 1200×400',
      },
      {
        qtyNet: 10,
        lossRate: 0,
        unitPriceOverride: 0.3,
        bookUnitPrice: null,
        category: '加工',
        materialName: '开料',
      },
    ]);
    assert.equal(s.lines[1]!.lineAmount, 0);
    assert.equal(s.materialAmount, 22.67);
    assert.equal(s.processAmount, 5.12);
  });
});
