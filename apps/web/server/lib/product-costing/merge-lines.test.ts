import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeBomLines } from './merge-lines.js';

describe('mergeBomLines', () => {
  it('sums qty for same material+spec+unit', () => {
    const merged = mergeBomLines([
      {
        category: '板材',
        materialName: '多层板',
        spec: '18mm',
        unit: '张',
        qtyNet: 1,
        lossRate: 0.1,
        sourceRef: 'p1',
        confidence: 'high',
        notes: '',
      },
      {
        category: '板材',
        materialName: '多层板',
        spec: '18mm',
        unit: '张',
        qtyNet: 2,
        lossRate: 0.1,
        sourceRef: 'p2',
        confidence: 'low',
        notes: '',
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].qtyNet, 3);
    assert.equal(merged[0].confidence, 'low');
    assert.match(merged[0].sourceRef ?? '', /p1/);
  });
});
