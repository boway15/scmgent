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
  it('adds all cabinet slots for chest and bedside cabinets', () => {
    const expected = ['侧板', '顶底板', '背板', '抽面', '抽侧', '抽底'];
    assert.deepEqual(
      applyCategoryTemplate('斗柜', []).map((item) => item.materialName),
      expected,
    );
    assert.deepEqual(
      applyCategoryTemplate('床头柜', []).map((item) => item.materialName),
      expected,
    );
  });

  it('does not add a side panel when an existing name contains it', () => {
    const result = applyCategoryTemplate('斗柜', [line('左侧板')]);
    assert.equal(result.filter((item) => item.materialName.includes('侧板')).length, 1);
    assert.equal(result.length, 6);
  });

  it('does not add rows for empty or other categories', () => {
    assert.deepEqual(applyCategoryTemplate(null, []), []);
    assert.deepEqual(applyCategoryTemplate('', []), []);
    assert.deepEqual(applyCategoryTemplate('其他', []), []);
  });

  it('adds desk top, side panel, and drawer box without hardware', () => {
    const result = applyCategoryTemplate('书桌', []);
    assert.deepEqual(
      result.map((item) => item.materialName),
      ['桌面', '侧板', '抽盒'],
    );
    assert.ok(result.every((item) => item.category === '板材'));
  });

  it('adds vanity top, side panel, and drawer box', () => {
    assert.deepEqual(
      applyCategoryTemplate('梳妆台', []).map((item) => item.materialName),
      ['台面', '侧板', '抽盒'],
    );
  });
});
