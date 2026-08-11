import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSalesHistoryImportPlan } from './sales-history-import.js';

describe('sales-history-import', () => {
  it('matches parsed daily rows by SKU code and collapses duplicate import identities', () => {
    const plan = buildSalesHistoryImportPlan(
      [
        {
          skuCode: 'SKU1',
          skuName: 'Desk',
          station: 'US',
          platformRaw: 'Amazon',
          firstOrderAt: '',
          category: '',
          saleDate: '2026-06-26',
          qtySold: 2,
        },
        {
          skuCode: 'SKU1',
          skuName: 'Desk',
          station: 'US',
          platformRaw: 'Amazon',
          firstOrderAt: '',
          category: '',
          saleDate: '2026-06-26',
          qtySold: 3,
        },
        {
          skuCode: 'MISSING',
          skuName: 'Unknown',
          station: 'US',
          platformRaw: 'Amazon',
          firstOrderAt: '',
          category: '',
          saleDate: '2026-06-26',
          qtySold: 4,
        },
      ],
      new Map([['SKU1', 'sku-1']]),
      new Map([['sku-1', 'Outdoor/Patio']]),
    );

    assert.deepEqual(plan.rows, [
      {
        skuId: 'sku-1',
        saleDate: '2026-06-26',
        qtySold: 5,
        channel: 'AMAZON',
        station: 'US',
        category: 'Outdoor/Patio',
      },
    ]);
    assert.equal(plan.unmatchedSkuCount, 1);
    assert.deepEqual(plan.errors, ['SKU could not be created for daily sales row: MISSING']);
  });

  it('keeps same SKU/date/channel separate when report stations differ', () => {
    const plan = buildSalesHistoryImportPlan(
      [
        {
          skuCode: 'SKU1',
          skuName: 'Desk',
          station: 'Amazon美国',
          platformRaw: 'Amazon',
          firstOrderAt: '',
          category: '',
          saleDate: '2026-06-26',
          qtySold: 2,
        },
        {
          skuCode: 'SKU1',
          skuName: 'Desk',
          station: 'Amazon英国',
          platformRaw: 'Amazon',
          firstOrderAt: '',
          category: '',
          saleDate: '2026-06-26',
          qtySold: 3,
        },
        {
          skuCode: 'SKU1',
          skuName: 'Desk',
          station: 'Amazon德国',
          platformRaw: 'Amazon',
          firstOrderAt: '',
          category: '',
          saleDate: '2026-06-26',
          qtySold: 4,
        },
      ],
      new Map([['SKU1', 'sku-1']]),
      new Map([['sku-1', null]]),
    );

    assert.equal(plan.rows.length, 3);
    assert.equal(plan.rows.find((r) => r.station === 'US')?.qtySold, 2);
    assert.equal(plan.rows.find((r) => r.station === 'UK')?.qtySold, 3);
    assert.equal(plan.rows.find((r) => r.station === 'EU')?.qtySold, 4);
  });

  it('normalizes Chinese platform labels to standard channel codes', () => {
    const plan = buildSalesHistoryImportPlan(
      [
        {
          skuCode: 'SKU1',
          skuName: 'Desk',
          station: 'US',
          platformRaw: '亚马逊',
          firstOrderAt: '',
          category: '',
          saleDate: '2026-06-26',
          qtySold: 2,
        },
      ],
      new Map([['SKU1', 'sku-1']]),
      new Map([['sku-1', null]]),
    );

    assert.equal(plan.rows[0]?.channel, 'AMAZON');
  });

  it('prefers category from xiaoshou row over sku master snapshot', () => {
    const plan = buildSalesHistoryImportPlan(
      [
        {
          skuCode: 'SKU1',
          skuName: 'Nightstand',
          station: 'US',
          platformRaw: 'Amazon',
          firstOrderAt: '',
          category: 'DJ02-家具事业1部\\Amazon项目1组\\卧室-床头柜Nightstands',
          saleDate: '2026-06-26',
          qtySold: 2,
        },
      ],
      new Map([['SKU1', 'sku-1']]),
      new Map([['sku-1', 'Outdoor/Patio']]),
    );

    assert.equal(
      plan.rows[0]?.category,
      'DJ02-家具事业1部\\Amazon项目1组\\卧室-床头柜Nightstands',
    );
  });

  it('resolves SKU id via normalized legacy code when map uses uppercase key', () => {
    const plan = buildSalesHistoryImportPlan(
      [
        {
          skuCode: 'dj502313_34',
          skuName: 'Desk',
          station: 'US',
          platformRaw: 'Amazon',
          firstOrderAt: '',
          category: '',
          saleDate: '2026-06-26',
          qtySold: 2,
        },
      ],
      new Map([['DJ502313_34', 'sku-legacy']]),
      new Map([['sku-legacy', 'Outdoor/Patio']]),
    );

    assert.equal(plan.rows[0]?.skuId, 'sku-legacy');
    assert.equal(plan.unmatchedSkuCount, 0);
  });
});
