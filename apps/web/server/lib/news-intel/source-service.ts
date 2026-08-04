import { asc, eq, inArray, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, newsSources } from '@scm/db';
import { loadNewsIntelPolicy, type NewsIntelPolicy } from './policy.js';
import { buildGoogleNewsFeedUrl, buildResearchQueries } from './research-queries.js';
import type { NewsCategory, NewsSourceTier, NewsSourceType } from './types.js';

export type SeedSource = {
  code: string;
  name: string;
  feed_url: string;
  source_type: NewsSourceType;
  category_default: NewsCategory;
  fetch_interval_hours?: number;
  source_tier?: NewsSourceTier;
  is_official?: boolean;
  source_language?: string;
  scope_json?: Record<string, unknown>;
  config_json?: Record<string, unknown>;
  enabled?: boolean;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSeedSources(): SeedSource[] {
  const path = join(__dirname, 'sources.seed.json');
  return JSON.parse(readFileSync(path, 'utf8')) as SeedSource[];
}

export type ResearchSourceRow = {
  code: string;
  name: string;
  feedUrl: string;
  sourceType: 'query_feed';
  categoryDefault: 'other';
  fetchIntervalHours: number;
  sourceTier: 'tier_3';
  isOfficial: false;
  sourceLanguage: 'zh' | 'en';
  enabled: true;
  configJson: {
    discoveryQuery: string;
    language: 'zh' | 'en';
    region: string;
    channel: 'media';
    maxItemsPerQuery: number;
    siteDomain: 'news.google.com';
    sourceTier: 'tier_3';
    isOfficial: false;
  };
};

export function buildResearchSourceRows(policy: NewsIntelPolicy): ResearchSourceRow[] {
  return buildResearchQueries(policy).map((query) => ({
    code: `research_${query.code}`,
    name: `研究查询-${query.label}`,
    feedUrl: buildGoogleNewsFeedUrl(query, policy.lookbackDays),
    sourceType: 'query_feed',
    categoryDefault: 'other',
    fetchIntervalHours: 24,
    sourceTier: 'tier_3',
    isOfficial: false,
    sourceLanguage: query.language,
    enabled: true,
    configJson: {
      discoveryQuery: query.query,
      language: query.language,
      region: query.region,
      channel: 'media',
      maxItemsPerQuery: policy.research.maxItemsPerQuery,
      siteDomain: 'news.google.com',
      sourceTier: 'tier_3',
      isOfficial: false,
    },
  }));
}

export function buildExistingResearchSourcePatch(
  row: ResearchSourceRow,
  updatedAt = new Date(),
) {
  return {
    name: row.name,
    feedUrl: row.feedUrl,
    sourceType: row.sourceType,
    categoryDefault: row.categoryDefault,
    fetchIntervalHours: row.fetchIntervalHours,
    sourceTier: row.sourceTier,
    isOfficial: row.isOfficial,
    sourceLanguage: row.sourceLanguage,
    configJson: row.configJson,
    updatedAt,
  };
}

export function findStaleResearchSourceCodes(
  existing: ReadonlyArray<{ code: string; sourceType: string }>,
  currentCodes: ReadonlySet<string>,
): string[] {
  return existing
    .filter(
      (source) =>
        source.code.startsWith('research_') &&
        source.sourceType === 'query_feed' &&
        !currentCodes.has(source.code),
    )
    .map((source) => source.code);
}

export function isPublicNewsSourceType(value: unknown): value is 'rss' | 'manual' {
  return value === 'rss' || value === 'manual';
}

export function isCollectableNewsSourceType(
  value: unknown,
): value is 'rss' | 'query_feed' {
  return value === 'rss' || value === 'query_feed';
}

/** 失效或不符合策略的信源：采集前强制保持停用。 */
const FORCE_DISABLED_SOURCE_CODES = [
  'bbc_business',
  'reuters_business',
  'techcrunch',
  'digitalcommerce360',
  'theloadstar',
  'marketplacepulse',
  'cifnews',
  'ebrun',
  'amz123',
  'ustr_press',
  'customs_rsshub',
  'toutiao_crossborder',
  'toutiao_furniture',
  'toutiao_tariff',
  'toutiao_logistics',
  'toutiao_amazon',
  'customs_gov_cn',
  'mofcom_rsshub',
  'chuhaibiji_rsshub',
  'yicai_brief',
  'wallstreetcn_global',
];

export function isLegacyGoogleNewsQueryFeedUrl(feedUrl: string): boolean {
  try {
    const url = new URL(feedUrl);
    return (
      url.hostname.toLowerCase() === 'news.google.com' &&
      url.pathname.replace(/\/+$/, '') === '/rss/search'
    );
  } catch {
    return false;
  }
}

export function isLegacyGoogleNewsQuerySeed(seed: SeedSource): boolean {
  return isLegacyGoogleNewsQueryFeedUrl(seed.feed_url);
}

export function resolveSeedEnabled(seed: SeedSource): boolean {
  if (seed.enabled === false) return false;
  if (FORCE_DISABLED_SOURCE_CODES.includes(seed.code)) return false;
  if (seed.source_type === 'rsshub') return false;
  if (seed.source_type === 'sitemap' || seed.source_type === 'web_page') return false;
  if (isLegacyGoogleNewsQuerySeed(seed)) return false;
  return true;
}

export async function ensureResearchQuerySources(
  policy: NewsIntelPolicy = loadNewsIntelPolicy(),
): Promise<number> {
  let inserted = 0;
  const rows = buildResearchSourceRows(policy);
  const currentCodes = new Set(rows.map((row) => row.code));
  for (const row of rows) {
    const [existing] = await db
      .select({ id: newsSources.id })
      .from(newsSources)
      .where(eq(newsSources.code, row.code))
      .limit(1);

    const patch = buildExistingResearchSourcePatch(row);
    if (existing) {
      await db.update(newsSources).set(patch).where(eq(newsSources.id, existing.id));
    } else {
      await db.insert(newsSources).values({ code: row.code, ...patch, enabled: true });
      inserted += 1;
    }
  }

  const researchSources = await db
    .select({ code: newsSources.code, sourceType: newsSources.sourceType })
    .from(newsSources);
  for (const code of findStaleResearchSourceCodes(researchSources, currentCodes)) {
    await db
      .update(newsSources)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(newsSources.code, code));
  }
  return inserted;
}

