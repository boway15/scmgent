import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideWarehouseCandidate,
  resolveMoqByPriority,
  shouldReplenishWithLinkage,
} from './evaluate.js';

describe('resolveMoqByPriority', () => {
  it('sku_then_spu matches legacy resolveEffectiveMoq', () => {
    assert.equal(resolveMoqByPriority(50, 100, 'sku_then_spu'), 50);
    assert.equal(resolveMoqByPriority(0, 100, 'sku_then_spu'), 100);
    assert.equal(resolveMoqByPriority(null, null, 'sku_then_spu'), 0);
  });
  it('spu_then_sku and max', () => {
    assert.equal(resolveMoqByPriority(50, 100, 'spu_then_sku'), 100);
    assert.equal(resolveMoqByPriority(50, null, 'spu_then_sku'), 50);
    assert.equal(resolveMoqByPriority(50, 100, 'max'), 100);
  });
  it('unknown priority falls back to sku_then_spu', () => {
    assert.equal(resolveMoqByPriority(50, 100, 'zzz'), 50);
  });
});

describe('decideWarehouseCandidate', () => {
  const base = {
    coverageHealth: 'red' as const,
    decisionHealth: 'red' as const,
    deferredByUsNetwork: false,
    suggestedQty: 120,
    moq: 0,
  };
  it('gray coverage light → skip', () => {
    const r = decideWarehouseCandidate({ ...base, coverageHealth: 'gray' });
    assert.equal(r.include, false);
  });
  it('US deferred → skip', () => {
    assert.equal(decideWarehouseCandidate({ ...base, deferredByUsNetwork: true }).include, false);
  });
  it('green decision → skip', () => {
    assert.equal(decideWarehouseCandidate({ ...base, decisionHealth: 'green' }).include, false);
  });
  it('qty 0 → skip', () => {
    assert.equal(decideWarehouseCandidate({ ...base, suggestedQty: 0 }).include, false);
  });
  it('MOQ lifts and is reported', () => {
    const r = decideWarehouseCandidate({ ...base, moq: 200 });
    assert.deepEqual([r.include, r.qty, r.moqApplied], [true, 200, true]);
    assert.ok(r.trace.some((t) => t.rule === 'moq'));
  });
});

describe('shouldReplenishWithLinkage', () => {
  it('linkage on: yellow only with red in same SPU', () => {
    const input = { replenishLight: 'yellow' as const, needsReplenishment: true, yellowLightLinkage: true };
    assert.equal(shouldReplenishWithLinkage({ ...input, spuHasRedNeedingReplenishment: false }), false);
    assert.equal(shouldReplenishWithLinkage({ ...input, spuHasRedNeedingReplenishment: true }), true);
  });
  it('linkage off: yellow acts like red', () => {
    assert.equal(
      shouldReplenishWithLinkage({
        replenishLight: 'yellow',
        needsReplenishment: true,
        spuHasRedNeedingReplenishment: false,
        yellowLightLinkage: false,
      }),
      true,
    );
  });
  it('green never', () => {
    assert.equal(
      shouldReplenishWithLinkage({
        replenishLight: 'green',
        needsReplenishment: true,
        spuHasRedNeedingReplenishment: true,
        yellowLightLinkage: false,
      }),
      false,
    );
  });
});
