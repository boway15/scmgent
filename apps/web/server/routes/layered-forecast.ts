import { and, count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, layeredForecastNodes, layeredForecastVersions } from '@scm/db';
import { getCurrentUserOptional } from '../lib/auth-context.js';
import { requireMenu } from '../lib/rbac.js';
import { generateLayeredForecastVersion } from '../lib/layered-forecast-generate.js';
import {
  patchNodeQty,
  publishVersion,
  reconcileVersion,
  setNodeLocked,
} from '../lib/layered-forecast-mutate.js';

export const layeredForecastRoutes = new Hono();

const layeredForecastMenu = requireMenu('data.layered_forecast');

const LAYERED_LEVELS = ['project_group', 'category', 'platform', 'sku'] as const;

const NOT_FOUND_MESSAGES = new Set(['分层预测版本不存在', '分层预测节点不存在']);

type LayeredNodeRow = typeof layeredForecastNodes.$inferSelect;

function toNum(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function serializeNode(row: LayeredNodeRow) {
  return {
    ...row,
    qty: toNum(row.qty) ?? 0,
    systemQty: toNum(row.systemQty) ?? 0,
    draftQty: toNum(row.draftQty),
    seasonalityFactor: toNum(row.seasonalityFactor),
    trendFactor: toNum(row.trendFactor),
  };
}

function mapLayeredForecastError(err: unknown): { status: 400 | 404 | 500; error: string } {
  if (!(err instanceof Error)) return { status: 500, error: '内部错误' };
  if (NOT_FOUND_MESSAGES.has(err.message)) return { status: 404, error: err.message };
  return { status: 400, error: err.message };
}

function parseLimit(raw: string | undefined, defaultValue = 200, max = 1000): number {
  if (!raw) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return defaultValue;
  return Math.min(value, max);
}

function parseOffset(raw: string | undefined): number {
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

async function getVersionOrNull(versionId: string) {
  const [version] = await db
    .select()
    .from(layeredForecastVersions)
    .where(eq(layeredForecastVersions.id, versionId));
  return version ?? null;
}

layeredForecastRoutes.post('/layered-forecasts/generate', layeredForecastMenu, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const user = await getCurrentUserOptional(c);

  try {
    const result = await generateLayeredForecastVersion({
      startMonth: typeof body.startMonth === 'string' ? body.startMonth : undefined,
      horizonMonths:
        body.horizonMonths === undefined ? undefined : Number(body.horizonMonths),
      projectGroup: typeof body.projectGroup === 'string' ? body.projectGroup : undefined,
      category: typeof body.category === 'string' ? body.category : undefined,
      createdBy: user?.id ?? null,
    });
    return c.json(result, 201);
  } catch (err) {
    const mapped = mapLayeredForecastError(err);
    return c.json({ error: mapped.error }, mapped.status);
  }
});

layeredForecastRoutes.get('/layered-forecasts/versions', layeredForecastMenu, async (c) => {
  const items = await db
    .select()
    .from(layeredForecastVersions)
    .orderBy(desc(layeredForecastVersions.createdAt))
    .limit(50);
  return c.json({ items });
});

layeredForecastRoutes.get('/layered-forecasts/versions/:id', layeredForecastMenu, async (c) => {
  const versionId = c.req.param('id');
  if (!versionId) return c.json({ error: '缺少版本 ID' }, 400);
  const version = await getVersionOrNull(versionId);
  if (!version) return c.json({ error: '分层预测版本不存在' }, 404);
  return c.json(version);
});

layeredForecastRoutes.get('/layered-forecasts/versions/:id/nodes', layeredForecastMenu, async (c) => {
  const versionId = c.req.param('id');
  if (!versionId) return c.json({ error: '缺少版本 ID' }, 400);
  const version = await getVersionOrNull(versionId);
  if (!version) return c.json({ error: '分层预测版本不存在' }, 404);

  const level = c.req.query('level');
  if (level && !LAYERED_LEVELS.includes(level as (typeof LAYERED_LEVELS)[number])) {
    return c.json({ error: 'level 无效' }, 400);
  }

  const projectGroup = c.req.query('projectGroup');
  const category = c.req.query('category');
  const platform = c.req.query('platform');
  const period = c.req.query('period');
  const limit = parseLimit(c.req.query('limit'));
  const offset = parseOffset(c.req.query('offset'));

  const conditions = [eq(layeredForecastNodes.versionId, versionId)];
  if (level) conditions.push(eq(layeredForecastNodes.level, level as (typeof LAYERED_LEVELS)[number]));
  if (projectGroup) conditions.push(eq(layeredForecastNodes.projectGroup, projectGroup));
  if (category) conditions.push(eq(layeredForecastNodes.category, category));
  if (platform) conditions.push(eq(layeredForecastNodes.platform, platform));
  if (period) conditions.push(eq(layeredForecastNodes.period, period));

  const whereClause = and(...conditions);

  const [totalRow] = await db
    .select({ total: count() })
    .from(layeredForecastNodes)
    .where(whereClause);

  const rows = await db
    .select()
    .from(layeredForecastNodes)
    .where(whereClause)
    .orderBy(
      layeredForecastNodes.level,
      layeredForecastNodes.projectGroup,
      layeredForecastNodes.category,
      layeredForecastNodes.platform,
      layeredForecastNodes.period,
    )
    .limit(limit)
    .offset(offset);

  return c.json({
    items: rows.map(serializeNode),
    total: Number(totalRow?.total ?? 0),
  });
});

layeredForecastRoutes.patch(
  '/layered-forecasts/versions/:id/nodes/:nodeId',
  layeredForecastMenu,
  async (c) => {
    const versionId = c.req.param('id');
    const nodeId = c.req.param('nodeId');
    if (!versionId || !nodeId) return c.json({ error: '缺少版本或节点 ID' }, 400);

    const body = await c.req.json().catch(() => ({}));
    const qty = Number(body.qty);
    if (!Number.isFinite(qty)) {
      return c.json({ error: 'qty 须为数字' }, 400);
    }

    try {
      await patchNodeQty({
        versionId,
        nodeId,
        qty,
        cascade: body.cascade === true,
      });
      return c.json({ ok: true });
    } catch (err) {
      const mapped = mapLayeredForecastError(err);
      return c.json({ error: mapped.error }, mapped.status);
    }
  },
);

layeredForecastRoutes.post(
  '/layered-forecasts/versions/:id/nodes/:nodeId/lock',
  layeredForecastMenu,
  async (c) => {
    const versionId = c.req.param('id');
    const nodeId = c.req.param('nodeId');
    if (!versionId || !nodeId) return c.json({ error: '缺少版本或节点 ID' }, 400);

    const body = await c.req.json().catch(() => ({}));
    if (typeof body.locked !== 'boolean') {
      return c.json({ error: 'locked 须为布尔值' }, 400);
    }

    try {
      await setNodeLocked({
        versionId,
        nodeId,
        locked: body.locked,
      });
      return c.json({ ok: true });
    } catch (err) {
      const mapped = mapLayeredForecastError(err);
      return c.json({ error: mapped.error }, mapped.status);
    }
  },
);

layeredForecastRoutes.post(
  '/layered-forecasts/versions/:id/reconcile',
  layeredForecastMenu,
  async (c) => {
    const versionId = c.req.param('id');
    if (!versionId) return c.json({ error: '缺少版本 ID' }, 400);

    const body = await c.req.json().catch(() => ({}));
    const mode = body.mode;
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : '';
    if (mode !== 'from_parent' && mode !== 'reset_parent_from_children') {
      return c.json({ error: 'mode 须为 from_parent 或 reset_parent_from_children' }, 400);
    }
    if (!nodeId) {
      return c.json({ error: 'nodeId 必填' }, 400);
    }

    try {
      await reconcileVersion({
        versionId,
        mode,
        nodeId,
      });
      return c.json({ ok: true });
    } catch (err) {
      const mapped = mapLayeredForecastError(err);
      return c.json({ error: mapped.error }, mapped.status);
    }
  },
);

layeredForecastRoutes.post(
  '/layered-forecasts/versions/:id/publish',
  layeredForecastMenu,
  async (c) => {
    const versionId = c.req.param('id');
    if (!versionId) return c.json({ error: '缺少版本 ID' }, 400);

    const user = await getCurrentUserOptional(c);
    try {
      await publishVersion(versionId, user?.id ?? null);
      return c.json({ ok: true });
    } catch (err) {
      const mapped = mapLayeredForecastError(err);
      return c.json({ error: mapped.error }, mapped.status);
    }
  },
);
