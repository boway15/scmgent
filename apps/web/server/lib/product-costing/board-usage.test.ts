import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  boardUsageAreaM2,
  inferLineSubstrate,
  pieceAreaM2,
  resolvePricingMaterialName,
  sheetUnitPriceToM2,
  standardSheetAreaM2,
  USABLE_SHEET_MM,
} from './board-usage.js';

describe('board usage area', () => {
  it('reads cut area from thickness + L×W spec', () => {
    assert.equal(pieceAreaM2('18mm 1200×400'), 0.48);
    assert.equal(pieceAreaM2('9mm'), null);
  });

  it('totals piece area with qty and loss', () => {
    assert.equal(boardUsageAreaM2('18mm 1200×400', 2, 0.08), 1.0368);
  });

  it('converts sheet price to m² using standard board size', () => {
    const sheetM2 = standardSheetAreaM2();
    assert.ok(Math.abs(sheetM2 - 2.9768) < 0.001);
    assert.ok(Math.abs(sheetUnitPriceToM2(68) - 68 / sheetM2) < 0.01);
  });

  it('keeps usable nesting size smaller than purchased sheet', () => {
    assert.equal(USABLE_SHEET_MM.width, 1200);
    assert.equal(USABLE_SHEET_MM.length, 2400);
  });

  it('maps structure parts to default substrate for pricing', () => {
    assert.equal(resolvePricingMaterialName('侧板', '颗粒板'), '颗粒板');
    assert.equal(resolvePricingMaterialName('胡桃色板', '颗粒板'), '胡桃色板');
  });

  it('defaults 背板/抽底 to 密度板 and other structure parts to the project substrate', () => {
    assert.equal(inferLineSubstrate('抽底', '颗粒板'), '密度板');
    assert.equal(inferLineSubstrate('背板', '颗粒板'), '密度板');
    assert.equal(inferLineSubstrate('侧板', '颗粒板'), '颗粒板');
    assert.equal(inferLineSubstrate('背拉条', '颗粒板'), '颗粒板');
  });
});