export async function ensureNewsSourcesSeeded(): Promise<number> {
  const seeds = loadSeedSources();
  let inserted = 0;

  for (const code of FORCE_DISABLED_SOURCE_CODES) {
    await db
      .update(newsSources)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(newsSources.code, code));
  }

  await db
    .update(newsSources)
    .set({
      enabled: false,
      lastError: 'Legacy RSSHub source permanently disabled',
      updatedAt: new Date(),
    })
    .where(eq(newsSources.sourceType, 'rsshub'));

  await db
    .update(newsSources)
    .set({
      enabled: false,
      lastError: 'Collector not implemented for this source type',
      updatedAt: new Date(),
    })
    .where(inArray(newsSources.sourceType, ['sitemap', 'web_page']));

  // Static GNews-* seeds were migrated to research_* query_feed; force-disable leftovers in DB.
  await db.execute(sql`
    UPDATE news_sources
    SET
      enabled = false,
      last_error = 'Legacy static Google News query source disabled; use research_* query feeds',
      updated_at = NOW()
    WHERE source_type = 'rss'
      AND code NOT LIKE 'research_%'
      AND feed_url ILIKE 'https://news.google.com/rss/search%'
  `);

  for (const seed of seeds) {
    const [existing] = await db
      .select({ id: newsSources.id })
      .from(newsSources)
      .where(eq(newsSources.code, seed.code))
      .limit(1);

    const seedEnabled = resolveSeedEnabled(seed);
    const forceOff = !resolveSeedEnabled(seed);

    const metaPatch = {
      name: seed.name,
      feedUrl: seed.feed_url,
      sourceType: seed.source_type,
      fetchIntervalHours: seed.fetch_interval_hours ?? 24,
      sourceTier: seed.source_tier ?? 'tier_2',
      isOfficial: seed.is_official === true,
      sourceLanguage: seed.source_language ?? 'zh',
      scopeJson: seed.scope_json ?? null,
      configJson: seed.config_json ?? null,
      updatedAt: new Date(),
    };

    if (existing) {
      const enabledPatch =
        forceOff ? { enabled: false as const } : {};

      await db
        .update(newsSources)
        .set({
          ...metaPatch,
          ...enabledPatch,
        })
        .where(eq(newsSources.id, existing.id));
      continue;
    }

    await db.insert(newsSources).values({
      code: seed.code,
      categoryDefault: seed.category_default,
      ...metaPatch,
      enabled: seedEnabled,
    });
    inserted += 1;
  }

  inserted += await ensureResearchQuerySources();

  // jsonb 若被写成 JSON 字符串，解开为 object，保证 includeKeywords 生效
  await db.execute(sql`
    UPDATE news_sources
    SET config_json = (config_json #>> '{}')::jsonb
    WHERE config_json IS NOT NULL AND jsonb_typeof(config_json) = 'string'
  `);

  return inserted;
}

