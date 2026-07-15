import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickLatestPublishedVersionPerSku } from './forecast-published-resolve.js';

describe('forecast-published-resolve', () => {
  it('pickLatestPublishedVersionPerSku uses latest publishedAt per sku', () => {
    const map = pickLatestPublishedVersionPerSku([
      { skuId: 'sku-a', versionId: 'v-old', publishedAt: new Date('2026-06-01T00:00:00.000Z') },
      { skuId: 'sku-a', versionId: 'v-new', publishedAt: new Date('2026-07-01T00:00:00.000Z') },
      { skuId: 'sku-b', versionId: 'v-only', publishedAt: new Date('2026-05-01T00:00:00.000Z') },
    ]);
    assert.equal(map.get('sku-a'), 'v-new');
    assert.equal(map.get('sku-b'), 'v-only');
  });

  it('pickLatestPublishedVersionPerSku ignores rows without publishedAt when newer exists', () => {
    const map = pickLatestPublishedVersionPerSku([
      { skuId: 'sku-a', versionId: 'v-null', publishedAt: null },
      { skuId: 'sku-a', versionId: 'v-dated', publishedAt: new Date('2026-07-01T00:00:00.000Z') },
    ]);
    assert.equal(map.get('sku-a'), 'v-dated');
  });
});
