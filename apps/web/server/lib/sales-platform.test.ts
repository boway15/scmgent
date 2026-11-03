import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessUnknownChannelShare,
  channelsForPlatformFilterSync,
  normalizeSalesPlatformSync,
} from './sales-platform.js';

describe('sales-platform', () => {
  it('normalizes common platform aliases on import path', () => {
    assert.equal(normalizeSalesPlatformSync('亚马逊'), 'AMAZON');
    assert.equal(normalizeSalesPlatformSync('Amazon'), 'AMAZON');
    assert.equal(normalizeSalesPlatformSync('Amazon US'), 'AMAZON');
    assert.equal(normalizeSalesPlatformSync('TikTok Shop'), 'TIKTOK');
    assert.equal(normalizeSalesPlatformSync('WALMART'), 'WALMART');
    assert.equal(normalizeSalesPlatformSync('SHOPIFY'), 'SHOPIFY');
    assert.equal(normalizeSalesPlatformSync(''), 'UNKNOWN');
    assert.equal(normalizeSalesPlatformSync('wayfair'), 'WAYFAIR');
    assert.equal(normalizeSalesPlatformSync('Wayfair'), 'WAYFAIR');
    assert.equal(normalizeSalesPlatformSync('etsy'), 'UNKNOWN');
    assert.equal(normalizeSalesPlatformSync('Etsy'), 'UNKNOWN');
    assert.equal(normalizeSalesPlatformSync('Shein'), 'UNKNOWN');
    assert.equal(normalizeSalesPlatformSync('Shein美国'), 'UNKNOWN');
    assert.equal(normalizeSalesPlatformSync('manomano'), 'MANOMANO');
    assert.equal(normalizeSalesPlatformSync('Real'), 'REAL');
    assert.equal(normalizeSalesPlatformSync('otto'), 'OTTO');
    assert.equal(normalizeSalesPlatformSync('B2B小包'), 'B2B');
    assert.equal(normalizeSalesPlatformSync('B2B'), 'B2B');
    assert.equal(normalizeSalesPlatformSync('独立站'), 'SHOPIFY');
    assert.equal(normalizeSalesPlatformSync('品牌站'), 'SHOPIFY');
    assert.equal(normalizeSalesPlatformSync('DTC'), 'SHOPIFY');
    assert.equal(normalizeSalesPlatformSync('Shopify'), 'SHOPIFY');
    assert.equal(normalizeSalesPlatformSync('eBay'), 'EBAY');
    assert.equal(normalizeSalesPlatformSync('未知平台XYZ'), 'UNKNOWN');
  });

  it('expands platform filter to include legacy alias channels', () => {
    const aliases = channelsForPlatformFilterSync('AMAZON');
    assert.ok(aliases.includes('AMAZON'));
    assert.ok(aliases.includes('亚马逊'));
    assert.ok(aliases.includes('AMZ'));
    assert.ok(!aliases.includes('SHOPIFY'));
  });

  it('keeps UNKNOWN filter free of named platforms and folds DTC into Shopify', () => {
    const unknown = channelsForPlatformFilterSync('UNKNOWN');
    for (const code of ['SHOPIFY', 'DTC', 'EBAY', 'WAYFAIR']) {
      assert.ok(!unknown.includes(code), `UNKNOWN must not include ${code}`);
    }
    assert.ok(unknown.includes('UNKNOWN'));
    assert.ok(unknown.includes('未知'));

    const shopify = channelsForPlatformFilterSync('SHOPIFY');
    for (const code of ['SHOPIFY', '独立站', 'DTC']) {
      assert.ok(shopify.includes(code), `SHOPIFY must include ${code}`);
    }
  });

  it('does not fold SHOPIFY into other V4.1 platform filters', () => {
    for (const platform of ['AMAZON', 'WALMART', 'TEMU', 'TIKTOK'] as const) {
      const aliases = channelsForPlatformFilterSync(platform);
      assert.ok(!aliases.includes('SHOPIFY'), `${platform} must not include SHOPIFY`);
      assert.ok(!aliases.includes('DTC'), `${platform} must not include DTC`);
      assert.ok(!aliases.includes('EBAY'), `${platform} must not include EBAY`);
    }
  });

  it('assessUnknownChannelShare warns above threshold', () => {
    const ok = assessUnknownChannelShare({ totalRows: 100, unknownRows: 3 });
    assert.equal(ok.warning, undefined);
    const bad = assessUnknownChannelShare({ totalRows: 100, unknownRows: 12 });
    assert.ok(bad.warning?.includes('UNKNOWN'));
  });
});
