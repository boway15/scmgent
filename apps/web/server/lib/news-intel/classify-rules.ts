import type { ClassifyResult, NewsCategory } from './types.js';
import { stripHtml } from './url-normalize.js';

const CATEGORY_RULES: Array<{ category: NewsCategory; keywords: string[] }> = [
  {
    category: 'customs',
    keywords: ['海关', '关税', '报关', '清关', 'hs编码', 'hs code', 'customs', 'tariff', 'import duty'],
  },
  {
    category: 'platform_policy',
    keywords: [
      '亚马逊',
      'amazon',
      'temu',
      'shopee',
      'ebay',
      'walmart',
      '卖家中心',
      'seller central',
      '平台政策',
      'policy update',
      'marketplace',
    ],
  },
  {
    category: 'logistics',
    keywords: [
      '物流',
      '航运',
      '港口',
      'fba',
      '海外仓',
      'freight',
      'shipping',
      'warehouse',
      'last mile',
      '头程',
      '尾程',
    ],
  },
  {
    category: 'supply_chain',
    keywords: ['供应链', '采购', '供应商', '产能', 'supply chain', 'procurement', 'sourcing'],
  },
  {
    category: 'operations',
    keywords: ['运营', '广告', 'acos', '转化率', 'listing', 'ppc', 'operations'],
  },
];

const PLATFORM_KEYWORDS: Array<{ name: string; keywords: string[] }> = [
  { name: 'Amazon', keywords: ['amazon', '亚马逊', 'fba'] },
  { name: 'Temu', keywords: ['temu'] },
  { name: 'eBay', keywords: ['ebay'] },
  { name: 'Shopee', keywords: ['shopee'] },
  { name: 'Walmart', keywords: ['walmart', '沃尔玛'] },
];

const REGION_KEYWORDS: Array<{ name: string; keywords: string[] }> = [
  { name: 'US', keywords: ['美国', 'us ', ' u.s.', 'united states'] },
  { name: 'EU', keywords: ['欧盟', 'europe', ' european', '德国', '法国'] },
  { name: 'UK', keywords: ['英国', ' uk ', 'united kingdom'] },
  { name: 'CN', keywords: ['中国', 'china', '国内'] },
];

function countKeywordHits(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) hits += 1;
  }
  return hits;
}

function detectTags(text: string): string[] {
  const tags = new Set<string>();
  for (const rule of CATEGORY_RULES) {
    if (countKeywordHits(text, rule.keywords) > 0) {
      tags.add(rule.category);
    }
  }
  return [...tags];
}

export function classifyByRules(
  title: string,
  body: string,
  defaultCategory: NewsCategory = 'other',
): ClassifyResult {
  const text = `${title}\n${stripHtml(body)}`.toLowerCase();

  let bestCategory = defaultCategory;
  let bestScore = 0;
  for (const rule of CATEGORY_RULES) {
    const hits = countKeywordHits(text, rule.keywords);
    if (hits > bestScore) {
      bestScore = hits;
      bestCategory = rule.category;
    }
  }

  const affectedPlatforms: string[] = [];
  for (const p of PLATFORM_KEYWORDS) {
    if (countKeywordHits(text, p.keywords) > 0) affectedPlatforms.push(p.name);
  }

  const affectedRegions: string[] = [];
  for (const r of REGION_KEYWORDS) {
    if (countKeywordHits(text, r.keywords) > 0) affectedRegions.push(r.name);
  }

  const relevanceScore = Math.min(100, 20 + bestScore * 12 + affectedPlatforms.length * 8);
  let priority: ClassifyResult['priority'] = 'low';
  if (relevanceScore >= 75) priority = 'high';
  else if (relevanceScore >= 55) priority = 'medium';

  if (bestCategory === 'customs' || bestCategory === 'platform_policy') {
    if (priority === 'low' && relevanceScore >= 45) priority = 'medium';
  }

  return {
    category: bestCategory,
    tags: detectTags(text),
    relevanceScore,
    priority,
    affectedPlatforms,
    affectedRegions,
  };
}

export function mergeEnrichWithRules(
  rules: ClassifyResult,
  enrich: Partial<ClassifyResult> & { summary?: string; keyPoints?: string[] },
): ClassifyResult & { summary?: string; keyPoints?: string[] } {
  return {
    category: enrich.category ?? rules.category,
    tags: enrich.tags?.length ? enrich.tags : rules.tags,
    relevanceScore: enrich.relevanceScore ?? rules.relevanceScore,
    priority: enrich.priority ?? rules.priority,
    affectedPlatforms: enrich.affectedPlatforms?.length
      ? enrich.affectedPlatforms
      : rules.affectedPlatforms,
    affectedRegions: enrich.affectedRegions?.length ? enrich.affectedRegions : rules.affectedRegions,
    summary: enrich.summary,
    keyPoints: enrich.keyPoints,
  };
}