import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyForBitable,
  filterByOpenclawRules,
  isWithinLookbackDays,
} from './content-filter.js';

describe('isWithinLookbackDays', () => {
  it('rejects old articles', () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    assert.equal(isWithinLookbackDays(old, 7), false);
  });
});

describe('filterByOpenclawRules', () => {
  it('keeps US-related trade news', () => {
    const result = filterByOpenclawRules({
      title: '美国关税政策调整影响跨境电商',
      body: '美方宣布对进口商品加征关税，WTO 关注贸易战进展',
    });
    assert.equal(result.pass, true);
  });

  it('drops Japan-only local news', () => {
    const result = filterByOpenclawRules({
      title: '东京举办樱花旅游攻略',
      body: '日本本地旅游与美食推荐',
    });
    assert.equal(result.pass, false);
  });

  it('keeps US-Vietnam bilateral policy', () => {
    const result = filterByOpenclawRules({
      title: '美国越南关税政策最新解读',
      body: '美越双边贸易与越南关税调整',
    });
    assert.equal(result.pass, true);
  });

  it('applies source include keywords', () => {
    const result = filterByOpenclawRules({
      title: 'Prime Day 大促攻略',
      body: '美国亚马逊卖家运营技巧',
      sourceConfig: { includeKeywords: ['prime day', 'amazon'] },
    });
    assert.equal(result.pass, true);
  });

  it('drops predominantly english articles', () => {
    const result = filterByOpenclawRules({
      title: 'Retail sales beat expectations in quarterly earnings report',
      body: 'Wall Street analysts said consumer spending remained strong across categories.',
    });
    assert.equal(result.pass, false);
    assert.equal(result.reason, 'predominantly_english');
  });

  it('drops excluded english domains', () => {
    const result = filterByOpenclawRules({
      title: '美国关税政策',
      body: '跨境出口合规',
      canonicalUrl: 'https://www.bbc.com/news/business-123',
    });
    assert.equal(result.pass, false);
    assert.equal(result.reason, 'excluded_english_domain');
  });
});

describe('classifyForBitable', () => {
  it('classifies customs news as 法规政策', () => {
    const result = classifyForBitable('美国加征关税与HS编码调整', '出口管制与反倾销调查');
    assert.equal(result.bitableCategory, '法规政策');
  });

  it('requires Amazon/Wayfair for 活动运营', () => {
    const amazon = classifyForBitable('Amazon Prime Day 大促提报', '亚马逊会员日');
    assert.equal(amazon.bitableCategory, '活动运营');

    const temu = classifyForBitable('Temu 大促活动', '平台促销');
    assert.notEqual(temu.bitableCategory, '活动运营');
  });
});
