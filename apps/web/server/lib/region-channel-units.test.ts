import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPublishedLeafEntries, publishedLeafKey } from './forecast-published-resolve.js';
import type { SkuHealthRow } from './inventory-health-service.js';
import type { InventorySnapshot } from './inventory-snapshot.js';
import type { OpenTimelineLot } from './inventory-supply-lot-sync.js';
import { calcTotalLeadTime } from './replenishment-coverage.js';
import {
  apportionSharedLots,
  buildSkuRegionChannelUnits,
  projectRegionChannelUnit,
} from './region-channel-units.js';
import type { RegionMappingTables } from './region-mapping.js';

const tables: RegionMappingTables = {
  stations: new Map([['Amazon美国', 'US']]),
  warehouses: new Map([
    ['US-WEST', 'US'],
    ['US-EAST', 'US'],
  ]),
};

const NOW = new Date('2026-11-12T08:00:00.000Z');

function whHealth(code: string, effectiveQty: number, rop = 10): SkuHealthRow {
  const leadTime = {
    ...calcTotalLeadTime({ productionDays: 30, shippingDays: 25, inboundBufferDays: 5 }),
    warehouseCode: code,
  };
  return {
    skuId: 'sku-1',
    skuCode: 'SKU-1',
    spuId: null,
    merchantCode: null,
    warehouseCode: code,
    regionGroup: 'US',
    countryCode: null,
    effectiveQty,
    avgDaily: 1,
    demandSource: 'historical',
    healthStatus: 'green',
    coverageDays: 30,
    totalLeadDays: leadTime.totalLeadDays,
    latestOrderDays: 5,
    needsReplenishment: false,
    suggestedQty: 0,
    suggestedDate: '2026-11-12',
    metrics: { reorderPoint: rop },
    coverage: {} as SkuHealthRow['coverage'],
    position: {} as SkuHealthRow['position'],
    leadTime,
  };
}

function salesRows(days: number, qty: number, opts: { station?: string; channel: string }) {
  const rows: Array<{ qtySold: number; saleDate: string; station: string; channel: string }> = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(NOW.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    rows.push({ qtySold: qty, saleDate: d, station: opts.station ?? '', channel: opts.channel });
  }
  return rows;
}

const sku = {
  id: 'sku-1',
  code: 'SKU-1',
  spuId: null,
  merchantCode: null,
  unitCost: '10',
  lifecycle: null,
  commercialStatusNorm: null,
};

describe('buildPublishedLeafEntries', () => {
  const base = {
    skuId: 'sku-1',
    forecastYear: 2026,
    month: 11,
    forecastDailyAvg: '5',
    manualDailyAvg: null,
    lifecycle: null,
    profileSegment: 'T1A',
    horizonFactors: null,
    forecastDailyP90: null,
  };

  it('drops legacy ALL region rows and keys leaves by region::platform', () => {
    const leaves = buildPublishedLeafEntries(
      [
        { ...base, salesRegion: 'ALL', platform: 'AMAZON' },
        { ...base, salesRegion: 'US', platform: 'AMAZON' },
        { ...base, salesRegion: 'US', platform: 'WALMART', forecastDailyAvg: '2' },
        { ...base, salesRegion: 'UNMAPPED', platform: 'AMAZON', forecastDailyAvg: '1' },
      ],
      'v1',
    );
    assert.deepEqual(
      [...leaves.keys()].sort(),
      [
        publishedLeafKey('UNMAPPED', 'AMAZON'),
        publishedLeafKey('US', 'AMAZON'),
        publishedLeafKey('US', 'WALMART'),
      ].sort(),
    );
    assert.equal(leaves.get(publishedLeafKey('US', 'WALMART'))!.map.get('2026-11'), 2);
  });

  it('manual daily overrides system forecast; ALL platform dropped when specific exists', () => {
    const leaves = buildPublishedLeafEntries(
      [
        { ...base, salesRegion: 'US', platform: 'ALL', forecastDailyAvg: '99' },
        { ...base, salesRegion: 'US', platform: 'AMAZON', manualDailyAvg: '7' },
      ],
      'v1',
    );
    assert.equal(leaves.size, 1);
    assert.equal(leaves.get(publishedLeafKey('US', 'AMAZON'))!.map.get('2026-11'), 7);
  });
});

