import { Hono } from 'hono';
import { getCurrentUser } from '../lib/auth-context.js';
import {
  executeBitableSync,
  getBitableSyncConfig,
  isBitableSyncType,
  previewBitableSync,
} from '../lib/bitable-sync.js';
import { requireImportAccess } from '../lib/rbac.js';

export const bitableSyncRoutes = new Hono();

bitableSyncRoutes.get('/bitable/status', async (c) => {
  return c.json(getBitableSyncConfig());
});

bitableSyncRoutes.post('/bitable/sync/:type/preview', requireImportAccess(), async (c) => {
  const type = c.req.param('type');
  if (!isBitableSyncType(type)) {
    return c.json({ message: 'Invalid sync type. Use: skus, inventory, sales' }, 400);
  }

  const config = getBitableSyncConfig()[type];
  if (!config.configured) {
    return c.json(
      {
        message: `Bitable sync not configured for ${type}. Set FEISHU_BITABLE_APP_TOKEN and table env.`,
        config,
      },
      503,
    );
  }

  try {
    const preview = await previewBitableSync(type);
    return c.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bitable preview failed';
    return c.json({ message }, 502);
  }
});

bitableSyncRoutes.post('/bitable/sync/:type', requireImportAccess(), async (c) => {
  const user = await getCurrentUser(c);
  const type = c.req.param('type');

  if (!isBitableSyncType(type)) {
    return c.json({ message: 'Invalid sync type. Use: skus, inventory, sales' }, 400);
  }

  const config = getBitableSyncConfig()[type];
  if (!config.configured) {
    return c.json(
      {
        message: `Bitable sync not configured for ${type}. Set FEISHU_BITABLE_APP_TOKEN and table env.`,
        config,
      },
      503,
    );
  }

  try {
    const outcome = await executeBitableSync(type, user.id);
    return c.json(outcome.body, outcome.status as 200 | 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bitable sync failed';
    return c.json({ message }, 502);
  }
});
