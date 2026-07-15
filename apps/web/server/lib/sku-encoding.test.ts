import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkuCode, spuFieldsFromParse, skuEncodingToColumns, type SkuKind } from './sku-encoding.js';

describe('parseSkuCode', () => {
  it('parses standard internal 9-digit code', () => {
    const r = parseSkuCode('704576101');
    assert.equal(r.kind, 'standard');
    assert.equal(r.valid, true);
    assert.equal(r.spuCode, '7045761');
    assert.equal(r.divisionCode, '7');
    assert.equal(r.distributionNo, 0);
    assert.equal(r.spuNumericCode, '45761');
    assert.equal(r.variantNo, '01');
    assert.equal(r.divisionName, '宠物');
  });

  it('parses external standard 15-char code', () => {
    const r = parseSkuCode('', 'PETOY704576101A');
    assert.equal(r.kind, 'standard');
    assert.equal(r.valid, true);
    assert.equal(r.internalCode, '704576101');
    assert.equal(r.brandCode, 'PE');
    assert.equal(r.categoryCode, 'TOY');
    assert.equal(r.factorySuffix, 'A');
    assert.equal(r.spuCode, '7045761');
  });

  it('parses accessory internal code', () => {
    const r = parseSkuCode('704576101P01');
    assert.equal(r.kind, 'accessory');
    assert.equal(r.valid, true);
    assert.equal(r.accessoryNo, '01');
    assert.equal(r.spuCode, '7045761');
  });

  it('parses multi-box internal code', () => {
    const r = parseSkuCode('704576101B1');
    assert.equal(r.kind, 'multi_box');
    assert.equal(r.boxNo, '1');
    assert.equal(r.spuCode, '7045761');
  });

  it('parses return internal code', () => {
    const r = parseSkuCode('704576101R');
    assert.equal(r.kind, 'return');
    assert.equal(r.spuCode, '7045761');
  });

  it('rejects invalid division', () => {
    const r = parseSkuCode('904576101');
    assert.equal(r.valid, false);
    assert.ok(r.warnings.some((w) => w.includes('事业部')));
  });

  it('parses legacy DJ standard SKU DJ502313_34', () => {
    const r = parseSkuCode('DJ502313_34');
    assert.equal(r.kind, 'standard');
    assert.equal(r.valid, true);
    assert.equal(r.legacyFormat, 'dj_standard');
    assert.equal(r.spuCode, 'DJ502313');
    assert.equal(r.spuNumericCode, '502313');
    assert.equal(r.variantNo, '34');
    assert.equal(r.divisionCode, '1');
    assert.equal(r.divisionName, '大件');
  });

  it('parses legacy WFDJ standard SKU variants under one SPU', () => {
    for (const variant of ['1', '2', '3', '4', '5']) {
      const r = parseSkuCode(`WFDJ505212_${variant}`);
      assert.equal(r.kind, 'standard', variant);
      assert.equal(r.valid, true, variant);
      assert.equal(r.legacyFormat, 'dj_standard', variant);
      assert.equal(r.spuCode, 'WFDJ505212', variant);
      assert.equal(r.spuNumericCode, '505212', variant);
      assert.equal(r.variantNo, variant, variant);
      assert.equal(r.divisionCode, '1', variant);
      assert.equal(r.divisionName, '大件', variant);
    }
  });

  it('parses legacy DJ SKU-level accessory DJ478585_2P02', () => {
    const r = parseSkuCode('DJ478585_2P02');
    assert.equal(r.kind, 'accessory');
    assert.equal(r.valid, true);
    assert.equal(r.legacyFormat, 'dj_sku_accessory');
    assert.equal(r.spuCode, 'DJ478585');
    assert.equal(r.variantNo, '2');
    assert.equal(r.accessoryNo, '02');
    assert.equal(r.parentSkuCode, 'DJ478585_2');
    assert.equal(r.accessoryScope, 'sku');
  });

  it('parses legacy DJ SPU universal accessory DJ485882P01', () => {
    const r = parseSkuCode('DJ485882P01');
    assert.equal(r.kind, 'accessory');
    assert.equal(r.valid, true);
    assert.equal(r.legacyFormat, 'dj_spu_accessory');
    assert.equal(r.spuCode, 'DJ485882');
    assert.equal(r.accessoryNo, '01');
    assert.equal(r.accessoryScope, 'spu');
    assert.equal(r.parentSkuCode, null);
    assert.equal(r.variantNo, null);
  });

  it('parses legacy DJ AB-box SKU DJ505240_2_A / _B', () => {
    const a = parseSkuCode('DJ505240_2_A');
    assert.equal(a.kind, 'multi_box');
    assert.equal(a.valid, true);
    assert.equal(a.legacyFormat, 'dj_multi_box');
    assert.equal(a.spuCode, 'DJ505240');
    assert.equal(a.variantNo, '2');
    assert.equal(a.boxNo, 'A');
    assert.equal(a.parentSkuCode, 'DJ505240_2');

    const b = parseSkuCode('DJ505240_2_B');
    assert.equal(b.boxNo, 'B');
    assert.equal(b.kind, 'multi_box');
  });

  it('parses legacy DJR prefix AB-box SKU', () => {
    const r = parseSkuCode('DJR505229_1_A');
    assert.equal(r.kind, 'multi_box');
    assert.equal(r.valid, true);
    assert.equal(r.spuCode, 'DJR505229');
    assert.equal(r.boxNo, 'A');
    assert.equal(r.brandCode, 'DJR');
  });

  it('parses user-provided legacy SKU samples', () => {
    const samples: Array<[string, SkuKind, string]> = [
      ['DJ504649_3P19', 'accessory', 'dj_sku_accessory'],
      ['DJ505387_2P01', 'accessory', 'dj_sku_accessory'],
      ['DJ505787_2', 'standard', 'dj_standard'],
      ['100104703', 'standard', ''],
      ['DJ506016_1_B', 'multi_box', 'dj_multi_box'],
    ];
    for (const [code, kind, fmt] of samples) {
      const r = parseSkuCode(code);
      assert.equal(r.kind, kind, code);
      assert.equal(r.valid, true, code);
      if (fmt) assert.equal(r.legacyFormat, fmt, code);
    }
  });

  it('marks unknown legacy codes', () => {
    const r = parseSkuCode('UNKNOWN-CODE-XYZ');
    assert.equal(r.kind, 'legacy');
    assert.equal(r.valid, false);
    assert.equal(r.spuCode, null);
  });
});

