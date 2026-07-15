import { loadNewsIntelPolicy, parseSourceConfig, type NewsSourceConfig } from './policy.js';
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
    if (text.includes(kw.toLowerCase())) hits += 1;
  }
  return hits;
}

function hasAnyHit(text: string, keywords: string[]): boolean {
  return countHits(text, keywords) > 0;
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

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function isExcludedEnglishDomain(url: string, domains: string[]): boolean {
  const host = hostnameFromUrl(url);
  if (!host) return false;
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

export function isWithinLookbackDays(publishedAt: Date | undefined, lookbackDays: number): boolean {
  if (!publishedAt) return true;
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return publishedAt.getTime() >= cutoff;
}

export function filterByOpenclawRules(params: {
  title: string;
  body: string;
  publishedAt?: Date;
  canonicalUrl?: string;
  sourceConfig?: NewsSourceConfig;
}): ContentFilterResult {
  const policy = loadNewsIntelPolicy();
  const text = normalizeText(params.title, params.body);

  if (params.canonicalUrl && policy.excludeEnglishDomains?.length) {
    if (isExcludedEnglishDomain(params.canonicalUrl, policy.excludeEnglishDomains)) {
      return { pass: false, reason: 'excluded_english_domain' };
    }
  }

  if (policy.requireChineseContent && isPredominantlyEnglish(params.title, params.body)) {
    return { pass: false, reason: 'predominantly_english' };
  }

  if (!isWithinLookbackDays(params.publishedAt, policy.lookbackDays)) {
    return { pass: false, reason: 'outside_lookback_window' };
  }

  if (hasAnyHit(text, policy.negativeKeywords)) {
    return { pass: false, reason: 'negative_keyword' };
  }

  const sourceCfg = params.sourceConfig ?? {};
  if (sourceCfg.excludeKeywords?.length && hasAnyHit(text, sourceCfg.excludeKeywords)) {
    return { pass: false, reason: 'source_exclude_keyword' };
  }

  if (sourceCfg.includeKeywords?.length && !hasAnyHit(text, sourceCfg.includeKeywords)) {
    return { pass: false, reason: 'source_include_keyword_miss' };
  }

  const usVietnam = hasAnyHit(text, policy.usVietnamPolicyKeywords);
  const excludeHit = hasAnyHit(text, policy.excludeRegionKeywords);
  const includeHit = hasAnyHit(text, policy.includeRegionKeywords);

  if (excludeHit && !usVietnam && !includeHit) {
    return { pass: false, reason: 'excluded_region' };
  }

  if (!includeHit && !usVietnam) {
    return { pass: false, reason: 'no_included_region' };
  }

  return { pass: true };
}

export type BitableClassification = {
  bitableCategory: string;
  hitCounts: Record<string, number>;
  remarkPlatforms: string[];
  remarkCountries: string[];
};

const PLATFORM_DETECT = [
  { name: 'Amazon', keywords: ['amazon', '亚马逊', 'fba'] },
  { name: 'Wayfair', keywords: ['wayfair'] },
  { name: 'Walmart', keywords: ['walmart', '沃尔玛'] },
  { name: 'eBay', keywords: ['ebay'] },
  { name: 'Temu', keywords: ['temu'] },
  { name: 'Shopify', keywords: ['shopify'] },
];

const COUNTRY_DETECT = [
  { name: '美国', keywords: ['美国', 'usa', 'united states'] },
  { name: '加拿大', keywords: ['加拿大', 'canada'] },
  { name: '英国', keywords: ['英国', 'uk', 'united kingdom'] },
  { name: '德国', keywords: ['德国', 'germany'] },
  { name: '法国', keywords: ['法国', 'france'] },
  { name: '欧盟', keywords: ['欧盟', 'eu', '欧元区'] },
];

export function classifyForBitable(title: string, body: string): BitableClassification {
  const policy = loadNewsIntelPolicy();
  const text = normalizeText(title, body);
  const hitCounts: Record<string, number> = {};

  for (const cat of policy.categories) {
    if (cat.bitableValue === '活动运营' && cat.platforms?.length) {
      const platformHit = cat.platforms.some((p) => text.includes(p.toLowerCase()));
      if (!platformHit) {
        hitCounts[cat.bitableValue] = 0;
        continue;
      }
    }
    hitCounts[cat.bitableValue] = countHits(text, cat.keywords);
  }

  let best = '市场';
  let bestHits = hitCounts['市场'] ?? 0;

  for (const cat of policy.categories) {
    const hits = hitCounts[cat.bitableValue] ?? 0;
    if (hits > bestHits) {
      bestHits = hits;
      best = cat.bitableValue;
    } else if (hits === bestHits && hits > 0) {
      const order = policy.categoryTieBreakOrder;
      if (order.indexOf(cat.bitableValue) < order.indexOf(best)) {
        best = cat.bitableValue;
      }
    }
  }

  if (bestHits === 0) best = '市场';

  const remarkPlatforms: string[] = [];
  for (const p of PLATFORM_DETECT) {
    if (p.keywords.some((k) => text.includes(k))) remarkPlatforms.push(p.name);
  }

  const remarkCountries: string[] = [];
  for (const c of COUNTRY_DETECT) {
    if (c.keywords.some((k) => text.includes(k))) remarkCountries.push(c.name);
  }

  return { bitableCategory: best, hitCounts, remarkPlatforms, remarkCountries };
}

export function buildBitableRemark(params: {
  articleId: string;
  remarkPlatforms: string[];
  remarkCountries: string[];
  duplicateSuspect?: boolean;
}): string {
  const parts: string[] = [];
  if (params.remarkPlatforms.length) {
    parts.push(`平台:${params.remarkPlatforms.join('、')}`);
  }
  if (params.remarkCountries.length) {
    parts.push(`国家:${params.remarkCountries.join('、')}`);
  }
  if (params.duplicateSuspect) {
    parts.push('疑似重复');
  }
  if (!parts.length) return '';
  return `${parts.join(';')};系统ID:${params.articleId}`;
}
