import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dedupeDraftsByMaterialName, hasConfirmedPanelThickness, indexBomLinesByMaterialName } from './sync-bom-lines.js';
import type { CostingBomLineDraft } from './types.js';

describe('hasConfirmedPanelThickness', () => {
  it('returns true when any thickness field is set', () => {
    assert.equal(hasConfirmedPanelThickness({ carcassThicknessMm: 12 }), true);
    assert.equal(hasConfirmedPanelThickness({}), false);
  });
});

describe('indexBomLinesByMaterialName', () => {
  it('prefers non-manual row id when duplicate material names exist', () => {
    const indexed = indexBomLinesByMaterialName([
      {
        id: 'manual-id',
        materialName: '前拉条',
        unitPriceOverride: null,
        isManual: true,
        processOverrides: {},
        substrate: null,
        extractSnapshot: { materialName: '前拉条', spec: '18mm', qtyNet: 0, origin: 'template', sourceRef: null },
      },
      {
        id: 'explicit-id',
        materialName: '前拉条',
        unitPriceOverride: null,
        isManual: false,
        processOverrides: {},
        substrate: null,
        extractSnapshot: { materialName: '前拉条', spec: '12mm 1576×50', qtyNet: 4, origin: 'explicit', sourceRef: 'p5' },
      },
    ]);
    assert.equal(indexed.get('前拉条')?.id, 'explicit-id');
  });
});

describe('dedupeDraftsByMaterialName', () => {
  const draft = (
    overrides: Partial<CostingBomLineDraft> & Pick<CostingBomLineDraft, 'materialName'>,
  ): CostingBomLineDraft => ({
    category: '五金',
    spec: '',
    unit: '套',
    qtyNet: 0,
    lossRate: 0.08,
    sourceRef: 'p4',
    confidence: 'high',
    origin: 'explicit',
    notes: '',
    ...overrides,
  });

  it('keeps the row with qty and richer spec for duplicate names', () => {
    const result = dedupeDraftsByMaterialName([
      draft({ materialName: '抽屉滑轨', spec: '2节 12寸 滚珠滑轨', qtyNet: 0 }),
      draft({ materialName: '抽屉滑轨', spec: '2节12寸', qtyNet: 9, sourceRef: 'p5' }),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.qtyNet, 9);
    assert.equal(result[0]?.spec, '2节12寸');
  });
});
