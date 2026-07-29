import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapSapMaterialToSku } from './map-sku.js';

describe('mapSapMaterialToSku', () => {
  it('maps materialId to externalId and code', () => {
    const mapped = mapSapMaterialToSku({
      materialId: 'MAT-10001',
      name: 'EU KM 箱式液压床',
      unit: 'PC',
    });

    assert.deepEqual(mapped, {
      sourceSystem: 'sap',
      externalId: 'MAT-10001',
      code: 'MAT-10001',
      name: 'EU KM 箱式液压床',
      unit: 'PC',
    });
  });

  it('defaults unit to EA when omitted', () => {
    const mapped = mapSapMaterialToSku({
      materialId: 'MAT-10001',
      name: 'Sample SKU',
    });

    assert.equal(mapped.unit, 'EA');
  });

  it('trims material fields', () => {
    const mapped = mapSapMaterialToSku({
      materialId: ' MAT-10001 ',
      name: ' Sample ',
      unit: ' KG ',
    });

    assert.equal(mapped.externalId, 'MAT-10001');
    assert.equal(mapped.code, 'MAT-10001');
    assert.equal(mapped.name, 'Sample');
    assert.equal(mapped.unit, 'KG');
  });

  it('throws when materialId or name is missing', () => {
    assert.throws(
      () => mapSapMaterialToSku({ materialId: '', name: 'X' }),
      /materialId is required/,
    );
    assert.throws(
      () => mapSapMaterialToSku({ materialId: 'M1', name: '' }),
      /name is required/,
    );
  });
});
