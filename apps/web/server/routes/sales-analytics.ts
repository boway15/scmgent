import { Hono } from 'hono';
import { getCurrentUserOptional } from '../lib/auth-context.js';
import { requireMenu } from '../lib/rbac.js';
import {
  getCubeStatus,
  getLatestReadyCube,
  rebuildSalesAnalyticsCube,
} from '../lib/sales-analytics-cube.js';

export const salesAnalyticsRoutes = new Hono();

salesAnalyticsRoutes.get('/sales-analytics/status', requireMenu('data.sales_analytics'), async (c) => {
  return c.json(await getCubeStatus());
});

salesAnalyticsRoutes.get('/sales-analytics/cube', requireMenu('data.sales_analytics'), async (c) => {
  const cube = await getLatestReadyCube();
  if (!cube) return c.json({ error: 'NO_CUBE' }, 404);
  return c.json(cube);
});

salesAnalyticsRoutes.post('/sales-analytics/rebuild', requireMenu('data.sales_analytics'), async (c) => {
  const user = await getCurrentUserOptional(c);
  const result = await rebuildSalesAnalyticsCube(user?.id ?? null);
  if ('conflict' in result && result.conflict) {
    return c.json({ error: 'REBUILD_IN_PROGRESS' }, 409);
  }
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json({ ok: true });
});
