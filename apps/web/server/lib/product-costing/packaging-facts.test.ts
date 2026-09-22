import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  boxSurfaceM2,
  foamVolumeM3,
  packagingOuterSize,
  upsertPackagingLines,
} from './packaging-facts.js';

describe('packaging facts', () => {
  it('uses six-face area for foam volume and carton sqm', () => {
    const outer = { widthMm: 1760, depthMm: 515, heightMm: 215 };
    assert.equal(boxSurfaceM2(outer), 2.7911);
    assert.equal(foamVolumeM3(outer), 0.0558);
  });

  it('outer size still adds 80mm per side', () => {
    const outer = packagingOuterSize({ widthMm: 1200, depthMm: 400, heightMm: 785 });
    assert.deepEqual(outer, { widthMm: 1280, depthMm: 480, heightMm: 865 });
  });

  it('upserts corner, foam m³ and carton m²', () => {
    const lines = upsertPackagingLines([], {
      widthMm: 1680,
      depthMm: 435,
      heightMm: 135,
    });
    assert.equal(lines.find((row) => row.materialName === '纸护角')?.qtyNet, 4);
    assert.equal(lines.find((row) => row.materialName === '纸护角')?.unit, '个');
    const foam = lines.find((row) => row.materialName === '保利龙');
    assert.equal(foam?.unit, 'm³');
    assert.equal(foam?.qtyNet, foamVolumeM3({ widthMm: 1760, depthMm: 515, heightMm: 215 }));
    const carton = lines.find((row) => row.materialName === '纸箱');
    assert.equal(carton?.unit, 'm²');
    assert.equal(carton?.qtyNet, boxSurfaceM2({ widthMm: 1760, depthMm: 515, heightMm: 215 }));
  });

  it('does nothing without overall size', () => {
    assert.equal(upsertPackagingLines([]).length, 0);
  });

  it('drops LLM pack rows when overall size is missing', () => {
    const lines = upsertPackagingLines([
      {
        category: '包装',
        materialName: '保利龙',
        spec: '1680×480×865',
        unit: 'm³',
        qtyNet: 0.6975,
        lossRate: 0,
        sourceRef: '',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
      },
    ]);
    assert.equal(lines.length, 0);
  });
});
