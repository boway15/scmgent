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
    assert.equal(normalizeSalesPlatformSync(''), 'UNKNOWN');
    assert.equal(normalizeSalesPlatformSync('未知平台XYZ'), 'UNKNOWN');
  });

  it('expands platform filter to include legacy alias channels', () => {
    const aliases = channelsForPlatformFilterSync('AMAZON');
    assert.ok(aliases.includes('AMAZON'));
    assert.ok(aliases.includes('亚马逊'));
    assert.ok(aliases.includes('AMZ'));
  });

  it('assessUnknownChannelShare warns above threshold', () => {
    const ok = assessUnknownChannelShare({ totalRows: 100, unknownRows: 3 });
    assert.equal(ok.warning, undefined);
    const bad = assessUnknownChannelShare({ totalRows: 100, unknownRows: 12 });
    assert.ok(bad.warning?.includes('UNKNOWN'));
  });
});
