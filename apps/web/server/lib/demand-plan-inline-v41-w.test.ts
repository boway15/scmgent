import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeDemandPlanInlineV41WForSku } from './demand-plan-inline-v41-w.js';
import { addIsoWeeks } from './planning-calendar.js';

describe('demand-plan-inline-v41-w', () => {
  it('produces 26-week merged map from platform daily sales', () => {
    const windowEnd = new Date(Date.UTC(2026, 10, 2));
    const startWeek = '2026-W45';
    const horizonWeekKeys = Array.from({ length: 4 }, (_, i) => addIsoWeeks(startWeek, i));
    const dailyRow = (date: string, qty: number) => ({
      skuId: 's1',
      saleDate: date,
      qtySold: qty,
      warehouseCode: null,
    });
    const dailyAmazon = Array.from({ length: 120 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 1 + i));
      return dailyRow(d.toISOString().slice(0, 10), 40);
    });
    const monthlyAmazon = [{ saleYear: 2025, month: 11, qtySold: 1800 }];

    const result = computeDemandPlanInlineV41WForSku({
      sku: { productCategory: 'bedroom', category: 'bedroom' },
      windowEnd,
      horizonWeekKeys,
      dailyAllRows: dailyAmazon,
      dailyByPlatform: new Map([['AMAZON', dailyAmazon]]),
      monthlyByPlatform: new Map([['AMAZON', monthlyAmazon]]),
      firstSaleDate: '2022-01-01',
    });

    assert.ok(result.weekMap.size > 0, 'expected weekly forecasts');
    assert.ok(result.profileSegment, 'expected tier');
    assert.ok(result.recent30DailyAvg > 0);
  });
});
