export type NewsCategory =
  | 'supply_chain'
  | 'logistics'
  | 'customs'
  | 'platform_policy'
  | 'operations'
  | 'other';

export type NewsSourceTier = 'tier_1' | 'tier_2' | 'tier_3';

export type NewsTopicCategory =
  | '产品开发与家具趋势'
  | 'PMC与供应链'
  | '采购与供应商'
  | '物流海关与关税'
  | '平台运营'
  | '营销推广'
  | '视觉设计'
  | 'AI前沿'
  | '法规与外部环境';

export type NewsDepartment =
  | '产品开发'
  | 'PMC'
  | '采购'
  | '物流'
  | '平台运营'
  | '营销推广'
  | '视觉设计'
  | 'AI'
  | '法规与外部环境';

export type NewsPriority = 'high' | 'medium' | 'low';

export type NewsArticleStatus = 'pending_review' | 'published' | 'ignored' | 'archived';

export type NewsBitableSyncStatus = 'pending' | 'synced' | 'failed';

export type NewsBusinessValidity = 'valid' | 'invalid' | 'misclassified';

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

export type NewsClassification = {
  topicCategory: NewsTopicCategory;
  departments: NewsDepartment[];
  platformTags: string[];
  countryTags: string[];
  businessTags: string[];
  brandTags: string[];
  filterHits: string[];
  relevanceScore: number;
  priority: NewsPriority;
};

export type RelevanceEvaluation = {
  pass: boolean;
  reason: string;
  hits: string[];
  sourceTier: NewsSourceTier;
  requiresTranslation: boolean;
};

export type EnrichResult = {
  titleZh?: string;
  summary: string;
  keyPoints: string[];
  topicCategory?: NewsTopicCategory;
  departments?: NewsDepartment[];
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
  translatedCount: number;
  bitableSyncFailedCount: number;
  errorMessage?: string;
  durationMs: number;
};

export type IngestRunResult = {
  sourcesProcessed: number;
  totalNew: number;
  totalSkippedDup: number;
  totalSkippedLowRelevance: number;
  totalSkippedFiltered: number;
  totalTranslated: number;
  bitableSynced: number;
  bitableSyncFailed: number;
  skippedAlreadyRunToday?: boolean;
  sourceResults: IngestSourceResult[];
};
