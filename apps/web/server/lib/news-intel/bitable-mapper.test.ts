import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapArticleToBitableFields } from './bitable-mapper.js';
import { getNewsBitableTableId, getNewsBitableV2TableId, isNewsBitableConfigured } from './config.js';
import { preferHigherTierSource } from './dedup.js';

describe('mapArticleToBitableFields', () => {
  it('maps v2 fields including multi-select tags', () => {
    const fields = mapArticleToBitableFields(
      {
        id: 'art-1',
        sourceId: 'src-1',
        canonicalUrl: 'https://example.com/a',
        urlHash: 'h1',
        title: '中文标题',
        titleZh: '中文标题',
        titleOriginal: 'English Title',
        summary: '摘要',
        bodyText: null,
        keyPoints: null,
        category: 'other',
        bitableCategory: '物流海关与关税',
        topicCategory: '物流海关与关税',
        departments: ['物流', '采购'],
        platformTags: ['Amazon'],
        countryTags: ['美国'],
        businessTags: ['关税', '海运'],
        brandTags: ['FlexiSpot'],
        tags: null,
        relevanceScore: 82,
        priority: 'high',
        status: 'published',
        sourceTier: 'tier_1',
        isOfficialSource: true,
        filterHits: '关税:2;平台:Amazon',
        businessValidity: 'valid',
        publishedAt: new Date('2026-07-20T00:00:00Z'),
        fetchedAt: new Date('2026-07-21T00:00:00Z'),
        contentHash: 'c1',
        affectedPlatforms: ['Amazon'],
        affectedRegions: ['美国'],
        language: 'en',
        bitableRecordId: null,
        bitableSyncedAt: null,
        bitableSyncStatus: 'pending',
        bitableSyncError: null,
        ingestRunId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { name: 'USTR', sourceTier: 'tier_1', isOfficial: true },
    );

    assert.equal(fields['中文标题'], '中文标题');
    assert.equal(fields['原文标题'], 'English Title');
    assert.deepEqual(fields['相关部门'], ['物流', '采购']);
    assert.deepEqual(fields['品牌标签'], ['FlexiSpot']);
    assert.equal(fields['信源等级'], '一级');
    assert.equal(fields['官方来源'], true);
    assert.equal(fields['原文语言'], '英文');
    assert.equal(fields['系统文章ID'], 'art-1');
    assert.equal(fields['业务有效性'], '有效');
    assert.equal((fields['原文链接'] as { link: string }).link, 'https://example.com/a');
    assert.ok(fields['采集时间']);
  });

  it('leaves 中文标题 empty for english article without titleZh', () => {
    const fields = mapArticleToBitableFields(
      {
        id: 'art-en',
        sourceId: 'src-1',
        canonicalUrl: 'https://example.com/en',
        urlHash: 'h2',
        title: 'Amazon updates FBA fee policy',
        titleZh: null,
        titleOriginal: 'Amazon updates FBA fee policy',
        summary: 'Fee policy update summary',
        bodyText: null,
        keyPoints: null,
        category: 'other',
        bitableCategory: '平台运营',
        topicCategory: '平台运营',
        departments: ['平台运营'],
        platformTags: ['Amazon'],
        countryTags: ['美国'],
        businessTags: [],
        brandTags: [],
        tags: null,
        relevanceScore: 70,
        priority: 'medium',
        status: 'published',
        sourceTier: 'tier_1',
        isOfficialSource: true,
        filterHits: '平台:Amazon',
        businessValidity: 'valid',
        publishedAt: null,
        fetchedAt: new Date('2026-07-22T00:00:00Z'),
        contentHash: 'c2',
        affectedPlatforms: ['Amazon'],
        affectedRegions: ['美国'],
        language: 'en',
        bitableRecordId: null,
        bitableSyncedAt: null,
        bitableSyncStatus: 'pending',
        bitableSyncError: null,
        ingestRunId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { name: 'Amazon News', sourceTier: 'tier_1', isOfficial: true },
    );

    assert.equal(fields['标题（主键）'], 'Amazon updates FBA fee policy');
    assert.equal(fields['中文标题'], '');
    assert.equal(fields['原文标题'], 'Amazon updates FBA fee policy');
    assert.equal(fields['原文语言'], '英文');
  });
});

describe('preferHigherTierSource', () => {
  it('prefers tier-1 official over tier-2', () => {
    assert.equal(
      preferHigherTierSource({
        incomingTier: 'tier_1',
        incomingOfficial: true,
        existingTier: 'tier_2',
        existingOfficial: false,
      }),
      'replace_with_incoming',
    );
  });
});

describe('bitable v2 config', () => {
  it('does not treat legacy table as configured', () => {
    const prevV2 = process.env.FEISHU_BITABLE_TABLE_NEWS_INTEL_V2;
    const prevLegacy = process.env.FEISHU_BITABLE_TABLE_NEWS_INTEL;
    const prevApp = process.env.FEISHU_BITABLE_APP_TOKEN;
    try {
      process.env.FEISHU_BITABLE_APP_TOKEN = 'app';
      process.env.FEISHU_BITABLE_TABLE_NEWS_INTEL = 'tbl_legacy';
      delete process.env.FEISHU_BITABLE_TABLE_NEWS_INTEL_V2;
      assert.equal(getNewsBitableV2TableId(), undefined);
      assert.equal(getNewsBitableTableId(), undefined);
      assert.equal(isNewsBitableConfigured(), false);
    } finally {
      if (prevV2 === undefined) delete process.env.FEISHU_BITABLE_TABLE_NEWS_INTEL_V2;
      else process.env.FEISHU_BITABLE_TABLE_NEWS_INTEL_V2 = prevV2;
      if (prevLegacy === undefined) delete process.env.FEISHU_BITABLE_TABLE_NEWS_INTEL;
      else process.env.FEISHU_BITABLE_TABLE_NEWS_INTEL = prevLegacy;
      if (prevApp === undefined) delete process.env.FEISHU_BITABLE_APP_TOKEN;
      else process.env.FEISHU_BITABLE_APP_TOKEN = prevApp;
    }
  });
});
