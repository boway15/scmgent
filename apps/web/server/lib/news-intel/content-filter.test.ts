import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyNewsArticle,
  evaluateNewsRelevance,
  isPredominantlyEnglish,
  isWithinLookbackDays,
} from './content-filter.js';

describe('isPredominantlyEnglish', () => {
  it('detects english-heavy content', () => {
    assert.equal(
      isPredominantlyEnglish(
        'Amazon updates FBA fee schedule for US sellers',
        'Amazon Seller Central announced new fulfillment fees across the United States marketplace for large furniture items.',
      ),
      true,
    );
  });

  it('keeps chinese content as non-english', () => {
    assert.equal(
      isPredominantlyEnglish('亚马逊调整美国站FBA费用', '卖家中心发布美国站家具类目运费更新通知。'),
      false,
    );
  });
});

describe('isWithinLookbackDays', () => {
  it('accepts recent dates', () => {
    assert.equal(isWithinLookbackDays(new Date(), 7), true);
  });

  it('rejects old dates', () => {
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    assert.equal(isWithinLookbackDays(old, 7), false);
  });
});

describe('evaluateNewsRelevance', () => {
  it('accepts furniture and platform chinese news', () => {
    const result = evaluateNewsRelevance({
      title: '美国亚马逊家具卖家关注升降桌类目变化',
      body: '跨境家具卖家需关注 Amazon 美国站 listing 与物流政策。',
      sourceTier: 'tier_2',
      isOfficial: false,
    });
    assert.equal(result.pass, true);
    assert.ok(result.hits.some((h) => h.includes('家具') || h.includes('平台')));
  });

  it('accepts logistics and tariff news for logistics team', () => {
    const result = evaluateNewsRelevance({
      title: '美国关税与海运清关新规影响海外仓',
      body: '头程海运、港口清关和关税政策同步变化。',
      sourceTier: 'tier_2',
      isOfficial: false,
    });
    assert.equal(result.pass, true);
  });

  it('accepts cross-border ecommerce industry news', () => {
    const result = evaluateNewsRelevance({
      title: '跨境电商卖家关注平台合规新规',
      body: '多家出海卖家正在调整店铺运营策略。',
      sourceTier: 'tier_3',
      isOfficial: false,
    });
    assert.equal(result.pass, true);
    assert.ok(result.hits.some((h) => h.includes('跨境')));
  });

  it('rejects generic ecommerce without business anchors', () => {
    const result = evaluateNewsRelevance({
      title: '零售业今日要闻汇总',
      body: '多家公司发布季度业绩与组织调整，未涉及品类或渠道细节。',
      sourceTier: 'tier_2',
      isOfficial: false,
    });
    assert.equal(result.pass, false);
    assert.equal(result.reason, 'no_business_anchor');
  });

  it('rejects country-only or AI investment news without furniture/cross-border anchors', () => {
    const mistral = evaluateNewsRelevance({
      title: '三星洽谈投资法国AI独角兽Mistral，公司估值将升至200亿欧元',
      body: '三星电子正就向法国AI初创公司Mistral投资数亿欧元展开谈判。据英国《金融时报》报道，特朗普政府限制加剧欧洲主权AI需求。',
      sourceTier: 'tier_3',
      isOfficial: false,
    });
    assert.equal(mistral.pass, false);
    assert.equal(mistral.reason, 'no_business_anchor');

    const countryOnly = evaluateNewsRelevance({
      title: '法国与美国领导人举行会晤',
      body: '双方就双边关系与欧洲事务交换意见，未公布具体经贸清单。',
      sourceTier: 'tier_2',
      isOfficial: false,
    });
    assert.equal(countryOnly.pass, false);
    assert.equal(countryOnly.reason, 'no_business_anchor');
  });

  it('rejects finance brief when judged on title/RSS probe only', () => {
    const probeOnly = evaluateNewsRelevance({
      title: '法国CAC40指数涨1%',
      body: '法国CAC40指数日内涨幅达1%。',
      sourceTier: 'tier_3',
      isOfficial: false,
      sourceConfig: {
        includeKeywords: ['跨境', '出海', '电商', '外贸', '关税', '贸易', '物流', '海关'],
      },
    });
    assert.equal(probeOnly.pass, false);
    assert.ok(
      probeOnly.reason === 'no_business_anchor' ||
        probeOnly.reason === 'source_include_keyword_miss',
    );
  });

  it('rejects non-official english media', () => {
    const result = evaluateNewsRelevance({
      title: 'Amazon updates FBA fee schedule for US sellers of furniture desks',
      body: 'Marketplace analysts say US sellers should prepare for higher fulfillment costs on large furniture SKUs across Amazon.',
      sourceTier: 'tier_2',
      isOfficial: false,
    });
    assert.equal(result.pass, false);
    assert.equal(result.reason, 'non_official_english');
  });

  it('allows tier-1 official english and marks translation required', () => {
    const result = evaluateNewsRelevance({
      title: 'USTR announces tariff actions affecting furniture imports into the United States',
      body: 'The Office of the United States Trade Representative released new tariff measures that may impact ocean freight, customs clearance and overseas warehouse operations for furniture exporters.',
      sourceTier: 'tier_1',
      isOfficial: true,
    });
    assert.equal(result.pass, true);
    assert.equal(result.requiresTranslation, true);
  });
});

describe('classifyNewsArticle', () => {
  it('classifies logistics and tariff as multi-department', () => {
    const result = classifyNewsArticle(
      '美国关税与海运清关政策更新',
      '港口拥堵叠加关税调整，影响海外仓补货节奏。',
    );
    assert.equal(result.topicCategory, '物流海关与关税');
    assert.ok(result.departments.includes('物流'));
    assert.ok(result.countryTags.includes('美国') || result.businessTags.includes('关税'));
  });

  it('detects brands and platforms', () => {
    const result = classifyNewsArticle(
      'FlexiSpot 与 Costway 在 Amazon 美国站布局升降桌',
      '多家品牌在亚马逊家具类目加大广告投放。',
    );
    assert.ok(result.brandTags.includes('FlexiSpot'));
    assert.ok(result.brandTags.includes('Costway'));
    assert.ok(result.platformTags.includes('Amazon'));
  });

  it('classifies AI and marketing related content', () => {
    const result = classifyNewsArticle(
      '跨境卖家用 AI 优化 Amazon listing 主图',
      'AI 制图与广告投放帮助家具独立站与平台运营提效。',
    );
    assert.ok(['AI前沿', '营销推广', '视觉设计', '平台运营'].includes(result.topicCategory));
  });
});
