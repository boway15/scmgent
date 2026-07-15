import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { getCurrentUser } from '../lib/auth-context.js';
import { parseListPagination } from '../lib/list-pagination.js';
import {
  getNewsArticleById,
  getNewsIntelOverview,
  listNewsArticles,
  runNewsIngest,
  updateNewsArticle,
} from '../lib/news-intel/ingest-pipeline.js';
import { listRecentIngestLogs } from '../lib/news-intel/ingest-logs.js';
import {
  createNewsSource,
  disableNewsSource,
  listNewsSources,
  updateNewsSource,
} from '../lib/news-intel/source-service.js';
import { syncArticleToBitable } from '../lib/news-intel/bitable-sync.js';
import {
  getNewsBitableAppToken,
  getNewsBitableTableId,
  isNewsBitableConfigured,
  isNewsIntelEnabled,
} from '../lib/news-intel/config.js';
import { loadNewsIntelPolicy, saveNewsIntelPolicy } from '../lib/news-intel/policy.js';
import { getLatestTaskRun } from '../lib/task-runs.js';

export const newsIntelRoutes = new Hono();

async function requireNewsIntelAdmin(c: Context, next: Next) {
  const user = await getCurrentUser(c);
  if (user.role.code !== 'super_admin') {
    return c.json({ message: 'Forbidden' }, 403);
  }
  return next();
}

newsIntelRoutes.get('/news-intel/status', requireNewsIntelAdmin, async (c) => {
  const latestRun = await getLatestTaskRun('news_ingest');
  return c.json({
    enabled: isNewsIntelEnabled(),
    bitableConfigured: isNewsBitableConfigured(),
    bitableAppTokenConfigured: Boolean(getNewsBitableAppToken()),
    bitableTableId: getNewsBitableTableId(),
    latestRun,
  });
});

newsIntelRoutes.get('/news-intel/overview', requireNewsIntelAdmin, async (c) => {
  const overview = await getNewsIntelOverview();
  return c.json(overview);
});

newsIntelRoutes.get('/news-intel/policy', requireNewsIntelAdmin, async (c) => {
  return c.json(loadNewsIntelPolicy());
});

newsIntelRoutes.put('/news-intel/policy', requireNewsIntelAdmin, async (c) => {
  const body = await c.req.json();
  saveNewsIntelPolicy(body);
  return c.json({ ok: true });
});

newsIntelRoutes.get('/news-intel/sources', requireNewsIntelAdmin, async (c) => {
  const sources = await listNewsSources();
  return c.json({ items: sources });
});

newsIntelRoutes.post('/news-intel/sources', requireNewsIntelAdmin, async (c) => {
  const body = await c.req.json<{
    code: string;
    name: string;
    feedUrl: string;
    sourceType?: 'rss' | 'rsshub' | 'manual';
    categoryDefault?: string;
    fetchIntervalHours?: number;
    enabled?: boolean;
    configJson?: {
      channel?: 'media' | 'wechat' | 'xiaohongshu';
      includeKeywords?: string[];
      excludeKeywords?: string[];
      siteDomain?: string;
      note?: string;
    };
  }>();

  if (!body.code?.trim() || !body.name?.trim() || !body.feedUrl?.trim()) {
    return c.json({ message: 'code, name, feedUrl are required' }, 400);
  }

  try {
    const source = await createNewsSource({
      code: body.code.trim(),
      name: body.name.trim(),
      feedUrl: body.feedUrl.trim(),
      sourceType: body.sourceType,
      categoryDefault: body.categoryDefault as never,
      fetchIntervalHours: body.fetchIntervalHours,
      enabled: body.enabled,
      configJson: body.configJson,
    });
    return c.json(source, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'create source failed';
    return c.json({ message }, 400);
  }
});

newsIntelRoutes.patch('/news-intel/sources/:id', requireNewsIntelAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    feedUrl?: string;
    sourceType?: 'rss' | 'rsshub' | 'manual';
    categoryDefault?: string;
    fetchIntervalHours?: number;
    enabled?: boolean;
    configJson?: {
      channel?: 'media' | 'wechat' | 'xiaohongshu';
      includeKeywords?: string[];
      excludeKeywords?: string[];
      siteDomain?: string;
      note?: string;
    } | null;
  }>();

  const source = await updateNewsSource(id, {
    name: body.name,
    feedUrl: body.feedUrl,
    sourceType: body.sourceType,
    categoryDefault: body.categoryDefault as never,
    fetchIntervalHours: body.fetchIntervalHours,
    enabled: body.enabled,
    configJson: body.configJson ?? undefined,
  });

  if (!source) return c.json({ message: 'Source not found' }, 404);
  return c.json(source);
});

newsIntelRoutes.delete('/news-intel/sources/:id', requireNewsIntelAdmin, async (c) => {
  const id = c.req.param('id');
  const source = await disableNewsSource(id);
  if (!source) return c.json({ message: 'Source not found' }, 404);
  return c.json(source);
});

newsIntelRoutes.get('/news-intel/articles', requireNewsIntelAdmin, async (c) => {
  const { page, pageSize } = parseListPagination(
    c.req.query('page'),
    c.req.query('pageSize'),
    20,
  );
  const category = c.req.query('category');
  const status = c.req.query('status');

  const result = await listNewsArticles({ page, pageSize, category, status });
  return c.json(result);
});

newsIntelRoutes.get('/news-intel/articles/:id', requireNewsIntelAdmin, async (c) => {
  const article = await getNewsArticleById(c.req.param('id'));
  if (!article) return c.json({ message: 'Article not found' }, 404);
  return c.json(article);
});

newsIntelRoutes.patch('/news-intel/articles/:id', requireNewsIntelAdmin, async (c) => {
  const body = await c.req.json<{
    status?: 'pending_review' | 'published' | 'ignored' | 'archived';
    priority?: 'high' | 'medium' | 'low';
    category?: string;
  }>();

  const article = await updateNewsArticle(c.req.param('id'), body);
  if (!article) return c.json({ message: 'Article not found' }, 404);

  if (body.status && body.status !== 'ignored') {
    try {
      await syncArticleToBitable(article.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'bitable sync failed';
      return c.json({ article, bitableSyncError: message });
    }
  }

  return c.json(article);
});

newsIntelRoutes.post('/news-intel/articles/:id/sync-bitable', requireNewsIntelAdmin, async (c) => {
  try {
    const recordId = await syncArticleToBitable(c.req.param('id'));
    return c.json({ recordId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bitable sync failed';
    return c.json({ message }, 502);
  }
});

newsIntelRoutes.get('/news-intel/ingest/logs', requireNewsIntelAdmin, async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 30)));
  const logs = await listRecentIngestLogs(limit);
  return c.json({ items: logs });
});

newsIntelRoutes.post('/news-intel/ingest/trigger', requireNewsIntelAdmin, async (c) => {
  const body = await c.req.json<{ force?: boolean; sourceId?: string }>().catch(() => ({}));
  try {
    const result = await runNewsIngest({
      force: body.force,
      sourceId: body.sourceId,
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'news ingest failed';
    return c.json({ message }, 500);
  }
});
