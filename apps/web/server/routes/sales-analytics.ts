import { Hono } from 'hono';
import { getCurrentUserOptional } from '../lib/auth-context.js';
import { requireMenu } from '../lib/rbac.js';
import { parseProductScope } from '../lib/planning-accessory-filter.js';
import {
  filterCubeByProjectGroupScope,
  getCubeStatus,
  getLatestReadyCube,
  rebuildSalesAnalyticsCube,
} from '../lib/sales-analytics-cube.js';
import { resolveRequestProjectGroupScope } from '../lib/data-scope.js';

export const salesAnalyticsRoutes = new Hono();

salesAnalyticsRoutes.get('/sales-analytics/status', requireMenu('data.sales_analytics'), async (c) => {
  return c.json(await getCubeStatus());
});

salesAnalyticsRoutes.get('/sales-analytics/cube', requireMenu('data.sales_analytics'), async (c) => {
  const productScope = parseProductScope(c.req.query('productScope'));
  const cube = await getLatestReadyCube(productScope);
  if (!cube) return c.json({ error: 'NO_CUBE' }, 404);

  const scope = await resolveRequestProjectGroupScope(c);
  const filtered = filterCubeByProjectGroupScope(cube, scope);
  if (!filtered.ok) {
    return c.json(
      {
        error: 'CUBE_SCOPE_STALE',
        message: '当前销售分析快照缺少项目组维度，请先点击「刷新看板数据」重建后再查看。',
      },
      409,
    );
  }
  return c.json(filtered.cube);
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
