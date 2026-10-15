import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessUnknownChannelShare,
  channelsForPlatformFilterSync,
  FORECAST_UNKNOWN_BUCKET_CHANNELS,
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
    assert.equal(normalizeSalesPlatformSync('未知平台XYZ'), 'UNKNOWN');
  });

  it('expands platform filter to include legacy alias channels', () => {
    const aliases = channelsForPlatformFilterSync('AMAZON');
    assert.ok(aliases.includes('AMAZON'));
    assert.ok(aliases.includes('亚马逊'));
    assert.ok(aliases.includes('AMZ'));
    assert.ok(!aliases.includes('SHOPIFY'));
  });

  it('folds indie channels into UNKNOWN forecast query bucket', () => {
    const aliases = channelsForPlatformFilterSync('UNKNOWN');
    assert.ok(aliases.includes('UNKNOWN'));
    assert.ok(aliases.includes('未知'));
    for (const code of FORECAST_UNKNOWN_BUCKET_CHANNELS) {
      assert.ok(aliases.includes(code), `expected ${code} in UNKNOWN bucket`);
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
