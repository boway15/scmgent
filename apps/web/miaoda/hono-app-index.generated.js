import { config } from 'dotenv';
import { join } from 'path';

const cwd = process.cwd();
config({ path: join(cwd, '.env') });
config({ path: join(cwd, 'source_package/.env') });
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { menuRoutes } from './routes/menus.js';
import { skuRoutes } from './routes/skus.js';
import { inventoryRoutes } from './routes/inventory.js';
import { safetyStockRoutes } from './routes/safety-stock.js';
import { alertRoutes } from './routes/alerts.js';
import { reorderRoutes } from './routes/reorder.js';
import { roleRoutes } from './routes/roles.js';
import { importRoutes } from './routes/import.js';
import { aiRoutes } from './routes/ai.js';
import { authMiddleware } from './middleware/auth.js';
import { requireWrite } from './lib/rbac.js';
import { procurementRoutes } from './routes/procurement.js';
import { pmcRoutes } from './routes/pmc.js';
import { logisticsRoutes } from './routes/logistics.js';

import { taskRoutes } from './routes/tasks.js';
import { productRoutes } from './routes/products.js';
import { complianceRoutes } from './routes/compliance.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { salesRoutes } from './routes/sales.js';
import { sql } from 'drizzle-orm';
import { db } from './_db';

/** 妙搭子路径由 Nest 桥接剥离；Hono 路由固定 /api/*（勿再 basePath） */
const app = new Hono();
console.log('[scm-hono] routes at /api/* (CLIENT_BASE_PATH stripped by Nest bridge)');
app.use('*', logger());

app.get('/api/health', async (c) => {
  const payload = {
    status: 'ok',
    timestamp: new Date().toISOString(),
  };
  try {
    await db.execute(sql`SELECT 1`);
    payload.db = 'connected';
  } catch (err) {
    payload.status = 'degraded';
    payload.db = 'error';
    payload.dbMessage = err instanceof Error ? err.message : 'unknown';
  }
  return c.json(payload, payload.status === 'ok' ? 200 : 503);
});

app.use('/api/*', authMiddleware);

app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  const method = c.req.method;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();
  if (path.startsWith('/api/auth/') || path.startsWith('/api/tasks/')) return next();
  return requireWrite()(c, next);
});

app.route('/api', authRoutes);
app.route('/api', userRoutes);
app.route('/api', menuRoutes);
app.route('/api', skuRoutes);
app.route('/api', inventoryRoutes);
app.route('/api', safetyStockRoutes);
app.route('/api', alertRoutes);
app.route('/api', reorderRoutes);
app.route('/api', procurementRoutes);
app.route('/api', pmcRoutes);
app.route('/api', logisticsRoutes);
app.route('/api', roleRoutes);
app.route('/api', importRoutes);
app.route('/api', aiRoutes);
app.route('/api', taskRoutes);
app.route('/api', productRoutes);
app.route('/api', complianceRoutes);
app.route('/api', dashboardRoutes);
app.route('/api', salesRoutes);

app.onError((err, c) => {
  console.error(err);
  const isProd = process.env.NODE_ENV === 'production';
  const message =
    isProd && !['Unauthorized', 'Forbidden'].includes(err.message)
      ? 'Internal Server Error'
      : (err.message ?? 'Internal Server Error');
  const status =
    err.message === 'Unauthorized' ? 401 : err.message === 'Forbidden' ? 403 : 500;
  return c.json({ message }, status);
});

export default app;

/** 妙搭：由 ScmHonoModule 挂载，不在此文件 serve() */
