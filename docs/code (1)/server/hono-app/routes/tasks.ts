import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { runStockAlert } from '../tasks/stockAlert';
import { runReplenishmentForecast } from '../tasks/replenishmentForecast';
import { isDevAuthMode } from '../integrations/feishu-auth';
import { resolveRequestUser } from '../lib/rbac';

export const taskRoutes = new Hono();

async function requireCronSecret(c: Context, next: Next) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = c.req.header('X-Cron-Secret');
  if (secret && header === secret) return next();

  if (isDevAuthMode()) {
    const user = await resolveRequestUser(c);
    if (user?.role.code === 'super_admin') return next();
  }

  if (!secret) {
    return c.json({ message: 'CRON_SECRET not configured' }, 503);
  }
  return c.json({ message: 'Unauthorized' }, 401);
}

taskRoutes.post('/tasks/stock-alert', requireCronSecret, async (c) => {
  const result = await runStockAlert();
  return c.json(result);
});

taskRoutes.post('/tasks/replenishment-forecast', requireCronSecret, async (c) => {
  const result = await runReplenishmentForecast();
  return c.json(result);
});
