import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateNetworkSupplyPools,
  buildSkuPlanningView,
  estimateStockoutDate,
  pickNearestEtaAvailable,
  resolvePlanningScope,
  summarizeNetworkWarehouses,
} from './inventory-planning-service.js';

const position = {
  qtyAvailable: 100,
  qtyInProduction: 20,
  qtyInTransit: 30,
  qtyConfirmedOpen: 10,
  qtyReserved: 5,
  qtyBackorder: 0,
  effectiveQty: 155,
  sources: [],
  dedupeMode: 'drafts_fill_gap' as const,
  unassignedOpenQty: 0,
};

const leadTime = {
  productionDays: 30,
  domesticDays: 2,
  bookingDays: 3,
  transitDays: 40,
  customsDays: 5,
  inboundDays: 7,
  shippingDays: 48,
  inboundBufferDays: 7,
  totalLeadDays: 87,
  profileId: 'profile-1',
  merchantCode: 'M001',
  warehouseCode: 'US-WEST',
};

describe('inventory planning view', () => {
  it('assembles the planning response from the shared health result', () => {
    const view = buildSkuPlanningView({
      health: {
        skuId: 'sku-1',
        skuCode: 'SKU-001',
        warehouseCode: 'US-WEST',
        avgDaily: 5,
        demandSource: 'forecast',
        coverageDays: 31,
        suggestedQty: 450,
        suggestedDate: '2026-07-20',
        healthStatus: 'yellow',
        metrics: { reorderPoint: 220 },
        coverage: { safetyStockDays: 14 },
        position,
        leadTime,
      },
      etaAvailableNearest: '2026-08-15',
      today: new Date('2026-07-29T00:00:00.000Z'),
    });

    assert.deepEqual(view, {
      skuId: 'sku-1',
      skuCode: 'SKU-001',
      warehouseCode: 'US-WEST',
      scope: 'warehouse',
      position,
      leadTime,
      avgDaily: 5,
      demandSource: 'forecast',
      coverageDays: 31,
      safetyStockDays: 14,
      reorderPoint: 220,
      suggestedQty: 450,
      suggestedDate: '2026-07-20',
      healthStatus: 'yellow',
      coverageHealthStatus: 'yellow',
      etaAvailableNearest: '2026-08-15',
      stockoutDateEstimate: '2026-08-29',
    });
  });

  it('defaults planning scope to network when warehouse omitted', () => {
    assert.equal(resolvePlanningScope({}), 'network');
    assert.equal(resolvePlanningScope({ scope: 'network' }), 'network');
    assert.equal(resolvePlanningScope({ warehouseCode: 'ALL' }), 'network');
    assert.equal(resolvePlanningScope({ warehouseCode: 'US-WEST' }), 'warehouse');
    assert.equal(
      resolvePlanningScope({ warehouseCode: 'US-WEST', scope: 'network' }),
      'network',
    );
  });

  it('aggregates network supply pools and warehouse summaries', () => {
    const pools = aggregateNetworkSupplyPools([
      { pool: 'local', qty: 100, availableAt: null, dateUnknown: true },
      { pool: 'in_transit', qty: 40, availableAt: '2026-08-10', dateUnknown: false },
      { pool: 'overseas', qty: 25, availableAt: '2026-08-05', dateUnknown: false },
      { pool: 'in_transit', qty: 10, availableAt: null, dateUnknown: true },
    ]);
    assert.deepEqual(pools, {
      localQty: 100,
      inTransitQty: 50,
      overseasQty: 25,
      dateUnknownQty: 110,
      nearestAvailableAt: '2026-08-05',
    });

    const rows = summarizeNetworkWarehouses({
      physicalWarehouses: ['US-WEST', 'US-EAST'],
      effectiveByWarehouse: new Map([
        ['US-WEST', 80],
        ['US-EAST', 20],
      ]),
      lotEtas: [
        { warehouseCode: 'US-WEST', availableAt: '2026-08-20', dateUnknown: false },
        { warehouseCode: 'US-WEST', availableAt: '2026-08-12', dateUnknown: false },
        { warehouseCode: 'OVERSEAS', availableAt: '2026-08-01', dateUnknown: false },
        { warehouseCode: 'US-EAST', availableAt: null, dateUnknown: true },
      ],
      today: '2026-07-29',
    });
    assert.deepEqual(rows, [
      { warehouseCode: 'US-WEST', effectiveQty: 80, nearestAvailableAt: '2026-08-12' },
      { warehouseCode: 'US-EAST', effectiveQty: 20, nearestAvailableAt: null },
    ]);
  });

  it('exposes network scope and supplyPools on the planning view', () => {
    const view = buildSkuPlanningView({
      health: {
        skuId: 'sku-1',
        skuCode: 'SKU-001',
        warehouseCode: 'ALL',
        avgDaily: 8,
        demandSource: 'forecast',
        coverageDays: 20,
        suggestedQty: 100,
        suggestedDate: '2026-07-20',
        healthStatus: 'yellow',
        metrics: { reorderPoint: 200 },
        coverage: { safetyStockDays: 14 },
        position,
        leadTime: { ...leadTime, warehouseCode: 'ALL' },
      },
      scope: 'network',
      supplyPools: {
        localQty: 100,
        inTransitQty: 40,
        overseasQty: 25,
        dateUnknownQty: 10,
        nearestAvailableAt: '2026-08-05',
      },
      warehouses: [
        {
          warehouseCode: 'US-WEST',
          effectiveQty: 80,
          nearestAvailableAt: '2026-08-12',
          healthStatus: 'yellow',
        },
      ],
      unallocatedNetworkQty: 25,
      timeline: {
        today: '2026-07-29',
        windowDays: 30,
        totalLeadDays: 30,
        stockoutDateConfirmed: '2026-08-18',
        stockoutDateExpected: null,
        safetyBreachDateConfirmed: null,
        reorderDate: '2026-07-20',
        tooLateForNewPo: false,
        uncoverableByNewPo: false,
        suggestedQty: 100,
        suggestedQtyGross: 100,
        points: [
          {
            horizonDays: 0,
            asOf: '2026-07-29',
            confirmedEnding: 160,
            expectedEnding: 160,
            plannedInbound: 0,
            cumulativeDemand: 8,
            supplyEvents: [],
          },
        ],
      },
      timelineSuggestedQty: 100,
    });
    assert.equal(view.scope, 'network');
    assert.equal(view.warehouseCode, 'ALL');
    assert.equal(view.supplyPools?.localQty, 100);
    assert.equal(view.warehouses?.[0]?.warehouseCode, 'US-WEST');
    assert.equal(view.warehouses?.[0]?.healthStatus, 'yellow');
    assert.equal(view.timeline?.points.length, 1);
    assert.equal(view.unallocatedNetworkQty, 25);
  });

  it('prefers injected daily timeline fields for qty, reorder, and stockout', () => {
    const timeline = {
      today: '2026-07-29',
      windowDays: 101,
      totalLeadDays: 87,
      stockoutDateConfirmed: '2026-08-10',
      stockoutDateExpected: '2026-09-01',
      safetyBreachDateConfirmed: '2026-08-05',
      reorderDate: '2026-06-06',
      tooLateForNewPo: true,
      uncoverableByNewPo: true,
      suggestedQty: 900,
      suggestedQtyGross: 900,
      points: [
        {
          horizonDays: 0,
          asOf: '2026-07-29',
          confirmedEnding: 100,
          expectedEnding: 100,
          plannedInbound: 0,
          cumulativeDemand: 5,
          supplyEvents: [{ pool: 'overseas', qty: 100, availableAt: '2026-07-29', supplyClass: 'confirmed' }],
        },
      ],
    };

    const view = buildSkuPlanningView({
      health: {
        skuId: 'sku-1',
        skuCode: 'SKU-001',
        warehouseCode: 'US-WEST',
        avgDaily: 5,
        demandSource: 'forecast',
        coverageDays: 31,
        suggestedQty: 450,
        suggestedDate: '2026-07-20',
        healthStatus: 'green',
        metrics: { reorderPoint: 220 },
        coverage: { safetyStockDays: 14, overstockThresholdDays: 180 },
        position,
        leadTime,
      },
      timeline,
      timelineSuggestedQty: 900,
      today: new Date('2026-07-29T00:00:00.000Z'),
    });

    assert.equal(view.suggestedQty, 900);
    assert.equal(view.suggestedDate, timeline.reorderDate);
    assert.equal(view.stockoutDateEstimate, timeline.stockoutDateConfirmed);
    assert.equal(view.healthStatus, 'red');
    assert.equal(view.coverageHealthStatus, 'green');
    assert.deepEqual(view.timeline?.points, timeline.points);
  });

  it('uses timeline decision green when coverage health is yellow but timeline suggests zero', () => {
    const timeline = {
      today: '2026-07-29',
      windowDays: 101,
      totalLeadDays: 87,
      stockoutDateConfirmed: '2027-01-01',
      stockoutDateExpected: null,
      safetyBreachDateConfirmed: null,
      reorderDate: null,
      tooLateForNewPo: false,
      uncoverableByNewPo: false,
      suggestedQty: 0,
      suggestedQtyGross: 0,
      points: [
        {
          horizonDays: 0,
          asOf: '2026-07-29',
          confirmedEnding: 600,
          expectedEnding: 600,
          plannedInbound: 0,
          cumulativeDemand: 5,
          supplyEvents: [],
        },
      ],
    };
    const view = buildSkuPlanningView({
      health: {
        skuId: 'sku-1',
        skuCode: 'SKU-001',
        warehouseCode: 'US-WEST',
        avgDaily: 5,
        demandSource: 'forecast',
        coverageDays: 80,
        suggestedQty: 450,
        suggestedDate: '2026-07-20',
        healthStatus: 'yellow',
        metrics: { reorderPoint: 220 },
        coverage: { safetyStockDays: 14, overstockThresholdDays: 180 },
        position,
        leadTime,
      },
      timeline,
      timelineSuggestedQty: 0,
    });
    assert.equal(view.healthStatus, 'green');
    assert.equal(view.coverageHealthStatus, 'yellow');
    assert.equal(view.suggestedQty, 0);
  });

  it('does not estimate stockout when demand is zero or coverage is infinite', () => {
    assert.equal(estimateStockoutDate(0, 10, new Date('2026-07-29T00:00:00Z')), null);
    assert.equal(estimateStockoutDate(2, Infinity, new Date('2026-07-29T00:00:00Z')), null);
  });

  it('exposes stockoutAdjusted when demand is historical', () => {
    const view = buildSkuPlanningView({
      health: {
        skuId: 'sku-1',
        skuCode: 'SKU-001',
        warehouseCode: 'US-WEST',
        avgDaily: 3,
        demandSource: 'historical',
        coverageDays: 20,
        suggestedQty: 0,
        suggestedDate: '2026-07-29',
        healthStatus: 'green',
        metrics: { stockoutAdjusted: true },
        coverage: { safetyStockDays: 14 },
        position,
        leadTime,
      },
    });

    assert.equal(view.stockoutAdjusted, true);
  });

  it('passes through planning allocation onto the view', () => {
    const allocation = {
      method: 'unallocated' as const,
      snapshotDate: '2026-09-18',
      overseasTotal: 100,
      allocatedQty: 0,
      undatedTransitQty: 0,
      shareSumWarning: false,
    };
    const view = buildSkuPlanningView({
      health: {
        skuId: 'sku-1',
        skuCode: 'SKU-001',
        warehouseCode: 'US-WEST',
        avgDaily: 5,
        demandSource: 'forecast',
        coverageDays: 31,
        suggestedQty: 450,
        suggestedDate: '2026-07-20',
        healthStatus: 'yellow',
        metrics: { reorderPoint: 220 },
        coverage: { safetyStockDays: 14 },
        position,
        leadTime,
      },
      allocation,
    });
    assert.deepEqual(view.allocation, allocation);
  });

  it('exposes demand-plan shadow fields without changing health demandSource', () => {
    const view = buildSkuPlanningView({
      health: {
        skuId: 'sku-1',
        skuCode: 'SKU-001',
        warehouseCode: 'US-WEST',
        avgDaily: 5,
        demandSource: 'forecast',
        coverageDays: 31,
        suggestedQty: 450,
        suggestedDate: '2026-07-20',
        healthStatus: 'yellow',
        metrics: { reorderPoint: 220 },
        coverage: { safetyStockDays: 14 },
        position,
        leadTime,
      },
      planningDemandSource: 'demand_plan',
      planningDemandFlags: ['pilot_hit'],
      championStockoutDateConfirmed: '2026-08-20',
      championSuggestedQty: 600,
      inStockDayRatio: 0.85,
      today: new Date('2026-07-29T00:00:00.000Z'),
    });

    assert.equal(view.demandSource, 'forecast');
    assert.equal(view.planningDemandSource, 'demand_plan');
    assert.deepEqual(view.planningDemandFlags, ['pilot_hit']);
    assert.equal(view.championStockoutDateConfirmed, '2026-08-20');
    assert.equal(view.championSuggestedQty, 600);
    assert.equal(view.inStockDayRatio, 0.85);
    assert.equal('healthDemandNote' in view, false);
  });

  it('exposes unallocatedNetworkQty only when positive', () => {
    const health = {
      skuId: 'sku-1',
      skuCode: 'SKU-001',
      warehouseCode: 'US-WEST',
      avgDaily: 5,
      demandSource: 'forecast' as const,
      coverageDays: 31,
      suggestedQty: 450,
      suggestedDate: '2026-07-20',
      healthStatus: 'yellow',
      metrics: { reorderPoint: 220 },
      coverage: { safetyStockDays: 14 },
      position,
      leadTime,
    };
    const withQty = buildSkuPlanningView({ health, unallocatedNetworkQty: 373 });
    assert.equal(withQty.unallocatedNetworkQty, 373);
    const without = buildSkuPlanningView({ health, unallocatedNetworkQty: 0 });
    assert.equal('unallocatedNetworkQty' in without, false);
  });

  it('selects the nearest future available date from open supply lots of the warehouse', () => {
    assert.equal(
      pickNearestEtaAvailable(
        [
          { availableAt: '2026-08-20', warehouseCode: 'US-WEST', status: 'open', dateUnknown: false },
          { availableAt: '2026-08-10', warehouseCode: 'US-EAST', status: 'open', dateUnknown: false },
          { availableAt: '2026-08-15', warehouseCode: 'US-WEST', status: 'open', dateUnknown: false },
          { availableAt: '2026-07-20', warehouseCode: 'US-WEST', status: 'open', dateUnknown: false },
          { availableAt: '2026-08-01', warehouseCode: 'US-WEST', status: 'cancelled', dateUnknown: false },
          { availableAt: '2026-08-02', warehouseCode: 'US-WEST', status: 'open', dateUnknown: true },
        ],
        'US-WEST',
        '2026-07-29',
      ),
      '2026-08-15',
    );
  });
});