describe('buildSkuRegionChannelUnits', () => {
  it('builds region x platform units from leaves, history fallback, and UNMAPPED bucket', () => {
    const leaves = buildPublishedLeafEntries(
      [
        {
          skuId: 'sku-1',
          salesRegion: 'US',
          platform: 'AMAZON',
          forecastYear: 2026,
          month: 11,
          forecastDailyAvg: '4',
          manualDailyAvg: null,
          lifecycle: null,
          profileSegment: 'T1A',
          horizonFactors: null,
          forecastDailyP90: null,
        },
        {
          skuId: 'sku-1',
          // 遗留 ALL 不得驱动
          salesRegion: 'ALL',
          platform: 'AMAZON',
          forecastYear: 2026,
          month: 11,
          forecastDailyAvg: '500',
          manualDailyAvg: null,
          lifecycle: null,
          profileSegment: 'T1A',
          horizonFactors: null,
          forecastDailyP90: null,
        },
      ],
      'v1',
    );
    const result = buildSkuRegionChannelUnits({
      sku,
      warehouseHealth: [
        whHealth('US-WEST', 60),
        whHealth('US-EAST', 40),
        whHealth('NEW-WH', 25), // 未映射仓
      ],
      tables,
      leaves,
      salesRows: [
        ...salesRows(60, 2, { station: 'Amazon美国', channel: 'WALMART' }),
        ...salesRows(60, 3, { station: '未知站', channel: 'AMAZON' }),
      ],
      platformOf: (c) => (c ?? 'UNKNOWN').toUpperCase(),
      policyMap: new Map(),
      now: NOW,
    });

    const keys = result.units.map((u) => `${u.fulfillmentRegion}/${u.platform}`).sort();
    assert.deepEqual(keys, ['UNMAPPED/AMAZON', 'US/AMAZON', 'US/WALMART']);

    const us = result.units.filter((u) => u.fulfillmentRegion === 'US');
    // 区域库存 100，渠道分摊后件数守恒
    assert.equal(us.reduce((s, u) => s + u.health.effectiveQty, 0), 100);
    const usAmazon = us.find((u) => u.platform === 'AMAZON')!;
    assert.equal(usAmazon.health.metrics.regionDemandSource, 'published_leaf');
    assert.equal(usAmazon.health.metrics.channelShareSource, 'forecast');
    assert.equal(usAmazon.health.metrics.demandShareScope, 'fulfillment_region_channel');
    const usWalmart = us.find((u) => u.platform === 'WALMART')!;
    assert.equal(usWalmart.health.metrics.regionDemandSource, 'history');
    assert.ok(usWalmart.health.avgDaily > 0);

    const unmapped = result.units.find((u) => u.fulfillmentRegion === 'UNMAPPED')!;
    assert.equal(unmapped.health.effectiveQty, 25);
    assert.equal(unmapped.health.metrics.channelShareSource, 'history');
    // ALL=500 绝不进入任何叶子日均
    assert.ok(usAmazon.health.avgDaily < 50);
    assert.deepEqual(result.demandRegionsWithoutWarehouse, []);
  });

  it('reports demand in regions that have no warehouse and does not throw', () => {
    const result = buildSkuRegionChannelUnits({
      sku,
      warehouseHealth: [whHealth('US-WEST', 10)],
      tables: {
        stations: new Map([['Amazon英国', 'UK']]),
        warehouses: new Map([['US-WEST', 'US']]),
      },
      leaves: new Map(),
      salesRows: salesRows(30, 2, { station: 'Amazon英国', channel: 'AMAZON' }),
      platformOf: (c) => (c ?? 'UNKNOWN').toUpperCase(),
      policyMap: new Map(),
      now: NOW,
    });
    assert.deepEqual(result.demandRegionsWithoutWarehouse, ['UK']);
    assert.equal(result.units.length, 0);
  });
});

