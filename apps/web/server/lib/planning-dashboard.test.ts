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

  it('returns zero stockout rate when no SKU is planning-eligible', () => {
    const dashboard = aggregatePlanningDashboard(
      { ...baseSource, skuPlanningEligibleCount: 0 },
      today,
    );
    assert.equal(dashboard.stockoutRateApprox, 0);
    assert.equal(dashboard.forecastCoverageRate, 0);
  });
});
