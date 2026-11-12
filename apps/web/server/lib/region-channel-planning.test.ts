import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bucketSalesByRegionPlatform,
  buildRegionChannelPlan,
  groupWarehousesByFulfillmentRegion,
  regionDemandDaily,
  regionPlatformKey,
  shouldDeferUsRegionUnit,
  sumHistoryQty,
  type RegionPlatformLeaf,
} from './region-channel-planning.js';
import type { RegionMappingTables } from './region-mapping.js';

const tables: RegionMappingTables = {
  stations: new Map([
    ['Amazon美国', 'US'],
    ['Amazon英国', 'UK'],
  ]),
  warehouses: new Map([
    ['US-WEST', 'US'],
    ['US-EAST', 'US'],
    ['UK-1', 'UK'],
  ]),
};

function leaf(daily: number): RegionPlatformLeaf {
  const now = new Date();
  const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    map: new Map([
      [key, daily],
      [nextKey, daily],
    ]),
  };
}

describe('region-channel-planning', () => {
  it('groups warehouses by fulfillment region and keeps UNMAPPED bucket', () => {
    const groups = groupWarehousesByFulfillmentRegion(
      [{ code: 'US-WEST' }, { code: 'UK-1' }, { code: 'US-EAST' }, { code: 'NEW-WH' }],
      tables,
    );
    assert.deepEqual(
      [...groups.keys()],
      ['US', 'UK', 'UNMAPPED'],
    );
    assert.deepEqual(groups.get('US')!.map((w) => w.code), ['US-WEST', 'US-EAST']);
    assert.deepEqual(groups.get('UNMAPPED')!.map((w) => w.code), ['NEW-WH']);
  });

  it('buckets sales by region x platform; unknown station falls to UNMAPPED', () => {
    const rows = [
      { qtySold: 1, saleDate: '2026-11-01', station: 'Amazon美国', channel: 'AMAZON' },
      { qtySold: 2, saleDate: '2026-11-01', station: 'Amazon英国', channel: 'WALMART' },
      { qtySold: 3, saleDate: '2026-11-01', station: '未知站', channel: 'AMAZON' },
      { qtySold: 4, saleDate: '2026-11-01', station: '', salesRegion: 'CA', channel: 'AMAZON' },
    ];
    const buckets = bucketSalesByRegionPlatform(rows, tables, (c) => (c ?? 'UNKNOWN').toUpperCase());
    assert.equal(buckets.get(regionPlatformKey('US', 'AMAZON'))?.length, 1);
    assert.equal(buckets.get(regionPlatformKey('UK', 'WALMART'))?.length, 1);
    assert.equal(buckets.get(regionPlatformKey('UNMAPPED', 'AMAZON'))?.[0]?.qtySold, 3);
    assert.equal(buckets.get(regionPlatformKey('CA', 'AMAZON'))?.[0]?.qtySold, 4);
  });

  it('sums history qty inside the share window only', () => {
    const asOf = new Date('2026-11-12T00:00:00.000Z');
    const qty = sumHistoryQty(
      [
        { qtySold: 5, saleDate: '2026-11-11' },
        { qtySold: 7, saleDate: '2026-08-20' },
        { qtySold: 100, saleDate: '2026-01-01' },
        { qtySold: 50, saleDate: '2026-11-12' },
      ],
      asOf,
      90,
    );
    assert.equal(qty, 12);
  });

  it('allocates region qty by forecast weights and conserves units', () => {
    const plan = buildRegionChannelPlan({
      fulfillmentRegion: 'US',
      regionQty: 101,
      leaves: new Map([
        ['AMAZON', leaf(8)],
        ['WALMART', leaf(2)],
      ]),
      historyQtyByPlatform: { AMAZON: 1, WALMART: 99 },
      historyDailyByPlatform: { AMAZON: 0.1, WALMART: 1 },
    });
    assert.equal(plan.channelShareSource, 'forecast');
    assert.equal(plan.units.length, 2);
    const total = plan.units.reduce((sum, u) => sum + u.allocatedQty, 0);
    assert.equal(total, 101);
    const amazon = plan.units.find((u) => u.platform === 'AMAZON')!;
    assert.equal(amazon.demandSource, 'published_leaf');
    assert.ok(amazon.allocatedQty > 70);
  });

  it('falls back to same-region same-channel history when no leaf', () => {
    const plan = buildRegionChannelPlan({
      fulfillmentRegion: 'UNMAPPED',
      regionQty: 10,
      leaves: new Map(),
      historyQtyByPlatform: { AMAZON: 30, WALMART: 70 },
      historyDailyByPlatform: { AMAZON: 0.33, WALMART: 0.77 },
    });
    assert.equal(plan.channelShareSource, 'history');
    assert.ok(plan.units.every((u) => u.demandSource === 'history' && u.leaf === null));
    assert.equal(plan.units.reduce((s, u) => s + u.allocatedQty, 0), 10);
    assert.ok(Math.abs(regionDemandDaily(plan) - 1.1) < 1e-9);
  });

  it('merges history-only channels into forecast weights instead of dropping them', () => {
    const plan = buildRegionChannelPlan({
      fulfillmentRegion: 'US',
      regionQty: 100,
      leaves: new Map([['AMAZON', leaf(5)]]),
      historyQtyByPlatform: { AMAZON: 10, TEMU: 40 },
      historyDailyByPlatform: { AMAZON: 0.1, TEMU: 5 },
    });
    assert.equal(plan.channelShareSource, 'forecast');
    assert.deepEqual(plan.historyMergedPlatforms, ['TEMU']);
    const temu = plan.units.find((u) => u.platform === 'TEMU')!;
    assert.equal(temu.demandSource, 'history');
    assert.equal(plan.units.reduce((s, u) => s + u.allocatedQty, 0), 100);
  });

  it('returns no units when region has neither leaf nor history', () => {
    const plan = buildRegionChannelPlan({
      fulfillmentRegion: 'MX',
      regionQty: 50,
      leaves: new Map(),
      historyQtyByPlatform: {},
      historyDailyByPlatform: {},
    });
    assert.equal(plan.channelShareSource, 'empty');
    assert.equal(plan.units.length, 0);
  });

  it('defers replenishment only for US region with enough network cover', () => {
    const base = {
      enabled: true,
      warehouses: [
        { effectiveQty: 10, reorderPoint: 50 },
        { effectiveQty: 300, reorderPoint: 50 },
      ],
      networkEffective: 310,
      networkRop: 100,
      networkCoverageDays: 120,
      targetCoverageDays: 90,
    };
    assert.equal(shouldDeferUsRegionUnit({ ...base, fulfillmentRegion: 'US' }), true);
    assert.equal(shouldDeferUsRegionUnit({ ...base, fulfillmentRegion: 'UK' }), false);
    assert.equal(shouldDeferUsRegionUnit({ ...base, fulfillmentRegion: 'UNMAPPED' }), false);
    assert.equal(
      shouldDeferUsRegionUnit({ ...base, fulfillmentRegion: 'US', enabled: false }),
      false,
    );
    assert.equal(
      shouldDeferUsRegionUnit({ ...base, fulfillmentRegion: 'US', networkCoverageDays: 30 }),
      false,
    );
    assert.equal(
      shouldDeferUsRegionUnit({ ...base, fulfillmentRegion: 'US', networkEffective: 20 }),
      false,
    );
  });
});
