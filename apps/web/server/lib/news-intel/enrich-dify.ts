import { isDifyKeyConfigured, runWorkflow } from '../../integrations/dify.js';
import { isNewsIntelLlmEnabled } from './config.js';
import type {
  EnrichResult,
  NewsCategory,
  NewsDepartment,
  NewsPriority,
  NewsTopicCategory,
} from './types.js';

export function isNewsIntelEnrichEnabled(): boolean {
  return isNewsIntelLlmEnabled() && isDifyKeyConfigured('DIFY_API_KEY_NEWS_INTEL');
}

const VALID_CATEGORIES = new Set<NewsCategory>([
  'supply_chain',
  'logistics',
  'customs',
  'platform_policy',
  'operations',
  'other',
]);

const VALID_PRIORITIES = new Set<NewsPriority>(['high', 'medium', 'low']);

const VALID_TOPICS = new Set<NewsTopicCategory>([
  '产品开发与家具趋势',
  'PMC与供应链',
  '采购与供应商',
  '物流海关与关税',
  '平台运营',
  '营销推广',
  '视觉设计',
  'AI前沿',
  '法规与外部环境',
]);

const VALID_DEPARTMENTS = new Set<NewsDepartment>([
  '产品开发',
  'PMC',
  '采购',
  '物流',
  '平台运营',
  '营销推广',
  '视觉设计',
  'AI',
  '法规与外部环境',
]);

function asCategory(value: unknown, fallback: NewsCategory): NewsCategory {
  return typeof value === 'string' && VALID_CATEGORIES.has(value as NewsCategory)
    ? (value as NewsCategory)
    : fallback;
}

function asPriority(value: unknown, fallback: NewsPriority): NewsPriority {
  return typeof value === 'string' && VALID_PRIORITIES.has(value as NewsPriority)
    ? (value as NewsPriority)
    : fallback;
}

function asTopic(value: unknown): NewsTopicCategory | undefined {
  return typeof value === 'string' && VALID_TOPICS.has(value as NewsTopicCategory)
    ? (value as NewsTopicCategory)
    : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function asDepartments(value: unknown): NewsDepartment[] {
  return asStringArray(value).filter((v): v is NewsDepartment =>
    VALID_DEPARTMENTS.has(v as NewsDepartment),
  );
}

export function parseEnrichOutput(
  outputs: Record<string, unknown>,
  fallbackCategory: NewsCategory,
  fallbackPriority: NewsPriority,
  options?: { requireTitleZh?: boolean },
): EnrichResult | null {
  const raw =
    typeof outputs.result === 'string'
      ? (() => {
          try {
            return JSON.parse(outputs.result) as Record<string, unknown>;
          } catch {
            return null;
          }
        })()
      : outputs;

  if (!raw || typeof raw !== 'object') return null;

  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  if (!summary) return null;

  const titleZh =
    typeof raw.title_zh === 'string'
      ? raw.title_zh.trim()
      : typeof raw.titleZh === 'string'
        ? raw.titleZh.trim()
        : undefined;

  if (options?.requireTitleZh && !titleZh) return null;

  return {
    titleZh,
    summary,
    keyPoints: asStringArray(raw.key_points ?? raw.keyPoints),
    topicCategory: asTopic(raw.topic_category ?? raw.topicCategory),
    departments: asDepartments(raw.departments),
    category: asCategory(raw.category, fallbackCategory),
    tags: asStringArray(raw.tags),
    relevanceScore:
      typeof raw.relevance_score === 'number'
        ? raw.relevance_score
        : typeof raw.relevanceScore === 'number'
          ? raw.relevanceScore
          : 0,
    priority: asPriority(raw.priority, fallbackPriority),
    affectedPlatforms: asStringArray(raw.affected_platforms ?? raw.affectedPlatforms),
    affectedRegions: asStringArray(raw.affected_regions ?? raw.affectedRegions),
  };
}

export async function enrichArticleWithDify(params: {
  title: string;
  bodyText: string;
  sourceName: string;
  language?: string;
  sourceTier?: string;
  isOfficial?: boolean;
  requireTitleZh?: boolean;
  fallbackCategory: NewsCategory;
  fallbackPriority: NewsPriority;
}): Promise<EnrichResult | null> {
  if (!isNewsIntelEnrichEnabled()) return null;

  try {
    const outputs = await runWorkflow('DIFY_API_KEY_NEWS_INTEL', {
      title: params.title,
      body_text: params.bodyText.slice(0, 3000),
      source_name: params.sourceName,
      language: params.language ?? '',
      source_tier: params.sourceTier ?? '',
      is_official: params.isOfficial ? 'true' : 'false',
    });
    return parseEnrichOutput(outputs, params.fallbackCategory, params.fallbackPriority, {
      requireTitleZh: params.requireTitleZh,
    });
  } catch (err) {
    console.warn('[news-intel] Dify enrich failed:', err);
    return null;
  }
}