export async function listNewsSources() {
  return db.select().from(newsSources).orderBy(asc(newsSources.name));
}

export async function getNewsSourceById(id: string) {
  const [row] = await db.select().from(newsSources).where(eq(newsSources.id, id)).limit(1);
  return row ?? null;
}

export async function createNewsSource(input: {
  code: string;
  name: string;
  feedUrl: string;
  sourceType?: NewsSourceType;
  categoryDefault?: NewsCategory;
  fetchIntervalHours?: number;
  sourceTier?: NewsSourceTier;
  isOfficial?: boolean;
  sourceLanguage?: string;
  scopeJson?: Record<string, unknown>;
  enabled?: boolean;
  configJson?: Record<string, unknown>;
}) {
  const sourceType = input.sourceType ?? 'rss';
  if (!isPublicNewsSourceType(sourceType)) {
    throw new Error('Public source API only supports rss or manual');
  }
  const [row] = await db
    .insert(newsSources)
    .values({
      code: input.code,
      name: input.name,
      feedUrl: input.feedUrl,
      sourceType,
      categoryDefault: input.categoryDefault ?? 'other',
      fetchIntervalHours: input.fetchIntervalHours ?? 24,
      sourceTier: input.sourceTier ?? 'tier_2',
      isOfficial: input.isOfficial ?? false,
      sourceLanguage: input.sourceLanguage ?? 'zh',
      scopeJson: input.scopeJson ?? null,
      enabled: input.enabled ?? true,
      configJson: input.configJson ?? null,
    })
    .returning();
  return row;
}

export async function updateNewsSource(
  id: string,
  patch: Partial<{
    name: string;
    feedUrl: string;
    sourceType: NewsSourceType;
    categoryDefault: NewsCategory;
    fetchIntervalHours: number;
    sourceTier: NewsSourceTier;
    isOfficial: boolean;
    sourceLanguage: string;
    scopeJson: Record<string, unknown> | null;
    enabled: boolean;
    configJson: Record<string, unknown> | null;
  }>,
) {
  const current = await getNewsSourceById(id);
  if (patch.sourceType !== undefined && !isPublicNewsSourceType(patch.sourceType)) {
    throw new Error('Public source API only supports rss or manual');
  }
  if (patch.enabled === true) {
    if (
      current?.sourceType === 'rsshub' ||
      current?.sourceType === 'sitemap' ||
      current?.sourceType === 'web_page'
    ) {
      throw new Error('无法启用：该信源类型当前没有采集器');
    }
    if (current && FORCE_DISABLED_SOURCE_CODES.includes(current.code)) {
      throw new Error(`无法启用：信源 ${current.code} 已失效或不符合策略`);
    }
    if (
      current &&
      current.sourceType === 'rss' &&
      isLegacyGoogleNewsQueryFeedUrl(current.feedUrl)
    ) {
      throw new Error('无法启用：旧版静态 Google News 查询源已停用，请使用系统研究查询源');
    }
  }

  const safePatch =
    current?.sourceType === 'rsshub' ||
    current?.sourceType === 'sitemap' ||
    current?.sourceType === 'web_page'
      ? { ...patch, enabled: false as const }
      : patch;
  const [row] = await db
    .update(newsSources)
    .set({ ...safePatch, updatedAt: new Date() })
    .where(eq(newsSources.id, id))
    .returning();
  return row ?? null;
}

export async function disableNewsSource(id: string) {
  return updateNewsSource(id, { enabled: false });
}

export function isSourceDue(
  source: { lastFetchedAt: Date | null; fetchIntervalHours: number },
  now = new Date(),
): boolean {
  if (!source.lastFetchedAt) return true;
  const elapsedMs = now.getTime() - source.lastFetchedAt.getTime();
  return elapsedMs >= source.fetchIntervalHours * 60 * 60 * 1000;
}
