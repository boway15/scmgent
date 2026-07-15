import { config } from 'dotenv';
import { networkInterfaces } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
config({ path: join(cwd, '.env') });
config({ path: join(cwd, 'source_package/.env') });
config({ path: join(__dirname, '../../../.env') });
config({ path: join(__dirname, '../.env') });

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
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
import { requireWrite, requireBusinessRead } from './lib/rbac.js';
import { procurementRoutes } from './routes/procurement.js';
import { procurementListRoutes } from './routes/procurement-lists.js';
import { pmcRoutes } from './routes/pmc.js';
import { logisticsRoutes } from './routes/logistics.js';
import { bitableSyncRoutes } from './routes/bitable-sync.js';

import { newsIntelRoutes } from './routes/news-intel.js';
import { csReplyQualityRoutes } from './routes/cs-reply-quality.js';

import { taskRoutes } from './routes/tasks.js';
import { productRoutes } from './routes/products.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { salesRoutes } from './routes/sales.js';
import { auditLogRoutes } from './routes/audit-logs.js';
import { skuEncodingRoutes } from './routes/sku-encoding.js';
import { inventoryHealthRoutes } from './routes/inventory-health.js';
import { salesForecastRoutes } from './routes/sales-forecast.js';
import { inventoryExceptionRoutes } from './routes/inventory-exceptions.js';
import { sql } from 'drizzle-orm';
import { db } from '@scm/db';
import { getRuntimeConfigSummary } from './lib/runtime-config.js';

/** 妙搭子路径由 Nest 桥接剥离；Hono 路由固定 /api/*（勿再 basePath） */
const app = new Hono();
console.log('[scm-hono] routes at /api/* (CLIENT_BASE_PATH stripped by Nest bridge)');
const serveStaticFiles = process.env.SERVE_STATIC === 'true';
const distRoot = join(__dirname, '../dist');

app.use('*', logger());

function isPrivateLanHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  return false;
}

function isDevFrontendOrigin(origin: string): boolean {
  try {
    const { hostname, port } = new URL(origin);
    if (port !== '5173') return false;
    return isPrivateLanHost(hostname);
  } catch {
    return false;
  }
}

if (!serveStaticFiles) {
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return origin;
        return isDevFrontendOrigin(origin) ? origin : null;
      },
      credentials: true,
    }),
  );
}

app.get('/api/health', async (c) => {
  const runtime = getRuntimeConfigSummary();
  const payload: Record<string, unknown> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    runtime,
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
app.use('/api/*', requireBusinessRead());

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
app.route('/api', procurementListRoutes);
app.route('/api', pmcRoutes);
app.route('/api', logisticsRoutes);
app.route('/api', bitableSyncRoutes);
app.route('/api', roleRoutes);
app.route('/api', importRoutes);
app.route('/api', aiRoutes);
app.route('/api', taskRoutes);
app.route('/api', productRoutes);
app.route('/api', dashboardRoutes);
app.route('/api', salesRoutes);
app.route('/api', auditLogRoutes);
app.route('/api', skuEncodingRoutes);
app.route('/api', inventoryHealthRoutes);
app.route('/api', salesForecastRoutes);
app.route('/api', inventoryExceptionRoutes);
app.route('/api', newsIntelRoutes);
app.route('/api', csReplyQualityRoutes);

if (serveStaticFiles) {
  app.use('/*', serveStatic({ root: distRoot }));
  app.get('*', serveStatic({ root: distRoot, path: 'index.html' }));
}

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

/** 本地/Docker 直接 tsx server/index.ts 时启动；妙搭 NestJS 通过 main.ts 挂载时不启动 */
const entryScript = process.argv[1]?.replace(/\\/g, '/');
const isDirectRun = Boolean(entryScript?.endsWith('server/index.ts'));

function listLanIPv4(): string[] {
  const ips: string[] = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const net of ifaces ?? []) {
      const family = net.family;
      const isV4 = family === 'IPv4' || family === 4;
      if (isV4 && !net.internal) ips.push(net.address);
    }
  }
  return [...new Set(ips)];
}

if (isDirectRun) {
  const port = Number(process.env.PORT ?? 3001);
  const host = (process.env.HOST ?? '0.0.0.0').trim() || '0.0.0.0';
  const clientBasePath = (process.env.CLIENT_BASE_PATH || '').trim().replace(/\/$/, '');
  serve({ fetch: app.fetch, port, hostname: host }, () => {
    const suffix = `${clientBasePath ? ` (base ${clientBasePath})` : ''}${serveStaticFiles ? ' (API + static)' : ''}`;
    console.log(`Server running on http://${host}:${port}${suffix}`);
    for (const ip of listLanIPv4()) {
      console.log(`  LAN: http://${ip}:${port}${suffix}`);
    }
  });
}
