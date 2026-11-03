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
        platform: 'ALL',
        projectGroup: '项目1组',
        now,
      }),
      '6 个月 · 全平台 · 项目组 项目1组 · 2026-07-06',
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
    assert.equal(
      buildBaselineDraftVersionName({
        monthCount: 6,
        platform: 'ALL',
        skuCode: 'abc-1, def-2',
        now,
      }),
      '6 个月 · 全平台 · SKU ABC-1、DEF-2 · 2026-07-06',
    );
    assert.equal(
      buildBaselineDraftVersionName({
        monthCount: 6,
        platform: 'ALL',
        projectGroups: ['项目1组', '项目2组'],
        now,
      }),
      '6 个月 · 全平台 · 项目组 项目1组、项目2组 · 2026-07-06',
    );
    const longName = buildBaselineDraftVersionName({
      monthCount: 6,
      platform: 'ALL',
      projectGroups: [
        'Amazon项目6组-第二曲线-US-客厅-电视柜 TV Stands',
        'Amazon项目7组-第二曲线-US-卧室-床头柜 Nightstands',
      ],
      now,
    });
    assert.match(longName, /等2个/);
    assert.match(longName, /2026-07-06$/);
  });

  it('parses generation platform from auto version names', () => {
    assert.equal(
      parseBaselinePlatformFromVersionName('6 个月 · 亚马逊 · 全量 SKU · 2026-07-06'),
      'AMAZON',
    );
    assert.equal(
      parseBaselinePlatformFromVersionName('6 个月 · Wayfair · 全量 SKU · 2026-07-06'),
      'WAYFAIR',
    );
    assert.equal(
      parseBaselinePlatformFromVersionName('6 个月 · 其他 · 全量 SKU · 2026-07-06'),
      'UNKNOWN',
    );
    assert.equal(
      parseBaselinePlatformFromVersionName('6 个月 · 全平台 · 全量 SKU · 2026-07-06'),
      null,
    );
    assert.equal(parseBaselinePlatformFromVersionName('DRAFT-123'), null);
  });

  it('labels new catalog platforms in draft version names', () => {
    const now = new Date('2026-07-06T10:00:00.000Z');
    assert.equal(
      buildBaselineDraftVersionName({ monthCount: 6, platform: 'WAYFAIR', now }),
      '6 个月 · Wayfair · 全量 SKU · 2026-07-06',
    );
    assert.equal(
      buildBaselineDraftVersionName({ monthCount: 6, platform: 'UNKNOWN', now }),
      '6 个月 · 其他 · 全量 SKU · 2026-07-06',
    );
    assert.equal(
      buildBaselineDraftVersionName({ monthCount: 6, platform: 'TIKTOK', now }),
      '6 个月 · TikTok Shop · 全量 SKU · 2026-07-06',
    );
  });
});
