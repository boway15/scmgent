import {
  loadNewsIntelPolicy,
  parseSourceConfig,
  resolveSourceOfficial,
  resolveSourceTier,
  type NewsSourceConfig,
} from './policy.js';
import type {
  NewsClassification,
  NewsDepartment,
  NewsSourceTier,
  NewsTopicCategory,
  RelevanceEvaluation,
} from './types.js';
import { stripHtml } from './url-normalize.js';

export type ContentFilterResult =
  | { pass: true; reason?: string }
  | { pass: false; reason: string };

function normalizeText(title: string, body: string): string {
  return `${title}\n${stripHtml(body)}`.toLowerCase();
}

function countHits(text: string, keywords: string[]): number {
  let hits = 0;
  for (const kw of keywords) {
    if (!kw) continue;
    if (text.includes(kw.toLowerCase())) hits += 1;
  }
  return hits;
}

function hasAnyHit(text: string, keywords: string[]): boolean {
  return countHits(text, keywords) > 0;
}

/** 短拉丁别名（如 eu/uk）避免命中 europe/ukraine 等子串 */
function aliasMatches(text: string, alias: string): boolean {
  const normalized = alias.toLowerCase().trim();
  if (!normalized) return false;
  if (/^[a-z]{1,3}$/.test(normalized)) {
    return new RegExp(`(?:^|[^a-z])${normalized}(?:[^a-z]|$)`, 'i').test(text);
  }
  return text.includes(normalized);
}

function collectAliasHits(
  text: string,
  items: Array<{ name: string; aliases: string[] }>,
): string[] {
  const hits: string[] = [];
  for (const item of items) {
    if (item.aliases.some((alias) => aliasMatches(text, alias))) {
      hits.push(item.name);
    }
  }
  return hits;
}

/** 标题/正文以英文为主且几乎无中文时视为英文内容 */
export function isPredominantlyEnglish(title: string, body: string): boolean {
  const text = `${title} ${stripHtml(body)}`.trim();
  if (!text) return false;
  const chinese = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (chinese >= 10) return false;
  if (chinese >= 4 && chinese / text.length > 0.12) return false;
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length;
  return latin >= 50 && chinese < 4;
}

