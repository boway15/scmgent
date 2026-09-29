import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGrayLifecycleSqlCondition,
  calcConfirmedCoverageDays,
  calcInventoryHealth,
  calcTimelineDecisionHealth,
  estimateInventoryHealthQuick,
  isGrayLifecycle,
  isSlowMovingStock,
  normalizeInventoryHealth,
  pickWorstInventoryHealth,
} from './inventory-light.js';

describe('inventory-light', () => {
  it('normalizes legacy health values', () => {
    assert.equal(normalizeInventoryHealth('healthy'), 'green');
    assert.equal(normalizeInventoryHealth('overstock'), 'blue');
  });

  it('detects gray lifecycle keywords', () => {
    assert.equal(isGrayLifecycle('即将停售'), true);
    assert.equal(isGrayLifecycle('成熟期'), false);
  });

  it('builds gray lifecycle SQL condition', () => {
    const condition = buildGrayLifecycleSqlCondition('lifecycle');
    assert.match(condition, /lower\(lifecycle\) LIKE '%停售%'/);
    assert.match(condition, /lower\(lifecycle\) LIKE '%discontinu%'/);
  });

  it('detects slow-moving stock', () => {
    assert.equal(
      isSlowMovingStock({ effectiveQty: 500, avgDaily: 0.05, coverageDays: 120 }),
      true,
    );
    assert.equal(
      isSlowMovingStock({ effectiveQty: 500, avgDaily: 2, coverageDays: 120 }),
      false,
    );
  });

  it('prioritizes gray over red', () => {
    assert.equal(
      calcInventoryHealth({
        coverageDays: 10,
        totalLeadDays: 102,
        safetyStockDays: 14,
        overstockThresholdDays: 180,
        lifecycle: '滞销',
      }),
      'gray',
    );
  });

  it('estimates health from ROP ratio', () => {
    assert.equal(estimateInventoryHealthQuick({ effectiveQty: 300, reorderPoint: 100 }), 'blue');
    assert.equal(estimateInventoryHealthQuick({ effectiveQty: 50, reorderPoint: 100 }), 'red');
    assert.equal(estimateInventoryHealthQuick({ effectiveQty: 110, reorderPoint: 100 }), 'yellow');
    assert.equal(estimateInventoryHealthQuick({ effectiveQty: 200, reorderPoint: 100 }), 'green');
  });

  it('calcConfirmedCoverageDays prefers stockout date span', () => {
    assert.equal(
      calcConfirmedCoverageDays({
        today: '2026-09-01',
        stockoutDateConfirmed: '2026-09-21',
        confirmedEndingToday: 999,
        avgDaily: 10,
      }),
      20,
    );
  });

  it('timeline decision red when uncoverable even if coverage health would be green', () => {
    assert.equal(
      calcTimelineDecisionHealth({
        today: '2026-09-01',
        totalLeadDays: 90,
        safetyStockDays: 14,
        overstockThresholdDays: 180,
        suggestedQty: 500,
        uncoverableByNewPo: true,
        stockoutDateConfirmed: '2026-09-20',
        safetyBreachDateConfirmed: '2026-09-10',
        confirmedCoverageDays: 200,
        avgDaily: 5,
        effectiveQty: 1000,
      }),
      'red',
    );
  });

  it('timeline decision green when suggestedQty is 0 despite coverage yellow inputs', () => {
    assert.equal(
      calcTimelineDecisionHealth({
        today: '2026-09-01',
        totalLeadDays: 90,
        safetyStockDays: 14,
        overstockThresholdDays: 180,
        suggestedQty: 0,
        uncoverableByNewPo: false,
        stockoutDateConfirmed: '2027-03-01',
        safetyBreachDateConfirmed: null,
        confirmedCoverageDays: 120,
        avgDaily: 5,
        effectiveQty: 600,
      }),
      'green',
    );
  });

  it('timeline decision yellow when suggestedQty > 0 without near stockout', () => {
    assert.equal(
      calcTimelineDecisionHealth({
        today: '2026-09-01',
        totalLeadDays: 90,
        safetyStockDays: 14,
        overstockThresholdDays: 180,
        suggestedQty: 200,
        uncoverableByNewPo: false,
        stockoutDateConfirmed: '2027-01-01',
        safetyBreachDateConfirmed: null,
        confirmedCoverageDays: 120,
        avgDaily: 5,
        effectiveQty: 600,
      }),
      'yellow',
    );
  });
});

describe('pickWorstInventoryHealth', () => {
  it('returns null for empty', () => {
    assert.equal(pickWorstInventoryHealth([]), null);
  });

  it('picks red over yellow over green over blue over gray', () => {
    assert.equal(pickWorstInventoryHealth(['gray', 'blue', 'green']), 'green');
    assert.equal(pickWorstInventoryHealth(['blue', 'yellow', 'gray']), 'yellow');
    assert.equal(pickWorstInventoryHealth(['green', 'red', 'yellow']), 'red');
    assert.equal(pickWorstInventoryHealth(['gray']), 'gray');
  });
});
