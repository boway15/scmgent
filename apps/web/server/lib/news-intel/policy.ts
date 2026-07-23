import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NewsDepartment, NewsSourceTier, NewsTopicCategory } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = join(__dirname, 'openclaw-policy.json');

export type NewsSourceConfig = {
  channel?: 'media' | 'wechat' | 'xiaohongshu';
  includeKeywords?: string[];
  excludeKeywords?: string[];
  siteDomain?: string;
  note?: string;
  sourceTier?: NewsSourceTier;
  isOfficial?: boolean;
  language?: string;
};

export type BrandPolicy = { name: string; aliases: string[] };
export type NamedAliasPolicy = { name: string; aliases: string[] };

export type TopicPolicy = {
  value: NewsTopicCategory;
  departments: NewsDepartment[];
  keywords: string[];
};

export type NewsIntelPolicy = {
  lookbackDays: number;
  maxItemsPerSource: number;
  requireChineseContent?: boolean;
  channels: Record<string, { enabled: boolean; label: string }>;
  negativeKeywords: string[];
  includeRegionKeywords: string[];
  excludeRegionKeywords: string[];
  usVietnamPolicyKeywords: string[];
  crossBorderKeywords?: string[];
  furnitureKeywords: string[];
  brandKeywords: BrandPolicy[];
  platformKeywords: NamedAliasPolicy[];
  countryKeywords: NamedAliasPolicy[];
  logisticsKeywords: string[];
  aiKeywords: string[];
  designKeywords: string[];
  marketingKeywords: string[];
  topics: TopicPolicy[];
  categoryTieBreakOrder: NewsTopicCategory[];
};

let cachedPolicy: NewsIntelPolicy | null = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

export function loadNewsIntelPolicy(): NewsIntelPolicy {
  if (cachedPolicy && Date.now() - cachedAt < CACHE_MS) return cachedPolicy;
  const raw = readFileSync(POLICY_PATH, 'utf8');
  cachedPolicy = JSON.parse(raw) as NewsIntelPolicy;
  cachedAt = Date.now();
  return cachedPolicy;
}

/** @deprecated Policy is read-only at runtime for Miaoda safety. Kept for type compatibility. */
export function saveNewsIntelPolicy(_policy: NewsIntelPolicy): void {
  throw new Error('News intel policy is read-only; edit openclaw-policy.json and redeploy');
}

export function getLookbackDays(): number {
  const env = Number(process.env.NEWS_INTEL_LOOKBACK_DAYS);
  if (Number.isFinite(env) && env > 0) return env;
  return loadNewsIntelPolicy().lookbackDays;
}

export function parseSourceConfig(raw: unknown): NewsSourceConfig {
  let value: unknown = raw;
  // jsonb 历史数据可能被双重字符串化，最多解开两层
  for (let i = 0; i < 2 && typeof value === 'string'; i += 1) {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object') return {};
  const obj = value as Record<string, unknown>;
  return {
    channel: obj.channel as NewsSourceConfig['channel'],
    includeKeywords: Array.isArray(obj.includeKeywords)
      ? obj.includeKeywords.filter((k): k is string => typeof k === 'string')
      : undefined,
    excludeKeywords: Array.isArray(obj.excludeKeywords)
      ? obj.excludeKeywords.filter((k): k is string => typeof k === 'string')
      : undefined,
    siteDomain: typeof obj.siteDomain === 'string' ? obj.siteDomain : undefined,
    note: typeof obj.note === 'string' ? obj.note : undefined,
    sourceTier:
      obj.sourceTier === 'tier_1' || obj.sourceTier === 'tier_2' || obj.sourceTier === 'tier_3'
        ? obj.sourceTier
        : undefined,
    isOfficial: typeof obj.isOfficial === 'boolean' ? obj.isOfficial : undefined,
    language: typeof obj.language === 'string' ? obj.language : undefined,
  };
}

export function isSourceChannelEnabled(config: NewsSourceConfig): boolean {
  const policy = loadNewsIntelPolicy();
  const channel = config.channel ?? 'media';
  return policy.channels[channel]?.enabled !== false;
}

export function resolveSourceTier(
  sourceTier?: NewsSourceTier | null,
  config?: NewsSourceConfig,
): NewsSourceTier {
  return sourceTier ?? config?.sourceTier ?? 'tier_2';
}

export function resolveSourceOfficial(
  isOfficial?: boolean | null,
  config?: NewsSourceConfig,
): boolean {
  return Boolean(isOfficial ?? config?.isOfficial);
}
