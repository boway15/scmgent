import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeCarcassCuts, frontRailCount, inferDefaultDrawerFrontSize, inferDrawerGrid, resolveFrontRailQty } from './carcass-cut-rules.js';

describe('inferDrawerGrid', () => {
  it('uses 3×3 for nine drawers and 2×3 for six', () => {
    assert.deepEqual(inferDrawerGrid(9), { cols: 3, rows: 3 });
    assert.deepEqual(inferDrawerGrid(6), { cols: 2, rows: 3 });
  });
});

describe('inferDefaultDrawerFrontSize', () => {
  it('estimates one cell size instead of full cabinet width', () => {
    assert.deepEqual(
      inferDefaultDrawerFrontSize({
        widthMm: 1600,
        heightMm: 785,
        sideThicknessMm: 18,
        drawerCount: 9,
      }),
      { widthMm: 527, heightMm: 251 },
    );
  });
});

describe('frontRailCount', () => {
  it('uses ceil((n-2)/2) and zero for 1-2 drawers', () => {
    assert.equal(frontRailCount(1), 0);
    assert.equal(frontRailCount(2), 0);
    assert.equal(frontRailCount(3), 1);
    assert.equal(frontRailCount(4), 1);
    assert.equal(frontRailCount(5), 2);
    assert.equal(frontRailCount(6), 2);
    assert.equal(frontRailCount(7), 3);
    assert.equal(frontRailCount(8), 3);
    assert.equal(frontRailCount(9), 4);
  });
});

describe('resolveFrontRailQty', () => {
  it('prefers explosion explicit count over formula', () => {
    const result = resolveFrontRailQty(
      [{ materialName: '前拉条', origin: 'explicit', qtyNet: 4 }],
      6,
    );
    assert.equal(result.qty, 4);
    assert.equal(result.source, 'explicit');
    assert.equal(result.formulaQty, 2);
  });

  it('falls back to formula when no explicit qty', () => {
    const result = resolveFrontRailQty(
      [{ materialName: '前拉条', origin: 'template', qtyNet: 0 }],
      9,
    );
    assert.equal(result.qty, 4);
    assert.equal(result.source, 'formula');
    assert.equal(result.explicitQty, null);
  });
});

describe('computeCarcassCuts', () => {
  it('defaults to covering top, floor-standing sides, and drawer formulas', () => {
    const cuts = computeCarcassCuts({
      widthMm: 1200,
      depthMm: 400,
      heightMm: 785,
      sideThicknessMm: 18,
      drawerCount: 6,
      drawerFrontWidthMm: 1200,
      drawerFrontHeightMm: 121,
    });
    assert.deepEqual(cuts.top, { lengthMm: 1200, widthMm: 400, qty: 1 });
    assert.equal(cuts.bottom, null);
    assert.deepEqual(cuts.floorRails, { lengthMm: 1164, widthMm: 50, qty: 2 });
    assert.equal(cuts.frontRails.qty, 2);
    assert.deepEqual(cuts.drawerSide, { lengthMm: 350, widthMm: 61, qty: 12 });
    assert.deepEqual(cuts.drawerBottom, { lengthMm: 350, widthMm: 1155, qty: 6 });
    assert.deepEqual(cuts.drawerBack, { lengthMm: 1155, widthMm: 61, qty: 6 });
    assert.equal(cuts.backRail?.qty, 1);
    assert.equal(cuts.back.qty, 2);
  });
});
