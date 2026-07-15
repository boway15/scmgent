import { isDifyKeyConfigured, runWorkflow } from '../../integrations/dify.js';
import { isNewsIntelLlmEnabled } from './config.js';
import type { EnrichResult, NewsCategory, NewsPriority } from './types.js';

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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function parseEnrichOutput(
  outputs: Record<string, unknown>,
  fallbackCategory: NewsCategory,
  fallbackPriority: NewsPriority,
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

  return {
    summary,
    keyPoints: asStringArray(raw.key_points ?? raw.keyPoints),
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
  fallbackCategory: NewsCategory;
  fallbackPriority: NewsPriority;
}): Promise<EnrichResult | null> {
  if (!isNewsIntelEnrichEnabled()) return null;

  try {
    const outputs = await runWorkflow('DIFY_API_KEY_NEWS_INTEL', {
      title: params.title,
      body_text: params.bodyText.slice(0, 3000),
      source_name: params.sourceName,
    });
    return parseEnrichOutput(outputs, params.fallbackCategory, params.fallbackPriority);
  } catch (err) {
    console.warn('[news-intel] Dify enrich failed:', err);
    return null;
  }
}
