import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapSapVendorToMerchant } from './map-merchant.js';

describe('mapSapVendorToMerchant', () => {
  it('maps vendorId to externalId and uses code when provided', () => {
    const mapped = mapSapVendorToMerchant({
      vendorId: '0000100001',
      name: 'Acme Supplies',
      code: 'SUP23111300027',
    });

    assert.deepEqual(mapped, {
      sourceSystem: 'sap',
      externalId: '0000100001',
      code: 'SUP23111300027',
      name: 'Acme Supplies',
    });
  });

  it('falls back code to vendorId when code is omitted', () => {
    const mapped = mapSapVendorToMerchant({
      vendorId: '0000100001',
      name: 'Acme Supplies',
    });

    assert.equal(mapped.code, '0000100001');
    assert.equal(mapped.externalId, '0000100001');
  });

  it('trims whitespace from ids and names', () => {
    const mapped = mapSapVendorToMerchant({
      vendorId: ' 0000100001 ',
      name: ' Acme Supplies ',
      code: ' SUP001 ',
    });

    assert.equal(mapped.externalId, '0000100001');
    assert.equal(mapped.name, 'Acme Supplies');
    assert.equal(mapped.code, 'SUP001');
  });

  it('throws when vendorId or name is missing', () => {
    assert.throws(
      () => mapSapVendorToMerchant({ vendorId: '', name: 'X' }),
      /vendorId is required/,
    );
    assert.throws(
      () => mapSapVendorToMerchant({ vendorId: 'V1', name: '  ' }),
      /name is required/,
    );
  });
});
