import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBaselineDraftVersionName,
  parseBaselinePlatformFromVersionName,
} from './forecast-version-label.js';

describe('forecast-version-label', () => {
  it('builds readable draft labels for common generation scopes', () => {
    const now = new Date('2026-07-06T10:00:00.000Z');
    assert.equal(
      buildBaselineDraftVersionName({ monthCount: 6, platform: 'ALL', now }),
      '6 个月 · 全平台 · 全量 SKU · 2026-07-06',
    );
    assert.equal(
      buildBaselineDraftVersionName({ monthCount: 3, platform: 'AMAZON', now }),
      '3 个月 · 亚马逊 · 全量 SKU · 2026-07-06',
    );
    assert.equal(
      buildBaselineDraftVersionName({
        monthCount: 6,
        platform: 'WALMART',
        category: '家居',
        now,
      }),
      '6 个月 · 沃尔玛 · 品类 家居 · 2026-07-06',
    );
    assert.equal(
      buildBaselineDraftVersionName({
        monthCount: 6,
        platform: 'AMAZON',
        skuCode: 'abc-123',
        now,
      }),
      '6 个月 · 亚马逊 · 单 SKU ABC-123 · 2026-07-06',
    );
  });

  it('parses generation platform from auto version names', () => {
    assert.equal(
      parseBaselinePlatformFromVersionName('6 个月 · 亚马逊 · 全量 SKU · 2026-07-06'),
      'AMAZON',
    );
    assert.equal(
      parseBaselinePlatformFromVersionName('6 个月 · 全平台 · 全量 SKU · 2026-07-06'),
      null,
    );
    assert.equal(parseBaselinePlatformFromVersionName('DRAFT-123'), null);
  });
});
