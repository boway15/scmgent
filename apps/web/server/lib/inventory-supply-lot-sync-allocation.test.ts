import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAllocationBySku,
  resolveDraftLeadWarehouse,
} from './inventory-supply-lot-sync.js';

describe('buildAllocationBySku', () => {
  it('reads sales share, transit buckets, and earliest date from encodingMeta snapshot', () => {
    const skuId = 'sku-west-share';
    const map = buildAllocationBySku([
      {
        skuId,
        encodingMeta: {
          turnoverSnapshot: {
            美西: '0.6',
            预计10天上架_合计: '10',
            最早在途上架时间: '2026-10-01',
          },
        },
      },
    ]);

    const ctx = map.get(skuId);
    assert.ok(ctx);
    assert.equal(ctx.share.method, 'sales_share');
    assert.equal(ctx.transitBuckets.d5, 10);
    assert.ok(ctx.earliestAvailableAt);
    assert.equal(ctx.earliestAvailableAt, '2026-10-01');
  });
});

describe('resolveDraftLeadWarehouse', () => {
  it('prefers draft warehouse, then first share weight, then US-WEST', () => {
    const skuId = 'sku-lead';
    const allocationBySku = buildAllocationBySku([
      {
        skuId,
        encodingMeta: {
          turnoverSnapshot: {
            美东: '1',
          },
        },
      },
    ]);

    assert.equal(
      resolveDraftLeadWarehouse('EU-CENTRAL', skuId, allocationBySku),
      'EU-CENTRAL',
    );
    assert.equal(resolveDraftLeadWarehouse(null, skuId, allocationBySku), 'US-EAST');
    assert.equal(resolveDraftLeadWarehouse(null, 'missing-sku', new Map()), 'US-WEST');
  });
});
