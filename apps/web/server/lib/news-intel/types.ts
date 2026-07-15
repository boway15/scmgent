export type NewsCategory =
  | 'supply_chain'
  | 'logistics'
  | 'customs'
  | 'platform_policy'
  | 'operations'
  | 'other';

export type NewsPriority = 'high' | 'medium' | 'low';

export type NewsArticleStatus = 'pending_review' | 'published' | 'ignored' | 'archived';

export type NewsSourceType = 'rss' | 'rsshub' | 'manual';

export type RssItem = {
  title: string;
  link: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
};

export type ParsedArticle = {
  title: string;
  canonicalUrl: string;
  summary?: string;
  bodyText?: string;
  publishedAt?: Date;
};

export type ClassifyResult = {
  category: NewsCategory;
  tags: string[];
  relevanceScore: number;
  priority: NewsPriority;
  affectedPlatforms: string[];
  affectedRegions: string[];
};

export type EnrichResult = {
  summary: string;
  keyPoints: string[];
  category: NewsCategory;
  tags: string[];
  relevanceScore: number;
  priority: NewsPriority;
  affectedPlatforms: string[];
  affectedRegions: string[];
};

export type IngestSourceResult = {
  sourceId: string;
  sourceCode: string;
  fetchedCount: number;
  newCount: number;
  skippedDup: number;
  skippedLowRelevance: number;
  skippedFiltered: number;
  errorMessage?: string;
  durationMs: number;
};

export type IngestRunResult = {
  sourcesProcessed: number;
  totalNew: number;
  totalSkippedDup: number;
  totalSkippedLowRelevance: number;
  totalSkippedFiltered: number;
  bitableSynced: number;
  alertsSent: number;
  sourceResults: IngestSourceResult[];
};
