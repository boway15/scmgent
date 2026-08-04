import { Hono } from 'hono';
import { getCurrentUser } from '../lib/auth-context.js';
import {
  executeBitableSync,
  getBitableSyncConfig,
  isBitableSyncType,
  previewBitableSync,
} from '../lib/bitable-sync.js';
import {
  assertNoRunningInventoryTurnoverPull,
  INVENTORY_TURNOVER_PULL_TASK,
} from '../lib/inventory-turnover-pull-task.js';
import { requireImportAccess } from '../lib/rbac.js';
import { finishTaskRun, startTaskRun } from '../lib/task-runs.js';

export const bitableSyncRoutes = new Hono();

bitableSyncRoutes.get('/bitable/status', async (c) => {
  return c.json(getBitableSyncConfig());
});

bitableSyncRoutes.post('/bitable/sync/:type/preview', requireImportAccess(), async (c) => {
  const type = c.req.param('type');
  if (!isBitableSyncType(type)) {
    return c.json(
      {
        message:
          'Invalid sync type. Use: skus, inventory, inventory_turnover, sales, merchants, inventory_policy',
      },
      400,
    );
  }

  const config = getBitableSyncConfig()[type];
  if (!config.configured) {
    return c.json(
      {
        message: `Bitable sync not configured for ${type}. Set FEISHU_BITABLE_APP_TOKEN (or FEISHU_BITABLE_PROCUREMENT_APP_TOKEN for inventory) and table env.`,
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
    return c.json(
      {
        message:
          'Invalid sync type. Use: skus, inventory, inventory_turnover, sales, merchants, inventory_policy',
      },
      400,
    );
  }

  const config = getBitableSyncConfig()[type];
  if (!config.configured) {
    return c.json(
      {
        message: `Bitable sync not configured for ${type}. Set FEISHU_BITABLE_APP_TOKEN (or FEISHU_BITABLE_PROCUREMENT_APP_TOKEN for inventory) and table env.`,
        config,
      },
      503,
    );
  }

  try {
    if (type === 'inventory_turnover') {
      await assertNoRunningInventoryTurnoverPull();
      const run = await startTaskRun(INVENTORY_TURNOVER_PULL_TASK, user.id);
      try {
        const outcome = await executeBitableSync(type, user.id);
        if (!outcome.ok) {
          await finishTaskRun(run.id, {
            success: false,
            errorMessage:
              typeof outcome.body.message === 'string'
                ? outcome.body.message
                : 'Import blocked by validation issues',
          });
          return c.json(outcome.body, outcome.status as 200 | 400);
        }
        await finishTaskRun(run.id, {
          success: true,
          resultSummary: JSON.stringify({
            direction: 'from_feishu',
            syncType: 'inventory_turnover',
            imported: outcome.body.imported ?? 0,
            mismatchCount: outcome.body.mismatchCount,
            skipped: outcome.body.skipped,
            createdSkus: outcome.body.createdSkus,
            updatedSkus: outcome.body.updatedSkus,
            triggeredBy: 'manual',
          }),
        });
        return c.json({ ...outcome.body, taskRunId: run.id }, outcome.status as 200 | 400);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Bitable sync failed';
        await finishTaskRun(run.id, { success: false, errorMessage: message });
        throw err;
      }
    }

    const outcome = await executeBitableSync(type, user.id);
    return c.json(outcome.body, outcome.status as 200 | 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bitable sync failed';
    const status = message.includes('正在从飞书同步') ? 409 : 502;
    return c.json({ message }, status);
  }
});
