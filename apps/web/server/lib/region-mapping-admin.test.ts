import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMappableRegion } from './region-codes.js';
import { resolveSalesRegion, type RegionMappingTables } from './region-mapping.js';
import {
  parseMappingCsv,
  parseStationMappingBody,
  parseWarehouseMappingBody,
} from './region-mapping-admin.js';

describe('region mapping target', () => {
  it('rejects UNMAPPED as mapping target', () => {
    assert.equal(parseMappableRegion('UNMAPPED'), null);
    assert.equal(parseMappableRegion('eu'), 'EU');
  });

  it('rejects UNMAPPED on station and warehouse writes', () => {
    const station = parseStationMappingBody({ station: 'Amazon德国', salesRegion: 'UNMAPPED' });
    const warehouse = parseWarehouseMappingBody({
      warehouseCode: 'CA-TORONTO',
      fulfillmentRegion: 'unmapped',
    });
    assert.equal(station.ok, false);
    assert.equal(warehouse.ok, false);
  });

  it('accepts a mappable station write', () => {
    const parsed = parseStationMappingBody({ station: ' Amazon德国 ', salesRegion: 'eu' });
    assert.deepEqual(parsed, { ok: true, station: 'Amazon德国', salesRegion: 'EU' });
  });

  it('rejects a CSV that targets UNMAPPED', () => {
    const parsed = parseMappingCsv('station,sales_region\nAmazon德国,UNMAPPED\n', 'station');
    assert.equal(parsed.ok, false);
  });

  it('parses a station CSV', () => {
    const parsed = parseMappingCsv(
      'station,sales_region\n"Amazon德国",EU\nwayfair英国,uk\n',
      'station',
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.rows, [
      { key: 'Amazon德国', region: 'EU' },
      { key: 'wayfair英国', region: 'UK' },
    ]);
  });

  it('maps a station to EU and falls back to UNMAPPED after delete', () => {
    const tables: RegionMappingTables = { stations: new Map(), warehouses: new Map() };
    assert.equal(resolveSalesRegion('Amazon德国', tables), 'UNMAPPED');
    tables.stations.set('Amazon德国', 'EU');
    assert.equal(resolveSalesRegion('Amazon德国', tables), 'EU');
    tables.stations.delete('Amazon德国');
    assert.equal(resolveSalesRegion('Amazon德国', tables), 'UNMAPPED');
  });
});
