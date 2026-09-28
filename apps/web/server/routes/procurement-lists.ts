import type { Context } from 'hono';
import { Hono } from 'hono';
import { analysisOnlyResponse } from '../lib/analysis-only.js';
import { getCurrentUser } from '../lib/auth-context.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { isRbacEnforced, resolveRequestUser, userHasMenu } from '../lib/rbac.js';
import { assertUploadFile } from '../lib/upload-guard.js';
import {
  executeProcurementFeishuSync,
  executeProcurementUpload,
  getProcurementListConfig,
  getProcurementListMeta,
  isProcurementListType,
  listProcurementRows,
  menuCodeForProcurementList,
  previewProcurementFeishuSync,
  previewProcurementFeishuPush,
  previewProcurementUpload,
  clearProcurementListData,
  type ProcurementListKey,
} from '../lib/procurement-bitable-list.js';
import {
  assertNoRunningProcurementPush,
  parseProcurementFeishuPushTaskResult,
  procurementPushTaskName,
  runProcurementFeishuPushTask,
} from '../lib/procurement-feishu-push-task.js';
import {
  assertNoRunningProcurementFeishuIo,
  procurementPullTaskName,
} from '../lib/procurement-feishu-pull-task.js';
import { finishTaskRun, getTaskRunById, startTaskRun } from '../lib/task-runs.js';

export const procurementListRoutes = new Hono();

async function assertProcurementListAccess(
  c: Context,
  type: string,
  options?: { write?: boolean },
): Promise<{ type: ProcurementListKey; response: Response } | { type: ProcurementListKey }> {
  if (!isProcurementListType(type)) {
    return { type: 'bulk_stock_request', response: c.json({ message: 'Unknown procurement list type' }, 400) };
  }

  if (!isRbacEnforced()) {
    return { type };
  }

  const user = await resolveRequestUser(c);
  if (!user) {
    return { type, response: c.json({ message: 'Unauthorized' }, 401) };
  }
  c.set('user', user);

  const menuCode = menuCodeForProcurementList(type);
  if (!(await userHasMenu(user, menuCode))) {
    return { type, response: c.json({ message: 'Forbidden' }, 403) };
  }

  if (options?.write && user.role.code === 'viewer') {
    return { type, response: c.json({ message: 'Forbidden' }, 403) };
  }

  return { type };
}

procurementListRoutes.get('/procurement/lists/config', async (c) => {
  return c.json(getProcurementListConfig());
});

procurementListRoutes.get('/procurement/lists/:type/meta', async (c) => {
  const access = await assertProcurementListAccess(c, c.req.param('type'));
  if ('response' in access) return access.response;

  const meta = await getProcurementListMeta(access.type);
  return c.json(meta);
});

procurementListRoutes.get('/procurement/lists/:type', async (c) => {
  const access = await assertProcurementListAccess(c, c.req.param('type'));
  if ('response' in access) return access.response;

  const { page, pageSize } = parseListPagination(c.req.query('page'), c.req.query('pageSize'), 20);
  const keyword = c.req.query('keyword') || undefined;

  const result = await listProcurementRows({
    listType: access.type,
    page,
    pageSize,
    keyword,
  });

  return c.json(result);
});

procurementListRoutes.post('/procurement/lists/:type/sync/preview', async (c) => {
  const access = await assertProcurementListAccess(c, c.req.param('type'), { write: true });
  if ('response' in access) return access.response;

  const config = getProcurementListConfig()[access.type];
  if (!config.configured) {
    return c.json(
      {
        message: '飞书多维表格未配置。请设置 FEISHU_BITABLE_APP_TOKEN 与对应 TABLE 环境变量。',
      },
      400,
    );
  }

  try {
    const preview = await previewProcurementFeishuSync(access.type);
    return c.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Feishu sync preview failed';
    return c.json({ message }, 400);
  }
});

procurementListRoutes.post('/procurement/lists/:type/sync', async (c) => {
  const access = await assertProcurementListAccess(c, c.req.param('type'), { write: true });
  if ('response' in access) return access.response;

  const user = await getCurrentUser(c);
  const config = getProcurementListConfig()[access.type];
  if (!config.configured) {
    return c.json(
      {
        message: '飞书多维表格未配置。请设置 FEISHU_BITABLE_APP_TOKEN 与对应 TABLE 环境变量。',
      },
      400,
    );
  }

  try {
    await assertNoRunningProcurementFeishuIo(access.type);
    const run = await startTaskRun(procurementPullTaskName(access.type), user.id);
    try {
      const result = await executeProcurementFeishuSync(access.type, user.id);
      await finishTaskRun(run.id, {
        success: true,
        resultSummary: JSON.stringify({
          direction: 'from_feishu',
          mode: 'full_replace',
          listType: access.type,
          imported: result.imported,
        }),
      });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Feishu sync failed';
      await finishTaskRun(run.id, { success: false, errorMessage: message });
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Feishu sync failed';
    return c.json({ message }, 400);
  }
});

procurementListRoutes.post('/procurement/lists/:type/push/preview', async (c) =>
  analysisOnlyResponse(c),
);

procurementListRoutes.post('/procurement/lists/:type/push', async (c) => analysisOnlyResponse(c));

procurementListRoutes.get('/procurement/lists/:type/push/tasks/:taskRunId', async (c) => {
  const access = await assertProcurementListAccess(c, c.req.param('type'), { write: true });
  if ('response' in access) return access.response;

  const taskRunId = c.req.param('taskRunId')?.trim();
  if (!taskRunId) {
    return c.json({ message: 'taskRunId is required' }, 400);
  }

  const expectedTaskName = procurementPushTaskName(access.type);
  const run = await getTaskRunById(taskRunId);
  if (!run || run.taskName !== expectedTaskName) {
    return c.json({ message: 'Task run not found' }, 404);
  }

  const result = run.status === 'success' ? parseProcurementFeishuPushTaskResult(run.resultSummary) : null;
  return c.json({
    taskRunId: run.id,
    listType: access.type,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorMessage: run.errorMessage,
    result,
  });
});

procurementListRoutes.post('/procurement/lists/:type/import/preview', async (c) =>
  analysisOnlyResponse(c),
);

procurementListRoutes.post('/procurement/lists/:type/import', async (c) => analysisOnlyResponse(c));

procurementListRoutes.post('/procurement/lists/:type/clear', async (c) => analysisOnlyResponse(c));
