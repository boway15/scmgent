import assert from 'node:assert/strict';
import {
  MIN_AVAILABILITY_COVERAGE,
  healthToAlertType,
  healthToExceptionType,
  recommendedActionForException,
  resolveHistoricalDemand,
} from './inventory-health-service.js';
import { buildInventoryPositionMetrics } from './inventory-position.js';
import { buildLeadTimeMetrics } from './replenishment-coverage.js';

assert.deepEqual(
  buildLeadTimeMetrics({
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
  }),
  {
    leadTimeProfileId: 'profile-1',
    productionDays: 30,
    domesticDays: 2,
    bookingDays: 3,
    transitDays: 40,
    customsDays: 5,
    inboundDays: 7,
    shippingDays: 48,
    inboundBufferDays: 7,
    totalLeadDays: 87,
  },
);

assert.deepEqual(
  buildLeadTimeMetrics({
    productionDays: 50,
    domesticDays: 0,
    bookingDays: 0,
    transitDays: 60,
    customsDays: 0,
    inboundDays: 7,
    shippingDays: 60,
    inboundBufferDays: 7,
    totalLeadDays: 117,
  }),
  {
    leadTimeProfileId: null,
    productionDays: 50,
    domesticDays: 0,
    bookingDays: 0,
    transitDays: 60,
    customsDays: 0,
    inboundDays: 7,
    shippingDays: 60,
    inboundBufferDays: 7,
    totalLeadDays: 117,
  },
);

assert.deepEqual(
  buildInventoryPositionMetrics({
    effectiveQty: 135,
    qtyAvailable: 100,
    qtyInProduction: 20,
    qtyInTransit: 30,
    qtyConfirmedOpen: 5,
    qtyReserved: 20,
    qtyBackorder: 0,
    dedupeMode: 'drafts_fill_gap',
    unassignedOpenQty: 7,
    sources: [
      { source: 'snapshot', bucket: 'available', qty: 100 },
      {
        source: 'purchase_draft',
        bucket: 'confirmedOpen',
        qty: 5,
        draftId: 'draft-1',
      },
    ],
  }),
  {
    inventoryPosition: {
      effectiveQty: 135,
      qtyAvailable: 100,
      qtyInProduction: 20,
      qtyInTransit: 30,
      qtyConfirmedOpen: 5,
      qtyReserved: 20,
      dedupeMode: 'drafts_fill_gap',
      unassignedOpenQty: 7,
      sources: [
        { source: 'snapshot', bucket: 'available', qty: 100 },
        {
          source: 'purchase_draft',
          bucket: 'confirmedOpen',
          qty: 5,
          draftId: 'draft-1',
        },
      ],
    },
  },
);

assert.equal(healthToAlertType('red', 0), 'stockout');
assert.equal(healthToAlertType('red', 5), 'below_rop');
assert.equal(healthToAlertType('yellow', 10), 'below_safety');
assert.equal(healthToAlertType('green', 10), null);

assert.equal(healthToExceptionType('blue', null), 'overstock');
assert.equal(healthToExceptionType('gray', '停售'), 'lifecycle_eol');
assert.equal(healthToExceptionType('gray', null), 'slow_moving');
assert.equal(healthToExceptionType('red', null), null);

assert.ok(recommendedActionForException('overstock').includes('停补'));

const historicalDemand = resolveHistoricalDemand({
  sales: [
    { saleDate: '2026-06-01', qtySold: 50 },
    { saleDate: '2026-06-02', qtySold: 50 },
  ],
  inventoryRows: [
    {
      recordedDate: '2026-06-01',
      qtyAvailable: 100,
      createdAt: new Date('2026-06-01T01:00:00.000Z'),
    },
    {
      recordedDate: '2026-06-01',
      qtyAvailable: 0,
      createdAt: new Date('2026-06-01T02:00:00.000Z'),
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      recordedDate: `2026-06-${String(index + 2).padStart(2, '0')}`,
      qtyAvailable: 100,
      createdAt: new Date(`2026-06-${String(index + 2).padStart(2, '0')}T01:00:00.000Z`),
    })),
  ],
  windowDays: 30,
  asOf: new Date('2026-07-01T00:00:00.000Z'),
});
assert.equal(MIN_AVAILABILITY_COVERAGE, 0.3);
assert.deepEqual(historicalDemand, {
  avgDaily: 6.25,
  stockoutAdjusted: true,
  inStockDays: 8,
  demandWindowDays: 30,
});

const lowCoverageDemand = resolveHistoricalDemand({
  sales: [{ saleDate: '2026-06-01', qtySold: 90 }],
  inventoryRows: [
    {
      recordedDate: '2026-06-01',
      qtyAvailable: 100,
      createdAt: new Date('2026-06-01T01:00:00.000Z'),
    },
  ],
  windowDays: 30,
  asOf: new Date('2026-07-01T00:00:00.000Z'),
});
assert.deepEqual(lowCoverageDemand, {
  avgDaily: 3,
  stockoutAdjusted: false,
  inStockDays: 0,
  demandWindowDays: 30,
});

console.log('inventory-health-service.test.ts: ok');
