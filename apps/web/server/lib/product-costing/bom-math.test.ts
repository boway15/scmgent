import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcQtyGross, normalizeAiLine } from './bom-math.js';

describe('bom-math', () => {
  it('calcQtyGross rounds 4 decimals', () => {
    assert.equal(calcQtyGross(1, 0.08), 1.08);
    assert.equal(calcQtyGross(2.5, 0.1), 2.75);
  });

  it('normalizeAiLine accepts qty 0 template rows and origin', () => {
    const line = normalizeAiLine({
      category: '板材',
      material_name: '侧板',
      spec: '',
      unit: '块',
      qty_net: 0,
      loss_rate: 0,
      source_ref: '',
      confidence: 'low',
      origin: 'template',
    });
    assert.equal(line?.qtyNet, 0);
    assert.equal(line?.origin, 'template');
  });

  it('normalizeAiLine infers explicit when source_ref present', () => {
    const line = normalizeAiLine({
      material_name: '滑轨',
      unit: '副',
      qty_net: 2,
      confidence: 'high',
      source_ref: 'p4',
    });
    assert.equal(line?.origin, 'explicit');
  });

  it('normalizeAiLine maps unknown category to 其他', () => {
    const line = normalizeAiLine({
      category: '乱七八糟',
      material_name: 'x',
      unit: '个',
      qty_net: 1,
      confidence: 'medium',
    });
    assert.equal(line?.category, '其他');
  });
});
