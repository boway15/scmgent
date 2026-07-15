import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = join(__dirname, 'openclaw-policy.json');

export type NewsSourceConfig = {
  channel?: 'media' | 'wechat' | 'xiaohongshu';
  includeKeywords?: string[];
  excludeKeywords?: string[];
  siteDomain?: string;
  note?: string;
};

export type CategoryPolicy = {
  bitableValue: string;
  priority: number;
  keywords: string[];
  platforms?: string[];
};

export type NewsIntelPolicy = {
  lookbackDays: number;
  maxItemsPerSource: number;
  requireChineseContent?: boolean;
  excludeEnglishDomains?: string[];
  channels: Record<string, { enabled: boolean; label: string }>;
  negativeKeywords: string[];
  includeRegionKeywords: string[];
  excludeRegionKeywords: string[];
  usVietnamPolicyKeywords: string[];
  categories: CategoryPolicy[];
  categoryTieBreakOrder: string[];
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

export function saveNewsIntelPolicy(policy: NewsIntelPolicy): void {
  writeFileSync(POLICY_PATH, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
  cachedPolicy = policy;
  cachedAt = Date.now();
}

export function getLookbackDays(): number {
  const env = Number(process.env.NEWS_INTEL_LOOKBACK_DAYS);
  if (Number.isFinite(env) && env > 0) return env;
  return loadNewsIntelPolicy().lookbackDays;
}

export function parseSourceConfig(raw: unknown): NewsSourceConfig {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
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
  };
}

export function isSourceChannelEnabled(config: NewsSourceConfig): boolean {
  const policy = loadNewsIntelPolicy();
  const channel = config.channel ?? 'media';
  return policy.channels[channel]?.enabled !== false;
}
