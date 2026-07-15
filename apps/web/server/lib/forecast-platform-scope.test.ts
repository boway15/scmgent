import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countBaselineForecastPlatforms,
  FORECAST_V41_PLATFORM_CODES,
  forecastPlatformCondition,
  isForecastV41PlatformCode,
  resolveBaselineForecastPlatforms,
  resolveForecastPlatformFilter,
} from './forecast-platform-scope.js';

describe('forecast-platform-scope', () => {
  it('expands ALL to V4.1 platform codes', () => {
    assert.deepEqual(resolveBaselineForecastPlatforms('ALL'), [...FORECAST_V41_PLATFORM_CODES]);
    assert.deepEqual(resolveBaselineForecastPlatforms(''), [...FORECAST_V41_PLATFORM_CODES]);
    assert.deepEqual(resolveBaselineForecastPlatforms(undefined), [...FORECAST_V41_PLATFORM_CODES]);
    assert.equal(countBaselineForecastPlatforms('ALL'), FORECAST_V41_PLATFORM_CODES.length);
  });

  it('returns single platform for specific selection', () => {
    assert.deepEqual(resolveBaselineForecastPlatforms('AMAZON'), ['AMAZON']);
    assert.deepEqual(resolveBaselineForecastPlatforms('亚马逊'), ['AMAZON']);
    assert.equal(countBaselineForecastPlatforms('AMAZON'), 1);
  });

  it('normalizes unknown platform codes', () => {
    assert.deepEqual(resolveBaselineForecastPlatforms('walmart'), ['WALMART']);
  });

  it('resolves forecast platform filter for queries', () => {
    assert.deepEqual(resolveForecastPlatformFilter('ALL'), [...FORECAST_V41_PLATFORM_CODES]);
    assert.deepEqual(resolveForecastPlatformFilter('AMAZON'), ['AMAZON']);
    assert.equal(resolveForecastPlatformFilter(undefined), undefined);
    assert.equal(resolveForecastPlatformFilter(''), undefined);
  });

  it('identifies V4.1 platform membership', () => {
    assert.equal(isForecastV41PlatformCode('AMAZON'), true);
    assert.equal(isForecastV41PlatformCode('EBAY'), false);
  });

  it('builds platform SQL filter for ALL and single platform', () => {
    const col = { name: 'platform' } as import('drizzle-orm').AnyColumn;
    assert.equal(forecastPlatformCondition(col, undefined), undefined);
    assert.equal(forecastPlatformCondition(col, ''), undefined);
    assert.ok(forecastPlatformCondition(col, 'ALL'));
    assert.ok(forecastPlatformCondition(col, 'AMAZON'));
  });
});
