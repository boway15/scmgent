import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isMappableRegion,
  resolveSalesRegion,
  resolveFulfillmentRegion,
  type RegionMappingTables,
} from './region-mapping.js';

const tables: RegionMappingTables = {
  stations: new Map([
    ['Amazon德国', 'EU'],
    ['wayfair英国', 'UK'],
  ]),
  warehouses: new Map([
    ['US-EAST', 'US'],
    ['PLATFORM-EU', 'EU'],
  ]),
};

describe('region-mapping', () => {
  it('rejects UNMAPPED as mappable', () => {
    assert.equal(isMappableRegion('UNMAPPED'), false);
    assert.equal(isMappableRegion('US'), true);
    assert.equal(isMappableRegion('OTHER'), true);
  });

  it('resolves mapped station and warehouse', () => {
    assert.equal(resolveSalesRegion('Amazon德国', tables), 'EU');
    assert.equal(resolveFulfillmentRegion('US-EAST', tables), 'US');
  });

  it('falls back to UNMAPPED without guessing', () => {
    assert.equal(resolveSalesRegion('Amazon比利时', tables), 'UNMAPPED');
    assert.equal(resolveSalesRegion('美国', tables), 'UNMAPPED');
    assert.equal(resolveFulfillmentRegion('CA-TORONTO', tables), 'UNMAPPED');
    assert.equal(resolveSalesRegion(null, tables), 'UNMAPPED');
  });
});
