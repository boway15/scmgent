import type { Context } from 'hono';
import { Hono } from 'hono';
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
  executeProcurementFeishuPush,
  clearProcurementListData,
  type ProcurementListKey,
} from '../lib/procurement-bitable-list.js';

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
    const result = await executeProcurementFeishuSync(access.type, user.id);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Feishu sync failed';
    return c.json({ message }, 400);
  }
});

procurementListRoutes.post('/procurement/lists/:type/push/preview', async (c) => {
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
    const preview = await previewProcurementFeishuPush(access.type);
    return c.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Feishu push preview failed';
    return c.json({ message }, 400);
  }
});

procurementListRoutes.post('/procurement/lists/:type/push', async (c) => {
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
    const result = await executeProcurementFeishuPush(access.type, user.id);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Feishu push failed';
    return c.json({ message }, 400);
  }
});

procurementListRoutes.post('/procurement/lists/:type/import/preview', async (c) => {
  const access = await assertProcurementListAccess(c, c.req.param('type'), { write: true });
  if ('response' in access) return access.response;

  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ message: '请上传 csv 或 xlsx 文件' }, 400);
  }

  assertUploadFile(file, `procurement-${access.type}`);

  try {
    const buffer = await file.arrayBuffer();
    const preview = await previewProcurementUpload(access.type, buffer, file.name);
    return c.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import preview failed';
    return c.json({ message }, 400);
  }
});

procurementListRoutes.post('/procurement/lists/:type/import', async (c) => {
  const access = await assertProcurementListAccess(c, c.req.param('type'), { write: true });
  if ('response' in access) return access.response;

  const user = await getCurrentUser(c);
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ message: '请上传 csv 或 xlsx 文件' }, 400);
  }

  assertUploadFile(file, `procurement-${access.type}`);

  try {
    const buffer = await file.arrayBuffer();
    const result = await executeProcurementUpload({
      listType: access.type,
      buffer,
      fileName: file.name,
      userId: user.id,
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    return c.json({ message }, 400);
  }
});

procurementListRoutes.post('/procurement/lists/:type/clear', async (c) => {
  const access = await assertProcurementListAccess(c, c.req.param('type'), { write: true });
  if ('response' in access) return access.response;

  const user = await getCurrentUser(c);

  try {
    const result = await clearProcurementListData(access.type, user.id);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Clear failed';
    return c.json({ message }, 400);
  }
});
