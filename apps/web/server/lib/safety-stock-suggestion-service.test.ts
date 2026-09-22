import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSuggestionRow,
  sortSuggestionRows,
} from './safety-stock-suggestion-service.js';
import { calcSafetyStockSuggestion } from './safety-stock-suggestion.js';

describe('buildSuggestionRow', () => {
  it('computes delta fields', () => {
    const suggested = calcSafetyStockSuggestion({
      avgDaily: 10,
      demandStdDev: 4,
      totalLeadDays: 90,
      effectiveSalesDays: 60,
      inStockDays: 60,
    });
    const row = buildSuggestionRow({
      skuId: 'sku-1',
      skuCode: 'SKU-A',
      warehouseCode: 'US-WEST',
      configured: {
        safetyStockDays: 14,
        safetyStockQty: 280,
        reorderPoint: 1180,
        safetyStockMethod: 'coverage_days',
      },
      suggested,
    });
    assert.equal(row.deltaDays, -7);
    assert.equal(row.deltaQty, -217);
    assert.ok(row.deltaPctDays != null && row.deltaPctDays > 0.4);
  });

  it('returns null deltas when suggested days are null', () => {
    const suggested = calcSafetyStockSuggestion({
      avgDaily: 0,
      demandStdDev: 0,
      totalLeadDays: 90,
    });
    const row = buildSuggestionRow({
      skuId: 'sku-1',
      skuCode: 'SKU-A',
      warehouseCode: 'ALL',
      configured: {
        safetyStockDays: 14,
        safetyStockQty: 0,
        reorderPoint: 0,
        safetyStockMethod: 'coverage_days',
      },
      suggested,
    });
    assert.equal(row.deltaDays, null);
    assert.equal(row.deltaQty, null);
    assert.equal(row.deltaPctDays, null);
  });
});

describe('sortSuggestionRows', () => {
  it('sorts by absolute deltaDays desc', () => {
    const highDelta = buildSuggestionRow({
      skuId: 'a',
      skuCode: 'A',
      warehouseCode: 'ALL',
      configured: {
        safetyStockDays: 14,
        safetyStockQty: 100,
        reorderPoint: 200,
        safetyStockMethod: 'coverage_days',
      },
      suggested: calcSafetyStockSuggestion({
        avgDaily: 10,
        demandStdDev: 4,
        totalLeadDays: 90,
        effectiveSalesDays: 60,
        inStockDays: 60,
      }),
    });
    const lowDelta = buildSuggestionRow({
      skuId: 'b',
      skuCode: 'B',
      warehouseCode: 'ALL',
      configured: {
        safetyStockDays: 14,
        safetyStockQty: 100,
        reorderPoint: 200,
        safetyStockMethod: 'coverage_days',
      },
      suggested: calcSafetyStockSuggestion({
        avgDaily: 1,
        demandStdDev: 1,
        totalLeadDays: 30,
        effectiveSalesDays: 30,
        inStockDays: 30,
      }),
    });
    const sorted = sortSuggestionRows([lowDelta, highDelta], 'deltaDays_desc');
    assert.equal(sorted[0]!.skuCode, 'A');
  });

  it('sorts by skuCode asc', () => {
    const rowB = buildSuggestionRow({
      skuId: 'b',
      skuCode: 'B',
      warehouseCode: 'ALL',
      configured: {
        safetyStockDays: 14,
        safetyStockQty: 100,
        reorderPoint: 200,
        safetyStockMethod: 'coverage_days',
      },
      suggested: calcSafetyStockSuggestion({
        avgDaily: 5,
        demandStdDev: 2,
        totalLeadDays: 30,
        effectiveSalesDays: 30,
        inStockDays: 30,
      }),
    });
    const rowA = buildSuggestionRow({
      skuId: 'a',
      skuCode: 'A',
      warehouseCode: 'ALL',
      configured: {
        safetyStockDays: 14,
        safetyStockQty: 100,
        reorderPoint: 200,
        safetyStockMethod: 'coverage_days',
      },
      suggested: calcSafetyStockSuggestion({
        avgDaily: 5,
        demandStdDev: 2,
        totalLeadDays: 30,
        effectiveSalesDays: 30,
        inStockDays: 30,
      }),
    });
    const sorted = sortSuggestionRows([rowB, rowA], 'skuCode');
    assert.equal(sorted[0]!.skuCode, 'A');
  });
});
