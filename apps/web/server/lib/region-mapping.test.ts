import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isMappableRegion,
  invalidateRegionMappingCache,
  loadRegionMappingTables,
  resolveInboundSalesRegion,
  resolveSalesRegion,
  resolveSalesRowRegion,
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

  it('loads mapping tables and drops the cache on invalidate', async () => {
    invalidateRegionMappingCache();
    let salesRegion = 'eu';
    const db = {
      select(shape: Record<string, unknown>) {
        return {
          from: async () => {
            if ('station' in shape) {
              return [
                { station: ' Amazon德国 ', salesRegion },
                { station: 'skip', salesRegion: 'UNMAPPED' },
              ];
            }
            return [{ warehouseCode: ' US-EAST ', fulfillmentRegion: 'US' }];
          },
        };
      },
    };

    const first = await loadRegionMappingTables(db);
    assert.equal(first.stations.get('Amazon德国'), 'EU');
    assert.equal(first.stations.has('skip'), false);
    assert.equal(resolveFulfillmentRegion('US-EAST', first), 'US');

    salesRegion = 'UK';
    const cached = await loadRegionMappingTables(db);
    assert.equal(cached.stations.get('Amazon德国'), 'EU');

    invalidateRegionMappingCache();
    const refreshed = await loadRegionMappingTables(db);
    assert.equal(refreshed.stations.get('Amazon德国'), 'UK');
    invalidateRegionMappingCache();
  });

  it('does not write a load back after invalidate during the query', async () => {
    invalidateRegionMappingCache();
    let releaseWarehouse: (() => void) | undefined;
    const warehouseGate = new Promise<void>((resolve) => {
      releaseWarehouse = resolve;
    });
    let warehouseReads = 0;
    const db = {
      select(shape: Record<string, unknown>) {
        return {
          from: async () => {
            if ('station' in shape) {
              return [{ station: 'Amazon德国', salesRegion: 'EU' }];
            }
            warehouseReads += 1;
            const read = warehouseReads;
            if (read === 1) await warehouseGate;
            return [{ warehouseCode: 'US-EAST', fulfillmentRegion: read === 1 ? 'EU' : 'US' }];
          },
        };
      },
    };

    const inflight = loadRegionMappingTables(db);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(warehouseReads, 1);

    invalidateRegionMappingCache();
    const fresh = await loadRegionMappingTables(db);
    assert.equal(fresh.warehouses.get('US-EAST'), 'US');

    releaseWarehouse?.();
    const stale = await inflight;
    assert.equal(stale.warehouses.get('US-EAST'), 'EU');

    const cached = await loadRegionMappingTables(db);
    assert.equal(cached.warehouses.get('US-EAST'), 'US');
    assert.equal(warehouseReads, 2);
    invalidateRegionMappingCache();
  });

  it('falls back to UNMAPPED without guessing', () => {
    assert.equal(resolveSalesRegion('Amazon比利时', tables), 'UNMAPPED');
    assert.equal(resolveSalesRegion('美国', tables), 'UNMAPPED');
    assert.equal(resolveFulfillmentRegion('CA-TORONTO', tables), 'UNMAPPED');
    assert.equal(resolveSalesRegion(null, tables), 'UNMAPPED');
  });

  it('resolves inbound sales region: row label first, else station map, else null', () => {
    assert.equal(resolveInboundSalesRegion('欧洲', 'Amazon美国', tables), 'EU');
    assert.equal(resolveInboundSalesRegion('', 'Amazon德国', tables), 'EU');
    assert.equal(resolveInboundSalesRegion(null, '未知站', tables), null);
  });

  it('accepts MX and BR as mappable regions', () => {
    assert.equal(isMappableRegion('MX'), true);
    assert.equal(isMappableRegion('BR'), true);
  });

  it('resolveSalesRowRegion prefers row sales_region over station map', () => {
    assert.equal(
      resolveSalesRowRegion({ salesRegion: 'US', station: 'Amazon德国' }, tables),
      'US',
    );
    assert.equal(resolveSalesRowRegion({ salesRegion: null, station: 'Amazon德国' }, tables), 'EU');
    assert.equal(
      resolveSalesRowRegion({ salesRegion: 'UNMAPPED', station: 'Amazon德国' }, tables),
      'UNMAPPED',
    );
  });
});
