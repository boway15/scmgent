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
    const expected = ['侧板', '顶底板', '背板', '抽面', '抽侧', '抽后', '抽底', '前拉条', '背拉条', '落地拉条'];
    assert.deepEqual(
      applyCategoryTemplate('斗柜', []).map((item) => item.materialName),
      expected,
    );
    assert.deepEqual(
      applyCategoryTemplate('床头柜', []).map((item) => item.materialName),
      expected,
    );
  });

  it('treats 桌面板 as filling the 顶底板 slot', () => {
    const result = applyCategoryTemplate('斗柜', [line('桌面板')]);
    assert.equal(result.some((item) => item.materialName === '顶底板'), false);
    assert.equal(result.length, 10);
  });

  it('does not add a side panel when an existing name contains it', () => {
    const result = applyCategoryTemplate('斗柜', [line('左侧板')]);
    assert.equal(result.filter((item) => item.materialName.includes('侧板')).length, 1);
    assert.equal(result.length, 10);
  });

  it('treats aliased 正面拉条 as filling the 前拉条 slot', () => {
    const result = applyCategoryTemplate('斗柜', [line('正面拉条')]);
    assert.equal(result.some((item) => item.materialName === '前拉条'), false);
    assert.equal(result.length, 10);
  });

  it('treats misnamed substrate drawer cut as filling the 抽面 slot', () => {
    const result = applyCategoryTemplate(
      '斗柜',
      [
        {
          ...line('颗粒板'),
          spec: '12mm 521×210',
          qtyNet: 9,
        },
      ],
      { overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 } },
    );
    assert.equal(result.some((item) => item.materialName === '抽面'), false);
    assert.equal(result.length, 10);
  });

  it('does not add rows for empty or other categories', () => {
    assert.deepEqual(applyCategoryTemplate(null, []), []);
    assert.deepEqual(applyCategoryTemplate('', []), []);
    assert.deepEqual(applyCategoryTemplate('其他', []), []);
    assert.deepEqual(applyCategoryTemplate('床', []), []);
    assert.deepEqual(applyCategoryTemplate('椅子', []), []);
  });

  it('adds desk structure slots without hardware', () => {
    const result = applyCategoryTemplate('书桌', []);
    assert.ok(result.some((item) => item.materialName === '桌面'));
    assert.ok(result.some((item) => item.materialName === '横撑'));
    assert.deepEqual(
      applyCategoryTemplate('桌子', []).map((item) => item.materialName),
      result.map((item) => item.materialName),
    );
    assert.deepEqual(
      result.map((item) => item.materialName),
      ['桌面', '侧板', '横撑', '抽面', '抽侧', '抽底'],
    );
    assert.ok(result.every((item) => item.category === '板材'));
  });

  it('adds vanity structure slots', () => {
    assert.deepEqual(
      applyCategoryTemplate('梳妆台', []).map((item) => item.materialName),
      ['台面', '侧板', '抽面', '抽侧', '抽底'],
    );
  });
});
