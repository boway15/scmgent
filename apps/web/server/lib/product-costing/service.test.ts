import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertCostingSourceAttachment,
  calculateCostingLines,
  toManualBomLineValues,
} from './service.js';

describe('calculateCostingLines', () => {
  it('matches the current active price book and uses calcCostSummary results', () => {
    const result = calculateCostingLines(
      [
        {
          id: 'line-1',
          lineNo: 1,
          category: '板材',
          materialName: '多层板',
          spec: '18mm',
          unit: '张',
          qtyNet: '2',
          lossRate: '0.1',
          qtyGross: '0',
          origin: 'explicit',
          confidence: 'high',
          matchStatus: 'unmatched',
          unitPriceOverride: null,
          priceBookId: null,
          sourceRef: null,
          notes: null,
          isManual: true,
        },
      ],
      [
        {
          id: 'price-1',
          materialName: '多层板',
          spec: '18mm',
          unit: '张',
          unitPrice: '50',
        },
      ],
    );

    assert.equal(result.lines[0]?.priceBookId, 'price-1');
    assert.equal(result.lines[0]?.matchStatus, 'exact');
    assert.equal(result.lines[0]?.effectiveUnitPrice, 50);
    assert.ok(Math.abs((result.lines[0]?.lineAmount ?? 0) - 110) < 1e-9);
    assert.ok(Math.abs(result.summary.totalAmount - 110) < 1e-9);
    assert.equal(result.summary.missingPriceCount, 0);
  });

  it('prefers a manual unit price override', () => {
    const result = calculateCostingLines(
      [
        {
          id: 'line-1',
          lineNo: 1,
          category: '五金',
          materialName: '滑轨',
          spec: null,
          unit: '副',
          qtyNet: '2',
          lossRate: '0',
          qtyGross: '2',
          origin: 'explicit',
          confidence: 'medium',
          matchStatus: 'unmatched',
          unitPriceOverride: '12.5',
          priceBookId: null,
          sourceRef: null,
          notes: null,
          isManual: true,
        },
      ],
      [],
    );

    assert.equal(result.lines[0]?.effectiveUnitPrice, 12.5);
    assert.equal(result.lines[0]?.lineAmount, 25);
    assert.equal(result.summary.missingPriceCount, 0);
  });
});

describe('toManualBomLineValues', () => {
  it('recalculates gross quantity and always marks manual input', () => {
    const values = toManualBomLineValues({
      category: '包装',
      materialName: '纸箱',
      unit: '个',
      qtyNet: 2.5,
      lossRate: 0.1,
    });

    assert.equal(values.qtyGross, '2.75');
    assert.equal(values.isManual, true);
  });
});

describe('assertCostingSourceAttachment', () => {
  it('accepts pptx/pdf up to 80MB and rejects other files or oversize uploads', () => {
    assert.doesNotThrow(() => assertCostingSourceAttachment('design.pptx', 80 * 1024 * 1024));
    assert.doesNotThrow(() => assertCostingSourceAttachment('design.PDF', 1));
    assert.throws(() => assertCostingSourceAttachment('design.xlsx', 1), /pptx.*pdf/i);
    assert.throws(
      () => assertCostingSourceAttachment('design.pdf', 80 * 1024 * 1024 + 1),
      /80MB/,
    );
  });
});
