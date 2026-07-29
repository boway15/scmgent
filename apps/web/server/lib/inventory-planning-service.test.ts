import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSkuPlanningView,
  estimateStockoutDate,
  pickNearestEtaAvailable,
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
      etaAvailableNearest: '2026-08-15',
      stockoutDateEstimate: '2026-08-29',
    });
  });

  it('does not estimate stockout when demand is zero or coverage is infinite', () => {
    assert.equal(estimateStockoutDate(0, 10, new Date('2026-07-29T00:00:00Z')), null);
    assert.equal(estimateStockoutDate(2, Infinity, new Date('2026-07-29T00:00:00Z')), null);
  });

  it('selects the nearest future ETA for the requested warehouse', () => {
    assert.equal(
      pickNearestEtaAvailable(
        [
          { etaAvailable: '2026-08-20', warehouseCode: 'US-WEST', status: 'in_transit' },
          { etaAvailable: '2026-08-10', warehouseCode: 'US-EAST', status: 'confirmed' },
          { etaAvailable: '2026-08-15', warehouseCode: 'US-WEST', status: 'confirmed' },
          { etaAvailable: '2026-07-20', warehouseCode: 'US-WEST', status: 'in_transit' },
          { etaAvailable: '2026-08-01', warehouseCode: 'US-WEST', status: 'cancelled' },
        ],
        'US-WEST',
        '2026-07-29',
      ),
      '2026-08-15',
    );
  });
});
