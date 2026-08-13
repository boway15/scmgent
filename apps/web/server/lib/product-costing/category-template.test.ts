import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyCategoryTemplate } from './category-template.js';
import type { CostingBomLineDraft } from './types.js';

const line = (materialName: string): CostingBomLineDraft => ({
  category: '板材',
  materialName,
  spec: '',
  unit: '块',
  qtyNet: 1,
  lossRate: 0,
  sourceRef: 'p2',
  confidence: 'high',
  origin: 'explicit',
  notes: '',
});

describe('applyCategoryTemplate', () => {
  it('adds a missing side panel template row for a chest of drawers', () => {
    const result = applyCategoryTemplate('斗柜', []);
    const sidePanel = result.find((item) => item.materialName === '侧板');
    assert.deepEqual(sidePanel, {
      category: '板材',
      materialName: '侧板',
      spec: '',
      unit: '块',
      qtyNet: 0,
      lossRate: 0,
      sourceRef: '',
      confidence: 'low',
      origin: 'template',
      notes: '用量待补',
    });
  });

  it('does not add a side panel when an existing name contains it', () => {
    const result = applyCategoryTemplate('斗柜', [line('左侧板')]);
    assert.equal(result.length, 1);
  });

  it('does not add rows for an empty or unsupported category', () => {
    assert.deepEqual(applyCategoryTemplate(null, []), []);
    assert.deepEqual(applyCategoryTemplate('衣柜', []), []);
  });

  it('adds desk top, side panel, and drawer box without hardware', () => {
    const result = applyCategoryTemplate('书桌', []);
    assert.deepEqual(
      result.map((item) => item.materialName),
      ['桌面', '侧板', '抽盒'],
    );
    assert.ok(result.every((item) => item.category === '板材'));
  });
});
