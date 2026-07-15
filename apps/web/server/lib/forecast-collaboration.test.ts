import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReviewItemsForForecast,
  buildReviewItemIdentity,
  buildReviewItemKey,
  buildSeasonalityDimensionCandidates,
  computeAgeDaysFromFirstSale,
  computeCategoryReferenceBySku,
  computeSeasonalityFactors,
  filterSalesRowsByStation,
  resolveBaselineGenerateStations,
  resolveBaselinePurgePlatformScope,
  resolveSeasonalityFactors,
  type SeasonalityLookup,
} from './forecast-collaboration.js';
import { resolveBaselineForecastPlatforms } from './forecast-platform-scope.js';

describe('forecast-collaboration', () => {
  it('builds trend shift and category deviation review items for growth SKU with unapplied category trend', () => {
    const items = buildReviewItemsForForecast({
      skuId: 'sku-1',
      station: 'US',
      platform: 'AMAZON',
      lifecycle: 'growth',
      hasEnoughHistory: true,
      suggestedDailyAvg: 12.5,
      categoryTrendApplied: false,
      categoryTrendFactor: 1.5,
    });

    assert.deepEqual(
      items.map((item) => item.issueType),
      ['trend_shift', 'category_deviation'],
    );
    assert.equal(items[0].severity, 'warning');
    assert.equal(items[0].suggestedDailyAvg, 12.5);
    assert.equal(items[1].severity, 'warning');
    assert.match(items[1].message, /品类趋势系数/);
  });

  it('builds a missing history review item when history is insufficient', () => {
    const items = buildReviewItemsForForecast({
      skuId: 'sku-2',
      station: 'US',
      platform: 'ALL',
      lifecycle: 'new',
      hasEnoughHistory: false,
      suggestedDailyAvg: 0.8,
      categoryTrendApplied: true,
    });

    assert.deepEqual(items, [
      {
        skuId: 'sku-2',
        station: 'US',
        platform: 'ALL',
        issueType: 'missing_history',
        severity: 'info',
        message: 'sku-2 历史销量数据不足，请复核低置信度基线预测。',
        suggestedDailyAvg: 0.8,
      },
    ]);
  });

  it('builds a stockout suspected warning for stockout lifecycle', () => {
    const items = buildReviewItemsForForecast({
      skuId: 'sku-3',
      skuCode: 'DJ502952_1',
      station: 'US',
      platform: 'AMAZON',
      lifecycle: 'stockout_suspected',
      hasEnoughHistory: true,
      suggestedDailyAvg: 4.2,
      categoryTrendApplied: true,
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].issueType, 'stockout_suspected');
    assert.equal(items[0].severity, 'warning');
    assert.match(items[0].message, /断货/);
  });

  it('builds a trend shift review item for decline lifecycle', () => {
    const items = buildReviewItemsForForecast({
      skuId: 'sku-4',
      station: 'DE',
      platform: 'WALMART',
      lifecycle: 'decline',
      hasEnoughHistory: true,
      suggestedDailyAvg: 2.1,
      categoryTrendApplied: true,
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].issueType, 'trend_shift');
    assert.equal(items[0].severity, 'warning');
  });

  it('computes month-over-month trend factors by category', () => {
    const asOf = new Date('2026-05-31T00:00:00.000Z');
    const factors = computeSeasonalityFactors(
      [
        {
          dimensionType: 'category',
          dimensionValue: 'Patio',
          month: '2026-04',
          qtySold: 100,
        },
        {
          dimensionType: 'category',
          dimensionValue: 'Patio',
          month: '2026-05',
          qtySold: 120,
        },
      ],
      asOf,
    );

    const may = factors.find((f) => f.month === 5)!;
    assert.equal(may.trendFactor, 1.2);
    assert.equal(factors.filter((f) => f.dimensionValue === 'Patio').length, 12);
  });

  it('computes seasonality independently by dimension group', () => {
    const asOf = new Date('2026-06-30T00:00:00.000Z');
    const factors = computeSeasonalityFactors(
      [
        {
          dimensionType: 'project_group',
          dimensionValue: 'Outdoor',
          month: '2026-05',
          qtySold: 60,
        },
        {
          dimensionType: 'category',
          dimensionValue: 'Patio',
          month: '2026-06',
          qtySold: 150,
        },
        {
          dimensionType: 'category',
          dimensionValue: 'Patio',
          month: '2026-04',
          qtySold: 100,
        },
        {
          dimensionType: 'project_group',
          dimensionValue: 'Outdoor',
          month: '2026-04',
          qtySold: 50,
        },
        {
          dimensionType: 'category',
          dimensionValue: 'Patio',
          month: '2026-05',
          qtySold: 120,
        },
      ],
      asOf,
    );

    const patioJune = factors.find(
      (f) => f.dimensionType === 'category' && f.dimensionValue === 'Patio' && f.month === 6,
    )!;
    assert.equal(patioJune.trendFactor, 1.25);
    assert.equal(factors.filter((f) => f.dimensionType === 'project_group').length, 12);
    assert.equal(factors.filter((f) => f.dimensionType === 'category').length, 12);
  });

  it('rounds trend factors to 4 decimals and uses 1 when previous qty is not positive', () => {
    const asOf = new Date('2026-03-31T00:00:00.000Z');
    const factors = computeSeasonalityFactors(
      [
        {
          dimensionType: 'category',
          dimensionValue: 'Desk',
          month: '2026-01',
          qtySold: 0,
        },
        {
          dimensionType: 'category',
          dimensionValue: 'Desk',
          month: '2026-02',
          qtySold: 7,
        },
        {
          dimensionType: 'category',
          dimensionValue: 'Desk',
          month: '2026-03',
          qtySold: 10,
        },
      ],
      asOf,
    );

    const march = factors.find((f) => f.month === 3)!;
    assert.equal(march.trendFactor, 1.4286);
  });

  it('returns all sales rows when station scope is global ALL', () => {
    const rows = [
      { saleDate: '2026-06-01', qtySold: 3, warehouseCode: 'US-WEST' },
      { saleDate: '2026-06-02', qtySold: 5, warehouseCode: 'DE-1' },
    ];
    assert.deepEqual(
      filterSalesRowsByStation(rows, 'ALL', new Map([
        ['US-WEST', 'US'],
        ['DE-1', 'DE'],
      ])),
      rows,
    );
  });

  it('filters warehouse-coded sales by station while retaining uncoded rows as unscoped', () => {
    const rows = [
      { saleDate: '2026-06-01', qtySold: 3, warehouseCode: 'US-WEST' },
      { saleDate: '2026-06-02', qtySold: 5, warehouseCode: 'DE-1' },
      { saleDate: '2026-06-03', qtySold: 7, warehouseCode: null },
      { saleDate: '2026-06-04', qtySold: 11, warehouseCode: 'UNKNOWN' },
    ];

    assert.deepEqual(
      filterSalesRowsByStation(rows, 'US', new Map([
        ['US-WEST', 'US'],
        ['DE-1', 'DE'],
      ])),
      [
        { saleDate: '2026-06-01', qtySold: 3, warehouseCode: 'US-WEST' },
        { saleDate: '2026-06-03', qtySold: 7, warehouseCode: null },
      ],
    );
  });

  it('builds review item idempotency keys from version and issue dimensions', () => {
    const identity = buildReviewItemIdentity('version-1', {
      skuId: 'sku-1',
      station: 'US',
      platform: 'AMAZON',
      issueType: 'trend_shift',
      severity: 'warning',
      message: 'Trend changed',
    });

    assert.deepEqual(identity, {
      versionId: 'version-1',
      skuId: 'sku-1',
      station: 'US',
      platform: 'AMAZON',
      issueType: 'trend_shift',
    });
    assert.equal(
      buildReviewItemKey(identity),
      'version-1::sku-1::US::AMAZON::trend_shift',
    );
  });

  it('computes SKU age from true first sale date instead of recent window start', () => {
    assert.equal(
      computeAgeDaysFromFirstSale('2025-01-15', new Date('2026-06-29T00:00:00.000Z')),
      530,
    );
    assert.equal(computeAgeDaysFromFirstSale(null, new Date('2026-06-29T00:00:00.000Z')), 0);
  });

  it('builds category deviation as info when seasonality was clipped', () => {
    const items = buildReviewItemsForForecast({
      skuId: 'sku-clip',
      skuCode: 'SKU-CLIP',
      station: 'US',
      platform: 'AMAZON',
      lifecycle: 'mature',
      hasEnoughHistory: true,
      suggestedDailyAvg: 10,
      categoryTrendApplied: true,
      categoryTrendFactor: 1.5,
      seasonalityWasClipped: true,
    });

    assert.equal(items[0]?.issueType, 'category_deviation');
    assert.equal(items[0]?.severity, 'info');
    assert.match(items[0]?.message ?? '', /裁剪/);
  });

  it('computes category reference median by sku category', () => {
    const refs = computeCategoryReferenceBySku(
      [
        { id: 'a', category: 'Outdoor|Patio' },
        { id: 'b', category: 'Outdoor|Patio' },
        { id: 'c', category: 'Other' },
      ],
      new Map([
        ['a', 10],
        ['b', 20],
        ['c', 5],
      ]),
    );

    assert.equal(refs.get('a'), 15);
    assert.equal(refs.get('b'), 15);
    assert.equal(refs.get('c'), 5);
  });

  it('parses category path segments for seasonality lookup', () => {
    assert.deepEqual(buildSeasonalityDimensionCandidates('Outdoor|Patio|Chair'), {
      category: ['Outdoor|Patio|Chair', 'Chair', 'Outdoor', 'Patio'],
      projectGroup: ['Patio', 'Outdoor|Patio|Chair', 'Outdoor', 'Chair'],
    });
  });

  it('resolves seasonality by category then project group for forecast month', () => {
    const lookup: SeasonalityLookup = new Map([
      ['category::Patio::7', { seasonalityFactor: 1.2, trendFactor: 1 }],
      ['project_group::Outdoor::7', { seasonalityFactor: 0.9, trendFactor: 1.1 }],
    ]);

    assert.deepEqual(resolveSeasonalityFactors(lookup, 'Outdoor|Patio|Chair', 7), {
      seasonalityFactor: 1.2,
      trendFactor: 1,
      matched: true,
    });

    assert.deepEqual(resolveSeasonalityFactors(lookup, 'Outdoor|Desk', 7), {
      seasonalityFactor: 0.9,
      trendFactor: 1.1,
      matched: true,
    });

    assert.deepEqual(resolveSeasonalityFactors(lookup, null, 7), {
      seasonalityFactor: 1,
      trendFactor: 1,
      matched: false,
    });
  });

  it('expands ALL baseline platforms for multi-channel generation', () => {
    assert.equal(resolveBaselineForecastPlatforms('ALL').length, 5);
    assert.deepEqual(resolveBaselineForecastPlatforms('AMAZON'), ['AMAZON']);
  });

  it('skips version-wide purge when regenerating a single SKU baseline', () => {
    assert.equal(
      resolveBaselinePurgePlatformScope({
        purgeSkuScope: true,
        platformCount: 1,
      }),
      undefined,
    );
    assert.equal(
      resolveBaselinePurgePlatformScope({
        purgeSkuScope: true,
        platformCount: 5,
        platformIndex: 0,
      }),
      undefined,
    );
  });

  it('purges platform scope only for full baseline generation', () => {
    assert.equal(
      resolveBaselinePurgePlatformScope({
        platformCount: 1,
      }),
      'current',
    );
    assert.equal(
      resolveBaselinePurgePlatformScope({
        platformCount: 5,
        platformIndex: 0,
      }),
      'all',
    );
    assert.equal(
      resolveBaselinePurgePlatformScope({
        platformCount: 5,
        platformIndex: 2,
      }),
      undefined,
    );
  });

  it('resolves generate stations to single global ALL scope', () => {
    assert.deepEqual(
      resolveBaselineGenerateStations({
        skuCode: 'DJ502530_2',
        allStations: ['US', 'EU', 'CA'],
      }),
      ['ALL'],
    );
    assert.deepEqual(
      resolveBaselineGenerateStations({
        station: 'EU',
        allStations: ['US', 'EU', 'CA'],
      }),
      ['ALL'],
    );
    assert.deepEqual(resolveBaselineGenerateStations({ allStations: ['US', 'EU', 'CA'] }), ['ALL']);
  });
});
