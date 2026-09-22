import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sortSuggestionRows } from '../lib/safety-stock-suggestion-service.js';
import { calcSafetyStockSuggestion } from '../lib/safety-stock-suggestion.js';
import { buildSuggestionRow } from '../lib/safety-stock-suggestion-service.js';

describe('safety stock suggestion list ordering', () => {
  it('orders by deltaDays_desc for API sort param', () => {
    const makeRow = (skuCode: string, configuredDays: number, avgDaily: number) =>
      buildSuggestionRow({
        skuId: skuCode,
        skuCode,
        warehouseCode: 'ALL',
        configured: {
          safetyStockDays: configuredDays,
          safetyStockQty: configuredDays * avgDaily,
          reorderPoint: 100,
          safetyStockMethod: 'coverage_days',
        },
        suggested: calcSafetyStockSuggestion({
          avgDaily,
          demandStdDev: avgDaily * 0.4,
          totalLeadDays: 90,
          effectiveSalesDays: 60,
          inStockDays: 60,
        }),
      });

    const lowDelta = makeRow('LOW', 14, 5);
    const highDelta = makeRow('HIGH', 30, 10);
    const rows = sortSuggestionRows([lowDelta, highDelta], 'deltaDays_desc');
    assert.ok(Math.abs(rows[0]!.deltaDays ?? 0) >= Math.abs(rows[1]!.deltaDays ?? 0));
    assert.equal(rows[0]!.skuCode, 'HIGH');
  });
});
