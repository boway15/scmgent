import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSkuSalesHistory, reconcileSkuSalesHistoryFromAggregates } from './sales-history-reconcile.js';

describe('reconcileSkuSalesHistory', () => {
  it('flags >5% mismatch when monthly qty is at least 30', () => {
    const result = reconcileSkuSalesHistory({
      dailyRows: [
        {
          skuCode: 'SKU-A',
          skuName: '',
          station: 'US',
          platformRaw: '亚马逊',
          firstOrderAt: '',
          category: '',
          saleDate: '2026-05-01',
          qtySold: 50,
        },
        {
          skuCode: 'SKU-A',
          skuName: '',
          station: 'US',
          platformRaw: '亚马逊',
          firstOrderAt: '',
          category: '',
          saleDate: '2026-05-02',
          qtySold: 50,
        },
      ],
      monthlyRows: [
        {
          skuCode: 'SKU-A',
          skuName: '',
          station: 'US',
          platformRaw: '亚马逊',
          category: '',
          saleYear: 2026,
          month: 5,
          qtySold: 100,
        },
      ],
    });

    assert.equal(result.matchedMonths, 1);
    assert.equal(result.mismatchCount, 0);
    assert.equal(result.topMismatches.length, 0);
  });

  it('reports mismatch when daily sum diverges from monthly', () => {
    const result = reconcileSkuSalesHistory({
      dailyRows: [
        {
          skuCode: 'SKU-B',
          skuName: '',
          station: 'US',
          platformRaw: '亚马逊',
          firstOrderAt: '',
          category: '',
          saleDate: '2026-05-15',
          qtySold: 40,
        },
      ],
      monthlyRows: [
        {
          skuCode: 'SKU-B',
          skuName: '',
          station: 'US',
          platformRaw: '亚马逊',
          category: '',
          saleYear: 2026,
          month: 5,
          qtySold: 100,
        },
      ],
    });

    assert.equal(result.mismatchCount, 1);
    assert.equal(result.topMismatches[0].diff, -60);
    assert.equal(result.topMismatches[0].diffPct, -0.6);
  });
});

describe('reconcileSkuSalesHistoryFromAggregates', () => {
  it('matches reconcileSkuSalesHistory for aggregated monthly daily rows', () => {
    const monthlyRows = [
      {
        skuCode: 'SKU-B',
        skuName: '',
        station: 'US',
        platformRaw: '亚马逊',
        category: '',
        saleYear: 2026,
        month: 5,
        qtySold: 100,
      },
    ];
    const fromDaily = reconcileSkuSalesHistory({
      dailyRows: [
        {
          skuCode: 'SKU-B',
          skuName: '',
          station: 'US',
          platformRaw: '亚马逊',
          firstOrderAt: '',
          category: '',
          saleDate: '2026-05-15',
          qtySold: 40,
        },
      ],
      monthlyRows,
    });
    const fromAgg = reconcileSkuSalesHistoryFromAggregates({
      dailyAggRows: [
        {
          skuCode: 'SKU-B',
          platformRaw: '亚马逊',
          saleYear: 2026,
          month: 5,
          qtySold: 40,
        },
      ],
      monthlyRows,
    });
    assert.equal(fromAgg.mismatchCount, fromDaily.mismatchCount);
    assert.equal(fromAgg.topMismatches[0]?.diff, fromDaily.topMismatches[0]?.diff);
  });
});
