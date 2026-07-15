import { asc, eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, newsSources } from '@scm/db';
import type { NewsCategory, NewsSourceType } from './types.js';

type SeedSource = {
  code: string;
  name: string;
  feed_url: string;
  source_type: NewsSourceType;
  category_default: NewsCategory;
  fetch_interval_hours?: number;
  config_json?: Record<string, unknown>;
  enabled?: boolean;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSeedSources(): SeedSource[] {
  const path = join(__dirname, 'sources.seed.json');
  return JSON.parse(readFileSync(path, 'utf8')) as SeedSource[];
}

const DEPRECATED_ENGLISH_SOURCE_CODES = [
  'bbc_business',
  'reuters_business',
  'techcrunch',
  'digitalcommerce360',
  'theloadstar',
  'marketplacepulse',
  'amazon_news',
];

export async function ensureNewsSourcesSeeded(): Promise<number> {
  const seeds = loadSeedSources();
  let inserted = 0;

  for (const code of DEPRECATED_ENGLISH_SOURCE_CODES) {
    await db
      .update(newsSources)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(newsSources.code, code));
  }

  for (const seed of seeds) {
    const [existing] = await db
      .select({ id: newsSources.id })
      .from(newsSources)
      .where(eq(newsSources.code, seed.code))
      .limit(1);

    if (existing) {
      await db
        .update(newsSources)
        .set({
          name: seed.name,
          feedUrl: seed.feed_url,
          sourceType: seed.source_type,
          fetchIntervalHours: seed.fetch_interval_hours ?? 12,
          configJson: seed.config_json ?? null,
          enabled: seed.enabled !== false,
          updatedAt: new Date(),
        })
        .where(eq(newsSources.id, existing.id));
      continue;
    }

    await db.insert(newsSources).values({
      code: seed.code,
      name: seed.name,
      feedUrl: seed.feed_url,
      sourceType: seed.source_type,
      categoryDefault: seed.category_default,
      fetchIntervalHours: seed.fetch_interval_hours ?? 12,
      configJson: seed.config_json ?? null,
      enabled: seed.enabled !== false,
    });
    inserted += 1;
  }

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
      fetchIntervalHours: input.fetchIntervalHours ?? 12,
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
    enabled: boolean;
    configJson: Record<string, unknown> | null;
  }>,
) {
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
