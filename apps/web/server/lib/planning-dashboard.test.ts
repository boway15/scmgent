import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregatePlanningDashboard } from './planning-dashboard.js';

const today = new Date('2026-07-29T12:00:00.000Z');

describe('aggregatePlanningDashboard', () => {
  it('aggregates planning KPIs and derives the approximate stockout rate', () => {
    const dashboard = aggregatePlanningDashboard(
      {
        skuActiveCount: 4,
        healthRedCount: 2,
        healthYellowCount: 1,
        belowRopCount: 3,
        pendingSuggestions: 2,
        shipments: [],
        purchaseDrafts: [],
      },
      today,
    );

    assert.deepEqual(dashboard, {
      skuActiveCount: 4,
      healthRedCount: 2,
      healthYellowCount: 1,
      belowRopCount: 3,
      pendingSuggestions: 2,
      delayedShipments: 0,
      delayedDraftsEtaAvailable: 0,
      stockoutRateApprox: 0.5,
      calculatedAt: today.toISOString(),
    });
  });

  it('counts shipments delayed by ETA or an open milestone once each', () => {
    const dashboard = aggregatePlanningDashboard(
      {
        skuActiveCount: 0,
        healthRedCount: 0,
        healthYellowCount: 0,
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
        skuActiveCount: 1,
        healthRedCount: 0,
        healthYellowCount: 0,
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
});