describe('projectRegionChannelUnit', () => {
  it('splits region lots and shared pool by region demand, then by channel, conserving qty', () => {
    const leaves = buildPublishedLeafEntries(
      ['AMAZON', 'WALMART'].map((platform) => ({
        skuId: 'sku-1',
        salesRegion: 'US',
        platform,
        forecastYear: 2026,
        month: 11,
        forecastDailyAvg: platform === 'AMAZON' ? '6' : '2',
        manualDailyAvg: null,
        lifecycle: null,
        profileSegment: 'T1A',
        horizonFactors: null,
        forecastDailyP90: null,
      })),
      'v1',
    );
    const result = buildSkuRegionChannelUnits({
      sku,
      warehouseHealth: [whHealth('US-WEST', 100)],
      tables,
      leaves,
      salesRows: [],
      platformOf: (c) => (c ?? 'UNKNOWN').toUpperCase(),
      policyMap: new Map(),
      now: NOW,
    });
    const lot = (qty: number): OpenTimelineLot => ({
      pool: 'in_transit',
      qty,
      availableAt: '2026-12-01',
      productionStatus: null,
      shipReadyAt: null,
      etaEstimated: false,
      dateUnknown: false,
    });
    const snap = (qtyAvailable: number): InventorySnapshot => ({
      warehouseCode: 'US-WEST',
      qtyAvailable,
      qtyInTransit: 0,
      qtyInProduction: 0,
      qtyReserved: 0,
    });
    const lotsByKey = new Map<string, OpenTimelineLot[]>([
      ['sku-1::US-WEST', [lot(80)]],
      ['sku-1::IN-PRODUCTION', [lot(200)]],
    ]);
    const snapshots = new Map([['sku-1::US-WEST', snap(100)]]);

    const amazon = result.units.find((u) => u.platform === 'AMAZON')!;
    const walmart = result.units.find((u) => u.platform === 'WALMART')!;
    const run = (unit: typeof amazon) =>
      projectRegionChannelUnit({
        skuId: 'sku-1',
        unit,
        plans: result.plans,
        snapshots,
        lotsByKey,
        now: NOW,
      });
    const a = run(amazon);
    const w = run(walmart);
    assert.ok(a.timeline.points.length > 0);
    // 同一区域两个渠道：渠道需求高者拿到更多供给，因此 Amazon 期初可售 > Walmart
    const a0 = a.timeline.points.find((p) => p.horizonDays === 0)!.confirmedEnding;
    const w0 = w.timeline.points.find((p) => p.horizonDays === 0)!.confirmedEnding;
    assert.ok(a0 > w0, `expected amazon day0 ${a0} > walmart ${w0}`);
    // 区域可售 100 件在渠道间件数守恒；day0 期末 = 100 − 当日合计需求（6 + 2）
    assert.equal(Math.round(a0 + w0), 100 - 8);
  });

  it('apportions shared lots only to regions that carry demand', () => {
    const lots: OpenTimelineLot[] = [
      {
        pool: 'local',
        qty: 100,
        availableAt: '2026-12-01',
        productionStatus: 'in_production',
        shipReadyAt: null,
        etaEstimated: false,
        dateUnknown: false,
      },
    ];
    const us = apportionSharedLots(lots, { US: 3, UK: 1 }, 'US');
    const uk = apportionSharedLots(lots, { US: 3, UK: 1 }, 'UK');
    assert.equal(us[0]!.qty + uk[0]!.qty, 100);
    assert.equal(apportionSharedLots(lots, { US: 1 }, 'UNMAPPED').length, 0);
  });
});
