import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadNewsIntelPolicy } from './policy.js';
import { buildGoogleNewsFeedUrl, buildResearchQueries } from './research-queries.js';

describe('buildResearchQueries', () => {
  it('generates bounded unique queries for platforms, brands and policy topics', () => {
    const policy = loadNewsIntelPolicy();
    const queries = buildResearchQueries(policy);

    assert.ok(queries.some((query) => query.query.includes('Amazon')));
    assert.ok(queries.some((query) => query.query.includes('FlexiSpot')));
    assert.ok(queries.some((query) => query.query.includes('平台运营')));
    assert.equal(new Set(queries.map((query) => query.code)).size, queries.length);
    assert.ok(queries.length <= policy.research.maxQueriesPerRun);
  });

  it('returns queries in a stable code order', () => {
    const policy = loadNewsIntelPolicy();
    const first = buildResearchQueries(policy);
    const second = buildResearchQueries(policy);

    assert.deepEqual(first, second);
    assert.deepEqual(
      first.map((query) => query.code),
      first.map((query) => query.code).sort(),
    );
  });
});

describe('buildGoogleNewsFeedUrl', () => {
  it('builds a seven-day English feed without double encoding', () => {
    const url = new URL(
      buildGoogleNewsFeedUrl({
        code: 'amazon_us',
        label: 'Amazon 美国',
        query: 'Amazon seller policy',
        language: 'en',
        region: 'US',
      }),
    );

    assert.equal(url.hostname, 'news.google.com');
    assert.equal(url.pathname, '/rss/search');
    assert.equal(url.searchParams.get('q'), 'Amazon seller policy when:7d');
    assert.equal(url.searchParams.get('hl'), 'en-US');
    assert.equal(url.searchParams.get('gl'), 'US');
    assert.equal(url.searchParams.get('ceid'), 'US:en');
  });

  it('uses Chinese locale parameters and a custom lookback', () => {
    const url = new URL(
      buildGoogleNewsFeedUrl(
        {
          code: 'policy_cn',
          label: '跨境政策',
          query: '跨境电商 最新政策',
          language: 'zh',
          region: 'CN',
        },
        3,
      ),
    );

    assert.equal(url.searchParams.get('q'), '跨境电商 最新政策 when:3d');
    assert.equal(url.searchParams.get('hl'), 'zh-CN');
    assert.equal(url.searchParams.get('gl'), 'CN');
    assert.equal(url.searchParams.get('ceid'), 'CN:zh-Hans');
  });
});
