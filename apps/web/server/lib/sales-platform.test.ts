import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  channelsForPlatformFilterSync,
  normalizeSalesPlatformSync,
} from './sales-platform.js';

describe('sales-platform', () => {
  it('normalizes common platform aliases on import path', () => {
    assert.equal(normalizeSalesPlatformSync('亚马逊'), 'AMAZON');
    assert.equal(normalizeSalesPlatformSync('Amazon'), 'AMAZON');
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
});
