import { desc, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  db,
  sapPoMirrorLines,
  sapPoMirrors,
  sapSyncRuns,
  type SapMirrorEntityType,
} from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu } from '../lib/rbac.js';
import { createFixtureTransport } from '../lib/sap-mirror/fixture-transport.js';
import { ingestSapMirrorBatch } from '../lib/sap-mirror/ingest.js';
import type { SapMirrorFixture } from '../lib/sap-mirror/types.js';

export const sapMirrorRoutes = new Hono();

const sapMirrorMenu = requireMenu('data.sap_mirror');

const ENTITY_TYPES = ['merchant', 'sku', 'purchase_order'] as const;

function isEntityType(value: unknown): value is SapMirrorEntityType {
  return typeof value === 'string' && (ENTITY_TYPES as readonly string[]).includes(value);
}

type IngestBody = {
  entityType?: unknown;
  items?: unknown;
  fixture?: unknown;
};

export function parseSapMirrorIngestBody(
  body: IngestBody,
):
  | { ok: true; entityType: SapMirrorEntityType; items?: unknown[]; fixture?: SapMirrorFixture }
  | { ok: false; message: string } {
  if (!isEntityType(body.entityType)) {
    return { ok: false, message: 'entityType must be merchant, sku, or purchase_order' };
  }

  if (body.items !== undefined) {
    if (!Array.isArray(body.items)) {
      return { ok: false, message: 'items must be an array' };
    }
    return { ok: true, entityType: body.entityType, items: body.items };
  }

  if (body.fixture !== undefined) {
    if (typeof body.fixture !== 'object' || body.fixture === null || Array.isArray(body.fixture)) {
      return { ok: false, message: 'fixture must be an object' };
    }
    return { ok: true, entityType: body.entityType, fixture: body.fixture as SapMirrorFixture };
  }

  return { ok: false, message: 'items or fixture is required' };
}

async function resolveIngestItems(
  entityType: SapMirrorEntityType,
  parsed: { items?: unknown[]; fixture?: SapMirrorFixture },
): Promise<unknown[]> {
  if (parsed.items) return parsed.items;

  const transport = createFixtureTransport({ fixture: parsed.fixture! });
  const all: unknown[] = [];
  let cursor: string | undefined;
  do {
    const batch = await transport.fetchBatch(entityType, cursor);
    all.push(...batch.items);
    cursor = batch.nextCursor;
  } while (cursor);
  return all;
}

sapMirrorRoutes.post('/sap-mirror/ingest', sapMirrorMenu, async (c) => {
  const body = await c.req.json<IngestBody>();
  const parsed = parseSapMirrorIngestBody(body);
  if (!parsed.ok) return c.json({ message: parsed.message }, 400);

  const items = await resolveIngestItems(parsed.entityType, parsed);
  const user = await getCurrentUser(c);
  const result = await ingestSapMirrorBatch({
    entityType: parsed.entityType,
    items,
    userId: user.id,
  });
  return c.json(result);
});

sapMirrorRoutes.get('/sap-mirror/runs', sapMirrorMenu, async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50)));
  const items = await db
    .select()
    .from(sapSyncRuns)
    .orderBy(desc(sapSyncRuns.startedAt))
    .limit(limit);
  return c.json({ items });
});

sapMirrorRoutes.get('/sap-mirror/purchase-orders', sapMirrorMenu, async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 100)));
  const mirrors = await db
    .select()
    .from(sapPoMirrors)
    .orderBy(desc(sapPoMirrors.lastSyncAt), desc(sapPoMirrors.createdAt))
    .limit(limit);

  if (mirrors.length === 0) {
    return c.json({ items: [] });
  }

  const mirrorIds = mirrors.map((mirror) => mirror.id);
  const lines = await db
    .select()
    .from(sapPoMirrorLines)
    .where(inArray(sapPoMirrorLines.mirrorId, mirrorIds));

  const linesByMirror = new Map<string, (typeof lines)[number][]>();
  for (const line of lines) {
    const bucket = linesByMirror.get(line.mirrorId) ?? [];
    bucket.push(line);
    linesByMirror.set(line.mirrorId, bucket);
  }

  const items = mirrors.map((mirror) => ({
    ...mirror,
    lines: linesByMirror.get(mirror.id) ?? [],
  }));

  return c.json({ items });
});
