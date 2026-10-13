import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregatePlanningDashboard } from './planning-dashboard.js';

const today = new Date('2026-07-29T12:00:00.000Z');

const baseSource = {
  skuActiveCount: 100,
  skuOperationalCount: 70,
  skuDormantCount: 30,
  skuPlanningEligibleCount: 80,
  skuGrayLifecycleCount: 20,
  skuForecastCoveredCount: 60,
  skuForecastGapCount: 20,
  healthRedCount: 24,
  healthYellowCount: 16,
  healthRedSkuCount: 8,
  healthYellowSkuCount: 12,
  belowRopCount: 15,
  pendingSuggestions: 2,
  shipments: [] as [],
  purchaseDrafts: [] as [],
};

describe('aggregatePlanningDashboard', () => {
  it('aggregates planning KPIs and derives rates from planning-eligible SKUs', () => {
    const dashboard = aggregatePlanningDashboard(baseSource, today);

    assert.deepEqual(dashboard, {
      skuActiveCount: 100,
      skuOperationalCount: 70,
      skuDormantCount: 30,
      skuPlanningEligibleCount: 80,
      skuGrayLifecycleCount: 20,
      skuForecastCoveredCount: 60,
      skuForecastGapCount: 20,
      forecastCoverageRate: 0.75,
      healthRedCount: 24,
      healthYellowCount: 16,
      healthRedSkuCount: 8,
      healthYellowSkuCount: 12,
      belowRopCount: 15,
      pendingSuggestions: 2,
      delayedShipments: 0,
      delayedDraftsEtaAvailable: 0,
      stockoutRateApprox: 0.1,
      stockoutHorizon7: 0,
      stockoutHorizon15: 0,
      stockoutHorizon30: 0,
      overstockCount: 0,
      uncoverableByNewPoCount: 0,
      pendingShipOut: 0,
      pendingTransfer: 0,
      calculatedAt: today.toISOString(),
    });
  });

  it('passes through uncoverableByNewPoCount from the source', () => {
    const dashboard = aggregatePlanningDashboard(
      {
        ...baseSource,
        skuActiveCount: 0,
        skuPlanningEligibleCount: 0,
        skuGrayLifecycleCount: 0,
        skuForecastCoveredCount: 0,
        skuForecastGapCount: 0,
        healthRedCount: 0,
        healthYellowCount: 0,
        healthRedSkuCount: 0,
        healthYellowSkuCount: 0,
        belowRopCount: 0,
        pendingSuggestions: 0,
        uncoverableByNewPoCount: 3,
      },
      today,
    );
    assert.equal(dashboard.uncoverableByNewPoCount, 3);
  });

  it('counts shipments delayed by ETA or an open milestone once each', () => {
    const dashboard = aggregatePlanningDashboard(
      {
        ...baseSource,
        skuActiveCount: 0,
        skuPlanningEligibleCount: 0,
        skuGrayLifecycleCount: 0,
        skuForecastCoveredCount: 0,
        skuForecastGapCount: 0,
        healthRedCount: 0,
        healthYellowCount: 0,
        healthRedSkuCount: 0,
        healthYellowSkuCount: 0,
        belowRopCount: 0,
        pendingSuggestions: 0,
        shipments: [
          {
            status: 'departed',
            etaAvailable: '2026-07-28',
            milestones: [{ plannedAt: '2026-07-20', actualAt: null }],
          },
          {
            status: 'customs',
            etaAvailable: '2026-08-01',
            milestones: [{ plannedAt: '2026-07-28', actualAt: null }],
          },
          {
            status: 'available',
            etaAvailable: '2026-07-20',
            milestones: [],
          },
        ],
        purchaseDrafts: [],
      },
      today,
    );

    assert.equal(dashboard.delayedShipments, 2);
    assert.equal(dashboard.stockoutRateApprox, 0);
  });

  it('counts overdue non-terminal drafts strictly before today', () => {
    const dashboard = aggregatePlanningDashboard(
      {
        ...baseSource,
        skuActiveCount: 1,
        skuPlanningEligibleCount: 1,
        skuGrayLifecycleCount: 0,
        skuForecastCoveredCount: 0,
        skuForecastGapCount: 1,
        healthRedCount: 0,
        healthYellowCount: 0,
        healthRedSkuCount: 0,
        healthYellowSkuCount: 0,
        belowRopCount: 0,
        pendingSuggestions: 0,
        shipments: [],
        purchaseDrafts: [
          { status: 'in_transit', etaAvailable: '2026-07-28' },
          { status: 'partial_received', etaAvailable: '2026-07-20' },
          { status: 'received', etaAvailable: '2026-07-20' },
          { status: 'cancelled', etaAvailable: '2026-07-20' },
          { status: 'confirmed', etaAvailable: '2026-07-29' },
          { status: 'confirmed', etaAvailable: null },
        ],
      },
      today,
    );

    assert.equal(dashboard.delayedDraftsEtaAvailable, 2);
  });

  it('uses precomputed delay counts when the query already aggregated them', () => {
    const dashboard = aggregatePlanningDashboard(
      {
        ...baseSource,
        delayedShipmentCount: 4,
        delayedDraftCount: 1,
        shipments: [
          {
            status: 'departed',
            etaAvailable: '2026-07-28',
            milestones: [],
          },
        ],
        purchaseDrafts: [{ status: 'in_transit', etaAvailable: '2026-07-20' }],
      },
      today,
    );

    assert.equal(dashboard.delayedShipments, 4);
    assert.equal(dashboard.delayedDraftsEtaAvailable, 1);
  });
});
