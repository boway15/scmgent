import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calcSafetyStockSuggestion,
  MAX_SUGGESTED_SAFETY_STOCK_DAYS,
} from './safety-stock-suggestion.js';

describe('calcSafetyStockSuggestion', () => {
  it('computes qty, days, and ROP for normal inputs', () => {
    const result = calcSafetyStockSuggestion({
      avgDaily: 10,
      demandStdDev: 4,
      totalLeadDays: 90,
      serviceLevel: 0.95,
      inStockDays: 60,
      demandSource: 'historical',
      effectiveSalesDays: 60,
    });
    assert.equal(result.method, 'z_demand');
    assert.equal(result.safetyStockQty, 63);
    assert.equal(result.safetyStockDays, 7);
    assert.equal(result.reorderPoint, 963);
    assert.equal(result.confidence, 'high');
    assert.deepEqual(result.flags, []);
  });

  it('returns null outputs and no_sales when avgDaily is zero', () => {
    const result = calcSafetyStockSuggestion({
      avgDaily: 0,
      demandStdDev: 0,
      totalLeadDays: 90,
    });
    assert.equal(result.safetyStockQty, null);
    assert.equal(result.safetyStockDays, null);
    assert.equal(result.reorderPoint, null);
    assert.equal(result.confidence, 'low');
    assert.ok(result.flags.includes('no_sales'));
  });

  it('caps suggested days at MAX and sets days_capped flag', () => {
    const result = calcSafetyStockSuggestion({
      avgDaily: 0.1,
      demandStdDev: 10,
      totalLeadDays: 90,
      effectiveSalesDays: 30,
    });
    assert.equal(result.safetyStockDays, MAX_SUGGESTED_SAFETY_STOCK_DAYS);
    assert.ok(result.flags.includes('days_capped'));
  });

  it('uses lead_time_fallback when totalLeadDays <= 0', () => {
    const result = calcSafetyStockSuggestion({
      avgDaily: 5,
      demandStdDev: 2,
      totalLeadDays: 0,
      effectiveSalesDays: 20,
    });
    assert.equal(result.totalLeadDays, 1);
    assert.ok(result.flags.includes('lead_time_fallback'));
  });

  it('marks stockout_adjusted with medium confidence', () => {
    const result = calcSafetyStockSuggestion({
      avgDaily: 8,
      demandStdDev: 3,
      totalLeadDays: 30,
      stockoutAdjusted: true,
      inStockDays: 40,
      effectiveSalesDays: 40,
    });
    assert.equal(result.confidence, 'medium');
    assert.ok(result.flags.includes('stockout_adjusted'));
  });

  it('gives high confidence for forecast demand', () => {
    const result = calcSafetyStockSuggestion({
      avgDaily: 12,
      demandStdDev: 4,
      totalLeadDays: 45,
      demandSource: 'forecast',
      effectiveSalesDays: 45,
    });
    assert.equal(result.confidence, 'high');
    assert.ok(result.flags.includes('forecast_demand'));
  });
});
