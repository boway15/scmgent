import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcQtyGross, canConfirmBom, normalizeAiLine } from './bom-math.js';

describe('calcQtyGross', () => {
  it('applies loss rate', () => {
    assert.equal(calcQtyGross(1, 0.08), 1.08);
  });

  it('rounds to 4 decimals', () => {
    assert.equal(calcQtyGross(1, 1 / 3), 1.3333);
  });
});

describe('normalizeAiLine', () => {
  it('accepts snake_case AI payload', () => {
    const line = normalizeAiLine({
      category: '板材',
      material_name: '多层板',
      spec: '18mm',
      unit: '张',
      qty_net: 2,
      loss_rate: 0.1,
      source_ref: 'p3',
      confidence: 'medium',
      notes: '',
    });
    assert.ok(line);
    assert.equal(line!.materialName, '多层板');
    assert.equal(line!.qtyNet, 2);
  });

  it('rejects invalid confidence', () => {
    assert.equal(
      normalizeAiLine({
        material_name: 'x',
        unit: '个',
        qty_net: 1,
        confidence: 'maybe',
      }),
      null,
    );
  });
});

describe('canConfirmBom', () => {
  it('blocks low confidence unless force', () => {
    const lines = [
      { materialName: 'a', unit: '个', qtyNet: 1, confidence: 'low' as const },
    ];
    assert.equal(canConfirmBom(lines).ok, false);
    assert.equal(canConfirmBom(lines, true).ok, true);
  });
});
