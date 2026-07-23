import { asc, eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, newsSources } from '@scm/db';
import { getRsshubBaseUrl } from './config.js';
import type { NewsCategory, NewsSourceTier, NewsSourceType } from './types.js';

type SeedSource = {
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

function resolveSeedEnabled(seed: SeedSource, rsshubReady: boolean): boolean {
  if (seed.enabled === false) return false;
  if (FORCE_DISABLED_SOURCE_CODES.includes(seed.code)) return false;
  if (seed.source_type === 'rsshub' && !rsshubReady) return false;
  return seed.enabled !== false;
}

export async function ensureNewsSourcesSeeded(): Promise<number> {
  const seeds = loadSeedSources();
  let inserted = 0;
  const rsshubReady = Boolean(getRsshubBaseUrl());

  for (const code of FORCE_DISABLED_SOURCE_CODES) {
    await db
      .update(newsSources)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(newsSources.code, code));
  }

  if (!rsshubReady) {
    await db
      .update(newsSources)
      .set({
        enabled: false,
        lastError: 'RSSHUB_BASE_URL not configured — rsshub source disabled',
        updatedAt: new Date(),
      })
      .where(eq(newsSources.sourceType, 'rsshub'));
  }

  for (const seed of seeds) {
    const [existing] = await db
      .select({ id: newsSources.id })
      .from(newsSources)
      .where(eq(newsSources.code, seed.code))
      .limit(1);

    const seedEnabled = resolveSeedEnabled(seed, rsshubReady);
    const forceOff =
      FORCE_DISABLED_SOURCE_CODES.includes(seed.code) ||
      (seed.source_type === 'rsshub' && !rsshubReady) ||
      seed.enabled === false;

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
        forceOff
          ? { enabled: false as const }
          : seed.source_type === 'rsshub' && rsshubReady
            ? {
                enabled: seedEnabled,
                ...(seedEnabled ? { lastError: null } : {}),
              }
            : {};

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
  const [row] = await db
    .insert(newsSources)
    .values({
      code: input.code,
      name: input.name,
      feedUrl: input.feedUrl,
      sourceType: input.sourceType ?? 'rss',
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
  if (patch.enabled === true) {
    const current = await getNewsSourceById(id);
    if (current?.sourceType === 'rsshub' && !getRsshubBaseUrl()) {
      throw new Error('无法启用：未配置 RSSHUB_BASE_URL');
    }
    if (current && FORCE_DISABLED_SOURCE_CODES.includes(current.code)) {
      throw new Error(`无法启用：信源 ${current.code} 已失效或不符合策略`);
    }
  }

  const [row] = await db
    .update(newsSources)
    .set({ ...patch, updatedAt: new Date() })
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