export function isWithinLookbackDays(publishedAt: Date | undefined, lookbackDays: number): boolean {
  if (!publishedAt) return true;
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return publishedAt.getTime() >= cutoff;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function evaluateNewsRelevance(params: {
  title: string;
  body: string;
  publishedAt?: Date;
  canonicalUrl?: string;
  sourceConfig?: NewsSourceConfig;
  sourceTier?: NewsSourceTier | null;
  isOfficial?: boolean | null;
}): RelevanceEvaluation {
  const policy = loadNewsIntelPolicy();
  const text = normalizeText(params.title, params.body);
  const sourceCfg = params.sourceConfig ?? {};
  const sourceTier = resolveSourceTier(params.sourceTier, sourceCfg);
  const isOfficial = resolveSourceOfficial(params.isOfficial, sourceCfg);
  const english = isPredominantlyEnglish(params.title, params.body);
  const hits: string[] = [];

  if (!isWithinLookbackDays(params.publishedAt, policy.lookbackDays)) {
    return {
      pass: false,
      reason: 'outside_lookback_window',
      hits,
      sourceTier,
      requiresTranslation: false,
    };
  }

  if (hasAnyHit(text, policy.negativeKeywords)) {
    return {
      pass: false,
      reason: 'negative_keyword',
      hits,
      sourceTier,
      requiresTranslation: false,
    };
  }

  if (sourceCfg.excludeKeywords?.length && hasAnyHit(text, sourceCfg.excludeKeywords)) {
    return {
      pass: false,
      reason: 'source_exclude_keyword',
      hits,
      sourceTier,
      requiresTranslation: false,
    };
  }

  if (sourceCfg.includeKeywords?.length && !hasAnyHit(text, sourceCfg.includeKeywords)) {
    return {
      pass: false,
      reason: 'source_include_keyword_miss',
      hits,
      sourceTier,
      requiresTranslation: false,
    };
  }

  if (english && !(sourceTier === 'tier_1' && isOfficial)) {
    return {
      pass: false,
      reason: 'non_official_english',
      hits,
      sourceTier,
      requiresTranslation: false,
    };
  }

  const usVietnam = hasAnyHit(text, policy.usVietnamPolicyKeywords);
  const excludeHit = hasAnyHit(text, policy.excludeRegionKeywords);
  const includeHit = hasAnyHit(text, policy.includeRegionKeywords);
  if (excludeHit && !usVietnam && !includeHit) {
    return {
      pass: false,
      reason: 'excluded_region',
      hits,
      sourceTier,
      requiresTranslation: english,
    };
  }

  const furnitureHits = countHits(text, policy.furnitureKeywords);
  const crossBorderHits = countHits(text, policy.crossBorderKeywords ?? []);
  const brandHits = collectAliasHits(text, policy.brandKeywords);
  const platformHits = collectAliasHits(text, policy.platformKeywords);
  const countryHits = collectAliasHits(text, policy.countryKeywords);
  const logisticsHits = countHits(text, policy.logisticsKeywords);
  const aiHits = countHits(text, policy.aiKeywords);
  const designHits = countHits(text, policy.designKeywords);
  const marketingHits = countHits(text, policy.marketingKeywords);

  if (furnitureHits) hits.push(`家具:${furnitureHits}`);
  if (crossBorderHits) hits.push(`跨境:${crossBorderHits}`);
  if (brandHits.length) hits.push(`品牌:${brandHits.join(',')}`);
  if (platformHits.length) hits.push(`平台:${platformHits.join(',')}`);
  if (countryHits.length) hits.push(`国家:${countryHits.join(',')}`);
  if (logisticsHits) hits.push(`物流关税:${logisticsHits}`);
  if (aiHits) hits.push(`AI:${aiHits}`);
  if (designHits) hits.push(`视觉:${designHits}`);
  if (marketingHits) hits.push(`营销:${marketingHits}`);

  // 国家/地区单独出现不算业务锚点（否则「法国 AI 融资」等宏观稿会入库）
  const coreBusiness =
    furnitureHits > 0 ||
    crossBorderHits > 0 ||
    brandHits.length > 0 ||
    platformHits.length > 0 ||
    logisticsHits > 0;
  const hasBusinessAnchor =
    coreBusiness ||
    (designHits > 0 && (furnitureHits > 0 || brandHits.length > 0 || platformHits.length > 0)) ||
    (marketingHits > 0 &&
      (platformHits.length > 0 || furnitureHits > 0 || brandHits.length > 0 || crossBorderHits > 0));

  if (!hasBusinessAnchor) {
    return {
      pass: false,
      reason: 'no_business_anchor',
      hits,
      sourceTier,
      requiresTranslation: english && sourceTier === 'tier_1' && isOfficial,
    };
  }

  return {
    pass: true,
    reason: 'ok',
    hits,
    sourceTier,
    requiresTranslation: english && sourceTier === 'tier_1' && isOfficial,
  };
}

/** @deprecated Prefer evaluateNewsRelevance */
export function filterByOpenclawRules(params: {
  title: string;
  body: string;
  publishedAt?: Date;
  canonicalUrl?: string;
  sourceConfig?: NewsSourceConfig;
  sourceTier?: NewsSourceTier | null;
  isOfficial?: boolean | null;
}): ContentFilterResult {
  const result = evaluateNewsRelevance(params);
  return result.pass ? { pass: true, reason: result.reason } : { pass: false, reason: result.reason };
}

export function classifyNewsArticle(title: string, body: string): NewsClassification {
  const policy = loadNewsIntelPolicy();
  const text = normalizeText(title, body);
  const hitCounts: Record<string, number> = {};
  const departments = new Set<NewsDepartment>();
  const filterHits: string[] = [];

  for (const topic of policy.topics) {
    const hits = countHits(text, topic.keywords);
    hitCounts[topic.value] = hits;
    if (hits > 0) {
      filterHits.push(`${topic.value}:${hits}`);
      for (const dept of topic.departments) departments.add(dept);
    }
  }

  let best: NewsTopicCategory = '产品开发与家具趋势';
  let bestHits = -1;
  for (const topic of policy.topics) {
    const hits = hitCounts[topic.value] ?? 0;
    if (hits > bestHits) {
      bestHits = hits;
      best = topic.value;
    } else if (hits === bestHits && hits > 0) {
      const order = policy.categoryTieBreakOrder;
      if (order.indexOf(topic.value) < order.indexOf(best)) best = topic.value;
    }
  }

  if (bestHits <= 0) {
    best = '法规与外部环境';
    departments.add('法规与外部环境');
  } else {
    const selected = policy.topics.find((t) => t.value === best);
    for (const dept of selected?.departments ?? []) departments.add(dept);
  }

  const platformTags = collectAliasHits(text, policy.platformKeywords);
  const countryTags = collectAliasHits(text, policy.countryKeywords);
  const brandTags = collectAliasHits(text, policy.brandKeywords);
  const businessTags: string[] = [];

  if (hasAnyHit(text, policy.furnitureKeywords)) {
    for (const kw of ['沙发', '桌子', '椅子', '床', '升降桌', '家具']) {
      if (text.includes(kw.toLowerCase()) || text.includes(kw)) businessTags.push(kw);
    }
    if (!businessTags.length) businessTags.push('家具');
  }
  for (const kw of ['海运', '港口', '清关', '关税', '海外仓', '尾程', '头程']) {
    if (text.includes(kw.toLowerCase()) || text.includes(kw)) businessTags.push(kw);
  }

  // 物流与关税默认关联物流部门
  if (businessTags.some((t) => ['海运', '港口', '清关', '关税', '海外仓', '尾程', '头程'].includes(t))) {
    departments.add('物流');
  }

  const relevanceScore = Math.min(
    100,
    35 +
      bestHits * 8 +
      platformTags.length * 6 +
      countryTags.length * 5 +
      brandTags.length * 8 +
      businessTags.length * 4,
  );
  const priority =
    relevanceScore >= 75 ? 'high' : relevanceScore >= 55 ? 'medium' : ('low' as const);

  return {
    topicCategory: best,
    departments: [...departments],
    platformTags: unique(platformTags),
    countryTags: unique(countryTags),
    businessTags: unique(businessTags),
    brandTags: unique(brandTags),
    filterHits: unique(filterHits),
    relevanceScore,
    priority,
  };
}

/** @deprecated Prefer classifyNewsArticle */
export type BitableClassification = {
  bitableCategory: string;
  hitCounts: Record<string, number>;
  remarkPlatforms: string[];
  remarkCountries: string[];
};

/** @deprecated Prefer classifyNewsArticle */
export function classifyForBitable(title: string, body: string): BitableClassification {
  const result = classifyNewsArticle(title, body);
  return {
    bitableCategory: result.topicCategory,
    hitCounts: Object.fromEntries(result.filterHits.map((h) => [h.split(':')[0], Number(h.split(':')[1] ?? 0)])),
    remarkPlatforms: result.platformTags,
    remarkCountries: result.countryTags,
  };
}

export function buildBitableRemark(params: {
  articleId: string;
  remarkPlatforms: string[];
  remarkCountries: string[];
  duplicateSuspect?: boolean;
}): string {
  const parts: string[] = [];
  if (params.remarkPlatforms.length) parts.push(`平台:${params.remarkPlatforms.join('、')}`);
  if (params.remarkCountries.length) parts.push(`国家:${params.remarkCountries.join('、')}`);
  if (params.duplicateSuspect) parts.push('疑似重复');
  if (!parts.length) return '';
  return `${parts.join(';')};系统ID:${params.articleId}`;
}

export { parseSourceConfig };
