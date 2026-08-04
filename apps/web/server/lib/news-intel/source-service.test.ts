import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadNewsIntelPolicy } from './policy.js';
import {
  buildExistingResearchSourcePatch,
  buildResearchSourceRows,
  findStaleResearchSourceCodes,
  isCollectableNewsSourceType,
  isLegacyGoogleNewsQueryFeedUrl,
  isPublicNewsSourceType,
  resolveSeedEnabled,
} from './source-service.js';

describe('buildResearchSourceRows', () => {
  it('maps every research query to a stable Google query-feed source', () => {
    const policy = loadNewsIntelPolicy();
    const rows = buildResearchSourceRows(policy);

    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.code.startsWith('research_')));
    assert.ok(rows.every((row) => row.sourceType === 'query_feed'));
    assert.ok(rows.every((row) => new URL(row.feedUrl).hostname === 'news.google.com'));
    assert.equal(new Set(rows.map((row) => row.code)).size, rows.length);
    assert.deepEqual(rows, buildResearchSourceRows(policy));
  });

  it('persists discovery metadata and query limits in configJson', () => {
    const policy = loadNewsIntelPolicy();
    const rows = buildResearchSourceRows(policy);

    assert.ok(
      rows.every(
        (row) =>
          typeof row.configJson.discoveryQuery === 'string' &&
          row.configJson.discoveryQuery.length > 0 &&
          (row.configJson.language === 'zh' || row.configJson.language === 'en') &&
          typeof row.configJson.region === 'string' &&
          row.configJson.channel === 'media' &&
          row.configJson.maxItemsPerQuery === policy.research.maxItemsPerQuery,
      ),
    );
    assert.ok(rows.every((row) => row.sourceTier === 'tier_3'));
    assert.ok(rows.every((row) => row.isOfficial === false));
  });
});

describe('resolveSeedEnabled', () => {
  it('disables static Google News query seeds as legacy sources', () => {
    assert.equal(
      resolveSeedEnabled({
        code: 'gnews_wayfair',
        name: 'GNews-Wayfair Partner',
        feed_url:
          'https://news.google.com/rss/search?q=Wayfair+partner+home+OR+seller+policy+when:7d&hl=en-US&gl=US&ceid=US:en',
        source_type: 'rss',
        category_default: 'other',
        enabled: true,
      }),
      false,
    );
  });

  it('recognizes legacy Google News query feed URLs for bulk disable', () => {
    assert.equal(
      isLegacyGoogleNewsQueryFeedUrl(
        'https://news.google.com/rss/search?q=Wayfair+partner+home+OR+seller+policy+when:7d&hl=en-US&gl=US&ceid=US:en',
      ),
      true,
    );
    assert.equal(
      isLegacyGoogleNewsQueryFeedUrl('https://www.aboutamazon.com/news/feed'),
      false,
    );
  });

  it('keeps generated research query feeds enabled', () => {
    const [row] = buildResearchSourceRows(loadNewsIntelPolicy());
    assert.ok(row);
    assert.equal(row.code.startsWith('research_'), true);
    assert.equal(row.sourceType, 'query_feed');
    assert.equal(row.enabled, true);
  });

  it('disables unsupported sitemap and web_page collectors', () => {
    for (const sourceType of ['sitemap', 'web_page'] as const) {
      assert.equal(
        resolveSeedEnabled({
          code: `unsupported_${sourceType}`,
          name: sourceType,
          feed_url: 'https://example.com',
          source_type: sourceType,
          category_default: 'other',
          enabled: true,
        }),
        false,
      );
    }
  });
});

describe('research source reconciliation', () => {
  it('does not force enabled when patching an existing generated source', () => {
    const [row] = buildResearchSourceRows(loadNewsIntelPolicy());
    assert.ok(row);
    const patch = buildExistingResearchSourcePatch(row, new Date('2026-07-27T00:00:00Z'));
    assert.equal(Object.hasOwn(patch, 'enabled'), false);
  });

  it('identifies only stale research query-feed codes', () => {
    assert.deepEqual(
      findStaleResearchSourceCodes(
        [
          { code: 'research_current', sourceType: 'query_feed' },
          { code: 'research_stale', sourceType: 'query_feed' },
          { code: 'research_manual', sourceType: 'manual' },
          { code: 'ordinary_feed', sourceType: 'query_feed' },
        ],
        new Set(['research_current']),
      ),
      ['research_stale'],
    );
  });
});

describe('source type support', () => {
  it('allows public management only for rss and manual sources', () => {
    assert.equal(isPublicNewsSourceType('rss'), true);
    assert.equal(isPublicNewsSourceType('manual'), true);
    for (const type of ['query_feed', 'sitemap', 'web_page', 'rsshub']) {
      assert.equal(isPublicNewsSourceType(type), false);
    }
  });

  it('collects only rss and system query feeds', () => {
    assert.equal(isCollectableNewsSourceType('rss'), true);
    assert.equal(isCollectableNewsSourceType('query_feed'), true);
    for (const type of ['manual', 'sitemap', 'web_page', 'rsshub']) {
      assert.equal(isCollectableNewsSourceType(type), false);
    }
  });
});
