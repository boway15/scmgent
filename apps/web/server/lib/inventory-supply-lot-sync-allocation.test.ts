import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAllocationBySku } from './inventory-supply-lot-sync.js';

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
