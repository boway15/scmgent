import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupDailySalesBySkuId,
  type DailySalesPoint,
} from './sales-history-query.js';
import {
  replenishmentSalesLookbackDays,
  salesHistoryDailyRetentionDays,
  salesHistoryLookbackCutoff,
  salesHistoryDailyRetentionCutoff,
} from './sales-history-config.js';

describe('sales-history-config', () => {
  it('defaults retention to 365 and replenishment lookback to 90', () => {
    const prevRetention = process.env.SALES_HISTORY_DAILY_RETENTION_DAYS;
    const prevLookback = process.env.REPLENISHMENT_SALES_LOOKBACK_DAYS;
    delete process.env.SALES_HISTORY_DAILY_RETENTION_DAYS;
    delete process.env.REPLENISHMENT_SALES_LOOKBACK_DAYS;
    try {
      assert.equal(salesHistoryDailyRetentionDays(), 365);
      assert.equal(replenishmentSalesLookbackDays(), 90);
    } finally {
      if (prevRetention) process.env.SALES_HISTORY_DAILY_RETENTION_DAYS = prevRetention;
      if (prevLookback) process.env.REPLENISHMENT_SALES_LOOKBACK_DAYS = prevLookback;
    }
  });

  it('computes lookback cutoff from fixed today', () => {
    const today = new Date('2026-06-30T12:00:00Z');
    assert.equal(salesHistoryLookbackCutoff(90, today), '2026-04-01');
    assert.equal(salesHistoryDailyRetentionCutoff(today), '2025-06-30');
  });
});

describe('sales-history-query', () => {
  it('groups daily sales by sku id', () => {
    const rows: DailySalesPoint[] = [
      { skuId: 'a', qtySold: 1, saleDate: '2026-01-01', warehouseCode: null },
      { skuId: 'b', qtySold: 2, saleDate: '2026-01-02', warehouseCode: 'US-WEST' },
      { skuId: 'a', qtySold: 3, saleDate: '2026-01-03', warehouseCode: null },
    ];
    const map = groupDailySalesBySkuId(rows);
    assert.equal(map.get('a')?.length, 2);
    assert.equal(map.get('b')?.length, 1);
  });
});
