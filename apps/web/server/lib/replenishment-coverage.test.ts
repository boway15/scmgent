import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcCoverageDays,
  calcCoverageReplenishment,
  calcInventoryHealth,
  calcLatestOrderDays,
  calcSuggestedOrderDate,
  calcTotalLeadTime,
  DEFAULT_PRODUCTION_LEAD_DAYS,
  resolveShippingLeadDays,
} from './replenishment-coverage.js';

describe('replenishment-coverage', () => {
  it('resolves default shipping lead by warehouse', () => {
    assert.equal(resolveShippingLeadDays('US-WEST'), 45);
    assert.equal(resolveShippingLeadDays('US-EAST'), 60);
    assert.equal(resolveShippingLeadDays('DE'), 80);
  });

  it('calculates total lead time from production + shipping + buffer', () => {
    const lead = calcTotalLeadTime({
      productionDays: DEFAULT_PRODUCTION_LEAD_DAYS,
      shippingDays: 45,
      inboundBufferDays: 7,
    });
    assert.equal(lead.totalLeadDays, 102);
  });

  it('marks red when coverage is below total lead time', () => {
    const health = calcInventoryHealth({
      coverageDays: 90,
      totalLeadDays: 102,
      safetyStockDays: 14,
      overstockThresholdDays: 180,
    });
    assert.equal(health, 'red');
  });

  it('marks yellow in planning window', () => {
    const health = calcInventoryHealth({
      coverageDays: 110,
      totalLeadDays: 102,
      safetyStockDays: 14,
      overstockThresholdDays: 180,
    });
    assert.equal(health, 'yellow');
  });

  it('marks blue when overstock above threshold', () => {
    const health = calcInventoryHealth({
      coverageDays: 200,
      totalLeadDays: 102,
      safetyStockDays: 14,
      overstockThresholdDays: 180,
    });
    assert.equal(health, 'blue');
  });

  it('marks gray for discontinued lifecycle', () => {
    const health = calcInventoryHealth({
      coverageDays: 120,
      totalLeadDays: 102,
      safetyStockDays: 14,
      overstockThresholdDays: 180,
      lifecycle: '即将停售',
    });
    assert.equal(health, 'gray');
  });

  it('marks green when coverage is healthy', () => {
    const health = calcInventoryHealth({
      coverageDays: 150,
      totalLeadDays: 102,
      safetyStockDays: 14,
      overstockThresholdDays: 180,
    });
    assert.equal(health, 'green');
  });

  it('suggests immediate order when latest order days <= 0', () => {
    const latest = calcLatestOrderDays({
      coverageDays: calcCoverageDays(100, 2),
      totalLeadDays: 102,
      safetyStockDays: 14,
    });
    assert.ok(latest <= 0);
    assert.equal(calcSuggestedOrderDate(latest, new Date('2026-06-24')), '2026-06-24');
  });

  it('produces replenishment qty for yellow/red SKUs', () => {
    const result = calcCoverageReplenishment({
      effectiveQty: 100,
      avgDaily: 2,
      productionDays: 50,
      shippingDays: 45,
      inboundBufferDays: 7,
      safetyStockDays: 14,
      moq: 0,
      today: new Date('2026-06-24'),
    });
    assert.ok(['red', 'yellow'].includes(result.healthStatus));
    assert.equal(result.needsReplenishment, true);
    assert.ok(result.suggestedQty > 0);
    assert.equal(result.leadTime.totalLeadDays, 102);
  });
});
