import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeDemandPlanInlineV41ForSku } from './demand-plan-inline-v41.js';

describe('demand-plan-inline-v41', () => {
  it('aggregates per-platform V4.1 into merged month map', () => {
    const windowEnd = new Date(Date.UTC(2026, 10, 2));
    const horizonMonthKeys = ['2026-11'];
    const dailyRow = (date: string, qty: number) => ({
      skuId: 's1',
      saleDate: date,
      qtySold: qty,
      warehouseCode: null,
    });
    const dailyAmazon = Array.from({ length: 90 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7, 5 + i));
      return dailyRow(d.toISOString().slice(0, 10), 60);
    });
    const monthlyAmazon = [{ saleYear: 2025, month: 11, qtySold: 1800 }];

    const result = computeDemandPlanInlineV41ForSku({
      sku: { productCategory: 'bedroom', category: 'bedroom' },
      windowEnd,
      horizonMonthKeys,
      dailyAllRows: dailyAmazon,
      dailyByPlatform: new Map([['AMAZON', dailyAmazon]]),
      monthlyByPlatform: new Map([['AMAZON', monthlyAmazon]]),
      firstSaleDate: '2022-01-01',
    });

    assert.ok(result.mergedMap.size > 0, 'expected merged forecast months');
    const nov = result.mergedMap.get('2026-11') ?? 0;
    assert.ok(nov > 0, `expected positive forecast daily, got ${nov}`);
    assert.ok(result.profileSegment, 'expected anchor tier');
    assert.equal(result.recent30DailyAvg, 60);
    assert.equal(result.recent90DailyAvg, 60);
  });

  it('aggregates V4.1 factors across platforms in ALL view and scopes single platform in targetPlatform view', () => {
    const windowEnd = new Date(Date.UTC(2026, 10, 2));
    const horizonMonthKeys = ['2026-11'];
    const dailyRow = (date: string, qty: number) => ({
      skuId: 's1',
      saleDate: date,
      qtySold: qty,
      warehouseCode: null,
    });
    const dailyAmazon = Array.from({ length: 90 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7, 5 + i));
      return dailyRow(d.toISOString().slice(0, 10), 60);
    });
    const dailyShopify = Array.from({ length: 90 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7, 5 + i));
      return dailyRow(d.toISOString().slice(0, 10), 30);
    });
    const dailyAll = Array.from({ length: 90 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7, 5 + i));
      return dailyRow(d.toISOString().slice(0, 10), 90);
    });
    const monthlyAmazon = [{ saleYear: 2025, month: 11, qtySold: 1800 }];
    const monthlyShopify = [{ saleYear: 2025, month: 11, qtySold: 900 }];

    const allView = computeDemandPlanInlineV41ForSku({
      sku: { productCategory: 'bedroom', category: 'bedroom' },
      windowEnd,
      horizonMonthKeys,
      dailyAllRows: dailyAll,
      dailyByPlatform: new Map([
        ['AMAZON', dailyAmazon],
        ['SHOPIFY', dailyShopify],
      ]),
      monthlyByPlatform: new Map([
        ['AMAZON', monthlyAmazon],
        ['SHOPIFY', monthlyShopify],
      ]),
      firstSaleDate: '2022-01-01',
      targetPlatform: 'ALL',
    });

    const shopifyView = computeDemandPlanInlineV41ForSku({
      sku: { productCategory: 'bedroom', category: 'bedroom' },
      windowEnd,
      horizonMonthKeys,
      dailyAllRows: dailyAll,
      dailyByPlatform: new Map([
        ['AMAZON', dailyAmazon],
        ['SHOPIFY', dailyShopify],
      ]),
      monthlyByPlatform: new Map([
        ['AMAZON', monthlyAmazon],
        ['SHOPIFY', monthlyShopify],
      ]),
      firstSaleDate: '2022-01-01',
      targetPlatform: 'SHOPIFY',
    });

    const allCell = allView.monthCells[0];
    const shopifyCell = shopifyView.monthCells[0];
    assert.ok(allCell && shopifyCell);
    assert.equal(allCell.allCatV41Factors?.platformContributions?.length, 2);
    assert.ok((allCell.forecastDailyAvg ?? 0) > (shopifyCell.forecastDailyAvg ?? 0));
    assert.equal(shopifyView.recent30DailyAvg, 30);
  });
});
