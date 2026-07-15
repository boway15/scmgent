import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyByRules } from './classify-rules.js';
import {
  hashNewsContent,
  hashNewsUrl,
  normalizeNewsUrl,
  normalizeTitle,
  titleSimilarity,
} from './url-normalize.js';

describe('normalizeNewsUrl', () => {
  it('strips tracking params and trailing slash', () => {
    const url = normalizeNewsUrl('http://example.com/path/?utm_source=x&id=1');
    assert.equal(url, 'https://example.com/path?id=1');
  });
});

describe('hashNewsUrl', () => {
  it('is stable for equivalent urls', () => {
    const a = hashNewsUrl('https://example.com/a?utm_source=1');
    const b = hashNewsUrl('https://example.com/a');
    assert.equal(a, b);
  });
});

describe('hashNewsContent', () => {
  it('changes when title changes', () => {
    const a = hashNewsContent('Title A', 'summary');
    const b = hashNewsContent('Title B', 'summary');
    assert.notEqual(a, b);
  });
});

describe('titleSimilarity', () => {
  it('detects near-duplicate titles', () => {
    const score = titleSimilarity(
      'Amazon updates FBA fee policy for US sellers',
      'Amazon updates FBA fee policy for US sellers today',
    );
    assert.ok(score >= 0.7);
  });
});

describe('classifyByRules', () => {
  it('classifies customs content', () => {
    const result = classifyByRules('海关总署发布关税调整通知', '进口关税与报关流程更新');
    assert.equal(result.category, 'customs');
    assert.ok(result.relevanceScore >= 30);
  });

  it('detects platform keywords', () => {
    const result = classifyByRules('Amazon Seller Central policy update', 'FBA inventory rules');
    assert.equal(result.category, 'platform_policy');
    assert.ok(result.affectedPlatforms.includes('Amazon'));
  });
});

describe('normalizeTitle', () => {
  it('collapses whitespace', () => {
    assert.equal(normalizeTitle('  Hello   World  '), 'Hello World');
  });
});
