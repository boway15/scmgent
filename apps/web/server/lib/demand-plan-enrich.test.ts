import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitMergedWeeklyDailyByPlatform } from './demand-plan-enrich.js';

describe('demand-plan-enrich', () => {
  it('splits merged weekly daily by platform month shape weights', () => {
    const monthByPlatform = new Map([
      ['AMAZON', new Map([['2026-09', 10]])],
      ['SHOPIFY', new Map([['2026-09', 5]])],
    ]);
    const { breakdown, byPlatformEffective } = splitMergedWeeklyDailyByPlatform({
      period: '2026-W39',
      mergedSystemDaily: 9,
      mergedManualDaily: null,
      monthByPlatform,
      platforms: ['AMAZON', 'SHOPIFY'],
    });
    assert.equal(breakdown.length, 2);
    assert.equal(byPlatformEffective.get('AMAZON'), 6);
    assert.equal(byPlatformEffective.get('SHOPIFY'), 3);
  });

  it('even-splits merged weekly daily when published month shape is missing', () => {
    const { breakdown, byPlatformEffective } = splitMergedWeeklyDailyByPlatform({
      period: '2026-W39',
      mergedSystemDaily: 10,
      mergedManualDaily: null,
      monthByPlatform: new Map(),
      platforms: ['AMAZON', 'SHOPIFY'],
    });
    assert.equal(breakdown.length, 2);
    assert.equal(byPlatformEffective.get('AMAZON'), 5);
    assert.equal(byPlatformEffective.get('SHOPIFY'), 5);
  });
});