describe('spuFieldsFromParse', () => {
  it('builds SPU fields from legacy DJ SKU', () => {
    const parse = parseSkuCode('DJ502313_34');
    const fields = spuFieldsFromParse(parse, '大件商品');
    assert.ok(fields);
    assert.equal(fields.code, 'DJ502313');
    assert.equal(fields.spuNumericCode, '502313');
    assert.equal(fields.spuNumericCode.length, 6);
    assert.equal(fields.divisionName, '大件');
  });
  it('maps 6-digit legacy spu numeric into sku columns', () => {
    const parse = parseSkuCode('DJ502313_34');
    const cols = skuEncodingToColumns(parse);
    assert.equal(cols.spuNumericCode, '502313');
  });
  it('supports legacy variant longer than 2 digits', () => {
    const parse = parseSkuCode('DJ502313_342');
    const cols = skuEncodingToColumns(parse);
    assert.equal(cols.variantNo, '342');
    assert.equal(cols.spuNumericCode, '502313');
  });
  it('builds SPU fields from standard SKU', () => {
    const parse = parseSkuCode('704576101');
    const fields = spuFieldsFromParse(parse, '宠物玩具 A');
    assert.ok(fields);
    assert.equal(fields.code, '7045761');
    assert.equal(fields.divisionCode, '7');
    assert.equal(fields.encodingSource, 'sku_derived');
  });
});
